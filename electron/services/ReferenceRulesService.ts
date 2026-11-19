import { randomUUID } from 'node:crypto';
import type {
  EffectiveReferenceRule,
  ReferenceAutodetectCandidate,
  ReferenceAutodetectInput,
  ReferenceResolveInput,
  ReferenceResolveResult,
  ReferenceRule,
  ReferenceRuleCreateInput,
  ReferenceRuleUpdateInput,
  RefsOverrideInput,
  SettingOwner,
} from '@shared/types';
import { NotFoundError, ValidationError } from '../errors.ts';
import { effectiveRules } from './effectiveRules.ts';
import { targetFieldProblem } from './familyExportFormat.ts';
import { classifyMongoOpError } from '../mongo/errors.ts';
import { ejsonEncode, parseEjsonField } from '../mongo/ejson.ts';
import type { MongoPool } from '../mongo/MongoPool.ts';
import { matchKey, pairInSourceOrder, valuesAtPath } from './referencePairing.ts';
import { EXACT_BSON } from '../mongo/undo.ts';
import { ownSet } from '../ownProperty.ts';
import type {
  ReferenceRuleInsert,
  ReferenceRulePatch,
  ReferenceRulesRepo,
} from '../db/repositories/ReferenceRulesRepo.ts';

function nowIso(): string {
  return new Date().toISOString();
}

/** True when a projection already carries `path`, whole or through a parent. */
function projectionCovers(fields: string[], path: string): boolean {
  return fields.some((f) => f === path || path.startsWith(`${f}.`));
}

function normalizeProjection(projection: string[] | undefined): string[] {
  if (!projection) return [];
  return Array.from(new Set(projection.map((p) => p.trim()).filter((p) => p.length > 0)));
}

export function projectionToMongo(fields: string[]): Record<string, 1> | undefined {
  if (fields.length === 0) return undefined;
  const out: Record<string, 1> = {};
  for (const f of fields) ownSet(out, f, 1);
  // Always carry `_id` so the drawer can render a stable identifier.
  out._id = 1;
  return out;
}

/** Convert `"contacts"` → `"contact"` using a few forgiving rules. */
function singularize(word: string): string {
  if (word.length <= 2) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/ses$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

function pluralize(word: string): string {
  if (/s$/.test(word)) return word;
  if (/y$/.test(word) && !/[aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

/**
 * Find candidate reference fields by naming convention. Matches:
 *   - `<stem>_id`   → collection `<plural(stem)>`
 *   - `<stem>Id`    → collection `<plural(stem)>`
 * Returns one candidate per unique source field. The service later verifies
 * the target collection exists before offering it to the user.
 */
export function detectCandidateFieldsFromDocs(
  sampleDocs: unknown[],
): Array<{ sourceField: string; stem: string }> {
  const seen = new Map<string, string>();
  const walk = (obj: unknown, prefix: string): void => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      for (const item of obj.slice(0, 3)) walk(item, prefix);
      return;
    }
    if (typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (key === '_id') continue;
      const stem = /^(.+)_id$/.exec(key)?.[1] ?? /^(.+)Id$/.exec(key)?.[1];
      if (stem && !seen.has(path)) seen.set(path, stem);
      // Recurse one level, skipping EJSON sentinels like {$oid, $date}.
      if (!prefix && val && typeof val === 'object' && !Array.isArray(val)) {
        const keys = Object.keys(val);
        if (!keys.some((k) => k.startsWith('$'))) walk(val, path);
      }
    }
  };
  for (const doc of sampleDocs.slice(0, 25)) walk(doc, '');
  return [...seen.entries()].map(([sourceField, stem]) => ({ sourceField, stem }));
}

function buildInsert(input: ReferenceRuleCreateInput): ReferenceRuleInsert {
  const now = nowIso();
  return {
    id: randomUUID(),
    owner: input.owner,
    source_db: input.sourceDb,
    source_collection: input.sourceCollection,
    source_field: input.sourceField,
    target_db: input.targetDb,
    target_collection: input.targetCollection,
    target_field: input.targetField ?? '_id',
    projection_json: JSON.stringify(normalizeProjection(input.projection)),
    display_template: input.displayTemplate === undefined || input.displayTemplate === '' ? null : input.displayTemplate,
    enabled: input.enabled === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  };
}

export class ReferenceRulesService {
  private repo: ReferenceRulesRepo;
  private pool: MongoPool;

  constructor(repo: ReferenceRulesRepo, pool: MongoPool) {
    this.repo = repo;
    this.pool = pool;
  }

  /** The rules a Connection owns itself, Family-shared ones left out. */
  list(connectionId: string): ReferenceRule[] {
    return this.repo.listByOwner({ connectionId });
  }

  /** One Collection's rules a Connection owns itself, Family-shared ones left out. */
  listForCollection(
    connectionId: string,
    sourceDb: string,
    sourceCollection: string,
  ): ReferenceRule[] {
    return this.repo.listForOwnerCollection({ connectionId }, sourceDb, sourceCollection);
  }

  /**
   * What a Connection uses: its own rules, then its Family's shared rules that
   * it does not override. Every surface that reads rules goes through here.
   */
  effective(
    connectionId: string,
    dbName?: string,
    collection?: string,
  ): EffectiveReferenceRule[] {
    const familyId = this.repo.familyIdOfConnection(connectionId);
    const read = (owner: SettingOwner): ReferenceRule[] =>
      dbName !== undefined && collection !== undefined
        ? this.repo.listForOwnerCollection(owner, dbName, collection)
        : this.repo.listByOwner(owner);
    return effectiveRules(
      read({ connectionId }),
      familyId === null ? [] : read({ familyId }),
    );
  }

  get(id: string): ReferenceRule {
    return this.repo.findByIdOrThrow(id);
  }

  create(input: ReferenceRuleCreateInput): ReferenceRule {
    return this.repo.insert(buildInsert(input));
  }

  /**
   * Replace a shared rule on one Connection, or switch it off there. The
   * Override is a Connection-owned row with the shared rule's key; asking
   * again for the same key updates it.
   */
  override(input: RefsOverrideInput): ReferenceRule {
    const shared = this.repo.findByIdOrThrow(input.sharedRuleId);
    if (!('familyId' in shared.owner)) {
      throw new ValidationError(`reference rule ${shared.id} is not a shared rule`);
    }
    if (!this.repo.connectionExists(input.connectionId)) {
      throw new NotFoundError(`connection ${input.connectionId} not found`);
    }
    if (this.repo.familyIdOfConnection(input.connectionId) !== shared.owner.familyId) {
      throw new ValidationError(
        `reference rule ${shared.id} is not shared with connection ${input.connectionId}`,
      );
    }
    const own = this.repo
      .listForOwnerCollection({ connectionId: input.connectionId }, shared.sourceDb, shared.sourceCollection)
      .find((r) => r.sourceField === shared.sourceField);
    if (own) return this.update(own.id, input.patch);
    return this.repo.insert(
      buildInsert({
        owner: { connectionId: input.connectionId },
        sourceDb: shared.sourceDb,
        sourceCollection: shared.sourceCollection,
        sourceField: shared.sourceField,
        targetDb: input.patch.targetDb ?? shared.targetDb,
        targetCollection: input.patch.targetCollection ?? shared.targetCollection,
        targetField: input.patch.targetField ?? shared.targetField,
        projection: input.patch.projection ?? shared.projection,
        displayTemplate: input.patch.displayTemplate ?? shared.displayTemplate,
        enabled: input.patch.enabled ?? shared.enabled,
      }),
    );
  }

  /** Delete a Connection's Override so the shared rule takes over again. */
  resetToShared(id: string): void {
    const rule = this.repo.findByIdOrThrow(id);
    if (!('connectionId' in rule.owner)) {
      throw new ValidationError(`reference rule ${id} is not owned by a connection`);
    }
    const familyId = this.repo.familyIdOfConnection(rule.owner.connectionId);
    const shared =
      familyId === null
        ? undefined
        : this.repo
            .listForOwnerCollection({ familyId }, rule.sourceDb, rule.sourceCollection)
            .find((r) => r.sourceField === rule.sourceField);
    if (!shared) throw new ValidationError(`reference rule ${id} does not override a shared rule`);
    this.delete(id);
  }

  update(id: string, patch: ReferenceRuleUpdateInput): ReferenceRule {
    const sqlPatch: ReferenceRulePatch = { updated_at: nowIso() };
    if (patch.targetDb !== undefined) sqlPatch.target_db = patch.targetDb;
    if (patch.targetCollection !== undefined) sqlPatch.target_collection = patch.targetCollection;
    if (patch.targetField !== undefined) sqlPatch.target_field = patch.targetField;
    if (patch.projection !== undefined) {
      sqlPatch.projection_json = JSON.stringify(normalizeProjection(patch.projection));
    }
    if (patch.displayTemplate !== undefined) {
      sqlPatch.display_template = patch.displayTemplate === '' ? null : patch.displayTemplate;
    }
    if (patch.enabled !== undefined) sqlPatch.enabled = patch.enabled ? 1 : 0;
    return this.repo.update(id, sqlPatch);
  }

  delete(id: string): void {
    const changes = this.repo.deleteById(id);
    if (changes === 0) throw new NotFoundError(`reference rule ${id} not found`);
  }

  async resolve(input: ReferenceResolveInput): Promise<ReferenceResolveResult> {
    const stored = this.repo.findByIdOrThrow(input.ruleId);
    const connectionId = this.connectionToResolveOn(stored, input.connectionId);
    // The rule in effect on this Connection: an Override stands in for the
    // shared rule it replaces, and a rule nothing resolves to is refused.
    const rule = this.effective(connectionId, stored.sourceDb, stored.sourceCollection).find(
      (r) => r.id === stored.id || r.sharedRuleId === stored.id,
    );
    if (!rule) {
      throw new ValidationError(`reference rule ${stored.id} does not apply to connection ${connectionId}`);
    }
    // A row saved before the handlers refused such a field is still never run as an operator query.
    const fieldProblem = targetFieldProblem(rule.targetField);
    if (fieldProblem !== null) throw new ValidationError(`reference rule ${stored.id}: ${fieldProblem}`);
    const value = parseEjsonField<unknown>(input.valueEjson, 'valueEjson');
    const db = await this.pool.readDb(connectionId, rule.targetDb);
    const coll = db.collection(rule.targetCollection);
    const projection = projectionToMongo(rule.projection);
    const t0 = Date.now();
    try {
      // Array source value → match any element via $in, then order results to
      // follow the source array so the renderer can show "first ref". A match
      // that pairs with no source value is kept, after the ordered ones.
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return { ruleId: input.ruleId, found: false, documents: [], durationMs: Date.now() - t0 };
        }
        const filter = { [rule.targetField]: { $in: value } } as Record<string, unknown>;
        const docs = await coll.find(filter, { ...EXACT_BSON, projection }).toArray();
        // The pairing reads each document's targetField. When the user's
        // projection leaves it out, read it in a second query that only pairs
        // and is never shown, so a projection that overlaps the path cannot
        // collide and the field cannot leak into what the user sees.
        let keyDocs: unknown[] = docs;
        if (projection && !projectionCovers(rule.projection, rule.targetField)) {
          const keyed = await coll
            .find(filter, { ...EXACT_BSON, projection: { [rule.targetField]: 1 } })
            .toArray();
          const keyedById = new Map(keyed.map((k) => [matchKey(k._id), k]));
          keyDocs = docs.map((d) => keyedById.get(matchKey(d._id)));
        }
        const ordered = pairInSourceOrder(
          value,
          docs,
          keyDocs.map((k) => valuesAtPath(k, rule.targetField)),
        );
        return {
          ruleId: input.ruleId,
          found: ordered.length > 0,
          documents: ordered.map((d) => ejsonEncode(d, false)),
          durationMs: Date.now() - t0,
        };
      }
      const doc = await coll.findOne(
        { [rule.targetField]: value } as Record<string, unknown>,
        { ...EXACT_BSON, projection },
      );
      return {
        ruleId: input.ruleId,
        found: doc !== null,
        documents: doc ? [ejsonEncode(doc, false)] : [],
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  /** The Connection a rule is read through: its owner, or the caller's choice for a Family's rule. */
  private connectionToResolveOn(rule: ReferenceRule, requested: string | undefined): string {
    if ('connectionId' in rule.owner) {
      if (requested !== undefined && requested !== rule.owner.connectionId) {
        throw new ValidationError(`reference rule ${rule.id} belongs to another connection`);
      }
      return rule.owner.connectionId;
    }
    if (requested === undefined) {
      throw new ValidationError(`reference rule ${rule.id} is shared: pass the connection to resolve on`);
    }
    if (this.repo.familyIdOfConnection(requested) !== rule.owner.familyId) {
      throw new ValidationError(`reference rule ${rule.id} is not shared with connection ${requested}`);
    }
    return requested;
  }

  async autodetect(input: ReferenceAutodetectInput): Promise<ReferenceAutodetectCandidate[]> {
    const existingByField = new Map(
      this.effective(input.connectionId, input.dbName, input.collection)
        .map((r) => [r.sourceField, r]),
    );

    let db;
    try {
      db = await this.pool.readDb(input.connectionId, input.dbName);
    } catch {
      return [];
    }

    const needSample = !input.sampleDocs || input.sampleDocs.length === 0;
    let docsPromise: Promise<unknown[]> = Promise.resolve(input.sampleDocs ?? []);
    if (needSample) {
      docsPromise = db.collection(input.collection).find({}).limit(25).toArray()
        .catch(() => [] as unknown[]);
    }
    const collsPromise = db.listCollections({}, { nameOnly: true }).toArray()
      .catch(() => [] as Array<{ name: string }>);

    const [docs, cols] = await Promise.all([docsPromise, collsPromise]);
    if (cols.length === 0) return [];
    const collectionNames = new Set(cols.map((c) => c.name));

    const candidates = detectCandidateFieldsFromDocs(docs);
    const out: ReferenceAutodetectCandidate[] = [];
    for (const { sourceField, stem } of candidates) {
      const guesses = uniqueNonEmpty([
        pluralize(stem),
        stem,
        pluralize(singularize(stem)),
      ]);
      const match = guesses.find((g) => collectionNames.has(g));
      if (!match) continue;
      out.push({
        sourceField,
        targetDb: input.dbName,
        targetCollection: match,
        targetField: '_id',
        alreadyConfigured: existingByField.has(sourceField),
      });
    }
    return out;
  }
}

function uniqueNonEmpty(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

