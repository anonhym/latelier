# PII tokenization for MCP tool results

Status: research, not a spec. Date: 2026-10-18. Scope: options, and the seam iteration 1 should keep. Nothing here is being built now.

Convention: **[F]** = fact with a primary-source URL. **[O]** = opinion/inference by the author.

## 1. Detection

| Approach | How | Cost | Weakness |
|---|---|---|---|
| Field-name / schema | Match key paths (`email`, `ssn`, `profile.phone`) against a policy list or glob | O(keys), microseconds | Misses PII in free text and in oddly named fields; schema drift (see 3) |
| Value-based, regex | Pattern recognizers (email, card, SSN, IBAN) | Fast, in-process | Format-bound; false positives on look-alike IDs |
| Value-based, NER/ML | Model finds names, orgs, locations in strings | 10s-100s of ms per string | Probabilistic; heavy model download |
| Hybrid | Name rules first, value scan on remaining string leaves | Tunable | More config |

Facts:
- Presidio's analyzer recognizers "can be a rule-based recognizer, a machine learning model, or a combination"; `PatternRecognizer` is regex-based; NLP engines are spaCy (default), Stanza, or Transformers. [F] https://presidio.dataprivacystack.org/analyzer/
- Presidio states "there is no guarantee that Presidio will find all sensitive information." [F] https://presidio.dataprivacystack.org/
- Presidio's structured module analyzes columns/keys with the analyzer, then maps key names to entity types; for JSON, "Nesting objects in lists is not supported in JsonAnalysisBuilder for now" (workaround: hand-written dotted paths like `users.name`); it also warns sensitive data "might not be automatically detected in some cases". Detection of sensitive *column names* is listed as planned work, not shipped. [F] https://presidio.dataprivacystack.org/structured/
- Amazon Comprehend detects a fixed list of PII entity types (NAME, ADDRESS, EMAIL, SSN, ...) for English/Spanish text, real-time up to 100 KB per document, with a confidence score per span; *redaction* of a document is an asynchronous batch job. [F] https://docs.aws.amazon.com/comprehend/latest/dg/how-pii.html (cloud call = data leaves the machine, defeating the purpose for a local-first app; [O])
- Google Sensitive Data Protection splits "InfoType transformations" (detected values in text) from "Record transformations" (an entire column/field of tabular data, or an infoType within it). That is the same field-rule vs value-scan split as above. [F] https://docs.cloud.google.com/sensitive-data-protection/docs/deidentify-sensitive-data . Also a cloud API.

### Node vs Python sidecar

| Option | Maturity | Notes |
|---|---|---|
| Presidio (Python) | Reference implementation; Python, Docker, HTTP service, Kubernetes documented; no JS client mentioned on the docs home | Needs a sidecar process (REST) or bundled Python. [F] https://presidio.dataprivacystack.org/ |
| Presidio via HTTP from Node | Third-party wrappers exist (e.g. `presidio-anonymizer-nestjs`, `node-red-contrib-presidio`) that just call the Python services | Still a sidecar. [F] https://unpkg.com/presidio-anonymizer-nestjs@0.0.12/README.md |
| AnonymizerTS (`@siddicky/anonymizerts`) | Independent TS lib "inspired by" Presidio, not its code; self-described as lacking encryption and image anonymization, partial structured/custom-recognizer/multilang support; phone/SSN US-only; NER via transformers.js (`Xenova/bert-base-NER`) at its own estimate of ~100-200 ms per 100 words | Small, young; vendor-self-reported numbers. [F] https://cdn.jsdelivr.net/npm/@siddicky/anonymizerts@1.0.3/COMPARISON.md |
| Hand-rolled regex + key rules in TS | Fully in-process, zero deps | Covers email/phone/card/SSN/IBAN/JWT-like; no names in free text [O] |

[O] Feasible in-process in Electron main: key-name rules + regex (+ Luhn/IBAN checksum). Names/orgs in free text need an ML model: either transformers.js/ONNX in-process (large model, cold start) or a Presidio sidecar. Neither belongs in iteration 1; key-name policy is the cheapest 80% for a DB tool because DB PII is mostly in well-named fields, unlike chat text.

## 2. Transformation

| Transform | Source behavior | Equality / join / group-by | Reversible | Notes for agents |
|---|---|---|---|---|
| Redact | Presidio `redact` removes the value; `replace` swaps in a value or the entity type name (e.g. `<PHONE_NUMBER>`) | Broken: all rows collapse to one value | No | Safest; agent loses all structure on that field |
| Mask | Presidio `mask`: replace N chars with a mask char | Partial: last-4 may still join approximately | No | Leaks the preserved characters; fine for display |
| Hash | Presidio `hash`: sha256 (default) / sha512 with salt. Since 2.2.361 default salt is random per call, so same value gives different hashes unless you pass a consistent salt (>= 128 bits); Presidio "does not store or maintain stateful sessions" | Works only with a stable salt | No | Low-entropy values (phone, SSN, small domains) are brute-forceable if salt/key is known |
| Keyed hash (HMAC) | Google "Crypto hash": 32-byte hex string from a data-encryption key; the docs say it "can't be re-identified" | Works (deterministic) | No | Needs a vault or lookup table to reverse |
| Deterministic encryption | Google AES-SIV: same input gives same token; output not format/length preserving; reversible with key + full token + any context tweak | Works | Yes | Tokens are long base64, bloat context |
| FPE | Google FFX: same length and alphabet; min 2 chars; less secure than AES-SIV (no authentication/IV), "recommend AES-SIV unless length and character set preservation are strict requirements"; small alphabets/inputs risk reverse engineering | Works if tweak constant | Yes | Output looks like real data (email-shaped tokens are tricky; FPE works on an alphabet, not on structure) |
| Vault tokenization (local table token <-> value) | Not a Presidio operator; `redact-mcp` keeps a two-way table persisted to `mappings.json`, same real value always maps to same fake | Works (same value, same token) | Yes (table lookup) | Plaintext PII sits in the vault; protect it |
| Presidio `encrypt` + `DeanonymizeEngine` `decrypt` | `encrypt` with a key is the only anonymize operator paired with a deanonymize operator | Encrypted output is usually not used for joins [O: AES-CBC with random IV is not stated deterministic in the docs read; verify before relying on it] | Yes, same key | Primarily an offline round-trip |

Sources: Presidio operators and deanonymize: https://presidio.dataprivacystack.org/anonymizer/ . Google pseudonymization: https://docs.cloud.google.com/sensitive-data-protection/docs/pseudonymization . Google transformation catalog (redact, replace, mask, crypto hash, FPE, AES-SIV "generates identical tokens for each instance of an identical input value", bucketing, date shift "with the option to be consistent for the same context"): https://docs.cloud.google.com/sensitive-data-protection/docs/transformations-reference . redact-mcp: https://github.com/r3352/redact-mcp

### NIST FPE status (FF1 / FF3)

- SP 800-38G specified FF1 and FF3. The 2019 initial draft of Rev. 1 shortened the FF3 tweak (64 to 56 bits, renamed FF3-1) and raised the minimum domain size to 1,000,000 for FF1/FF3-1 (earlier: min 100, recommended 1M). [F] https://csrc.nist.gov/pubs/sp/800/38/g/r1/ipd
- The Feb 2025 second public draft **removes FF3** after a tweak-schedule weakness (Beyne) affecting FF3 and FF3-1 but not FF1, specifies **only FF1**, and increases FF1's domain size (page does not give the number). It is a draft, not final. [F] https://csrc.nist.gov/pubs/sp/800/38/g/r1/2pd
- [O] If FPE is ever used: FF1 only, never FF3/FF3-1; reject fields whose domain is too small. Most PII fields in a DB (short numeric codes, 4-digit PINs) fall under the minimum domain and would have to be rejected or tokenized by vault instead. FPE also needs a vetted library; do not hand-roll.

### Agent-reasoning trade-offs [O]

- The agent needs: equality (same entity gets same token), group-by/count (deterministic mapping), joins across collections (same token across fields of the same entity type). That requires deterministic tokens, scoped by *entity type* (not by field), so `orders.customerEmail` and `users.email` get the same token.
- Not needed by the agent: reversibility. Reversibility is needed by the *user* (to read the final answer) and by *ingress* (agent sends a token back as a filter).
- Ordering/range semantics are lost for any token; keep non-PII numeric/date fields untouched, or use bucketing/date-shift (Google lists both) as per-field policy.
- Token shape matters: typed tokens like `EMAIL_7f3a` tell the LLM what it is, preserving its reasoning; opaque base64 does not.

## 3. JSON / BSON specifics

- **EJSON.** MongoDB canonical EJSON: ObjectId is `{"$oid": "<24 hex>"}` in both modes; Date is `{"$date": {"$numberLong": "<ms>"}}` canonical or ISO string relaxed; Int64 is `{"$numberLong": "50"}` canonical vs plain number relaxed (type info lost in relaxed). [F] https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/ . [O] Walk the *parsed* document (after EJSON deserialization) and decide per leaf by BSON type: tokenize only strings (and maybe Binary/UUID); never touch `$oid`, `$date`, numbers, so the document stays structurally valid and `_id` joins still work. L'Atelier already serializes canonical (CLAUDE.md, EJSON on the wire); the egress transform sits after that, on the object tree, then re-serializes.
- **Nested/arrays/mixed types.** Path-based rules need array-index wildcards (`items.*.email`, `**.email`). The same key can be a string in one doc and an object in another; the transform must dispatch on runtime type, not schema. Presidio's own JSON analysis cannot auto-handle objects nested in lists (see 1), so a Presidio-based design would need explicit dotted-path rules for those anyway.
- **Schema drift.** Key-name rules miss renamed/new fields (`contact_mail`); value rules catch them at runtime cost. [O] Hybrid default: key rules authoritative, value regex as a safety net over all remaining string leaves.
- **Session consistency.** Presidio is stateless ("does not store or maintain stateful sessions"), so consistent hashing needs a salt you manage. [F] https://presidio.dataprivacystack.org/anonymizer/ . [O] For cross-call consistency, use either (a) HMAC with a per-session (or per-connection) secret held in main-process memory, or (b) a vault with `(entityType, value) -> token`. (a) is stateless and cheap but not reversible; (b) is reversible but holds plaintext PII. Scope of the key (per tool call / session / connection / forever) is the policy knob: longer scope = better joins across calls, larger linkability.
- **Large-text & tokens-count.** Prompts for the agent get redacted strings; if tokens are longer than the value, context grows. Cap token length.

## 4. Aggregation and filters

- **Post-pipeline egress** (tokenize results only) is simple. Server-side stages run on raw values, so `$group` by email, `$count`, `$lookup` all work on the real data; the agent just sees tokens afterwards. Caveat: aggregation can *compute* PII from non-PII or reshape fields, so key-name rules on output paths may miss (`$project: {x: "$email"}`); value-scan on the output is the backstop. Postgres MCP Pro documents the same issue: casts, combined expressions and whole-row projections of a protected source are fully redacted and "lineage is not tracked through arbitrary views or functions". [F] https://github.com/Swell-Platform/postgres-mcp (README, redaction section)
- **Ingress** (agent sends `{email: "EMAIL_7f3a"}` as filter). Need to detokenize before the query runs. With a vault: walk the filter/pipeline EJSON, replace any string equal to a known token with its plaintext, in any position (`$eq`, `$in`, `$match`, `$lookup` literal). Tokens are only unambiguous if they are unguessable-format (prefix + random/HMAC) so a real value is never mistaken for a token; and if detokenizing a *new* unknown token, fail with a clear error rather than query it literally. HMAC-only tokens are not reversible, so ingress cannot work without a vault or an encryption scheme (AES-SIV/FF1, both reversible with the key).
- **Operators other than equality** (`$regex`, `$gt`, text search) on a tokenized field cannot work on tokens: return an explicit error ("field is protected; only equality/`$in`"). This mirrors how MongoDB's own field-level encryption behaves: randomized-encrypted fields cannot be queried directly; deterministic ones support equality; low-cardinality deterministic values are "susceptible to frequency analysis". [F] https://www.mongodb.com/docs/manual/core/csfle/fundamentals/encryption-algorithms/
- **Tools that write.** If a write tool ever exists, ingress detokenization on `$set` values is a data-integrity risk (wrong token resolves to wrong person). [O] Keep iteration-1 MCP read-only; the official server has `readOnly` mode. [F] https://github.com/mongodb-js/mongodb-mcp-server
- **CSFLE / Queryable Encryption are not this feature.** They encrypt on the client so the *server* never sees plaintext, and decrypt only client-side with the user's keys (QE supports equality, range, prefix, suffix, substring queries). The app *is* the trusted client here, so those would show plaintext to L'Atelier anyway. They could matter only as an input: encrypted fields arrive as `Binary` and should be left alone by the transform. [F] https://www.mongodb.com/docs/manual/core/queryable-encryption/ [O: the binary-passthrough point is inference]

## 5. What existing DB-to-LLM tools do today

| Tool | Behavior | Source |
|---|---|---|
| Official `mongodb-js/mongodb-mcp-server` | No PII redaction documented. Controls are `readOnly`, `disabledTools`, per-query caps (`maxDocumentsPerQuery` default 100, `maxBytesPerQuery` default 16 MB). Only the `config` resource is redacted. Tool responses wrap untrusted data in delimiters with a prompt-injection warning by default. Warns that exports may contain sensitive data. | https://github.com/mongodb-js/mongodb-mcp-server |
| Postgres MCP Pro (Swell-Platform fork) | Results masked by default; detectors `none`/`simple`/`presidio` (Presidio optional install, excluded from default image); `protected_tables`/`protected_columns`/`column_rules`; partial masks (email local part, last 4 of phone/SSN, year of date); explicit-confirmation reveal; protected data can still take part in joins and aggregations; lineage limits documented. | https://github.com/Swell-Platform/postgres-mcp |
| `narekmalk/safedb-mcp` | Config-driven per-column masks (`redact`, `email`, `partial`, deterministic `hash`); no auto-detection documented; masked columns cannot be selected through aliases/expressions that bypass masking; audit logs hold no raw result data. | https://github.com/narekmalk/safedb-mcp |
| `r3352/redact-mcp` (generic, not DB-specific) | Regex (19 patterns) + NER (`Xenova/bert-base-NER`), deterministic fakes, two-way mapping persisted to `mappings.json`; deobfuscation exposed as explicit tools. Audit log, if enabled, contains real sensitive data. | https://github.com/r3352/redact-mcp |
| MCP spec | Servers MUST "sanitize tool outputs"; clients SHOULD validate results before passing to the LLM and show inputs to the user. It defines no PII mechanism. Results can carry `structuredContent` plus a text block. | https://modelcontextprotocol.io/specification/2025-06-18/server/tools |

Pattern across them [O]: field/column policy is primary; Presidio is optional and heavy; reversibility is rare and where present (redact-mcp) leaves plaintext on disk.

## 6. Where it would plug in for L'Atelier [O throughout]

**Shape: one egress transform, one ingress transform, one policy object.**

```
agent --tools/call args--> [ingress: detokenize(args)] --> existing query service --> Mongo
agent <--tool result----- [egress: protect(docs)]    <-- existing query service <--
```

- **Egress:** a single function `protectResult(connectionId, sessionId, ejsonValue) -> { value, stats }` applied to *every* MCP tool result (find, aggregate, count samples, schema/sample tools, export, error messages that echo values) at the one place the MCP layer serializes results. Iteration 1 ships it as an identity function.
- **Ingress:** a single `resolveArgs(connectionId, sessionId, args)` applied to every tool's arguments (filter, pipeline, projection, sort, `_id` lists) before they reach the existing services. Identity in iteration 1.
- **Policy:** a plain-text JSON per connection (matches repo's "plain text state" rule), e.g. `{ mode: "off"|"redact"|"tokenize", fields: [{ path: "**.email", action: "token", entity: "EMAIL" }], valueScan: "none"|"regex" }`, with an optional per-collection override. Default `off` in iteration 1; the GUI itself is unaffected, the transform applies only on the MCP path.
- **Key/vault location:** main process only; session-scoped secret from `crypto.randomBytes`, vault in memory (or OS-keychain-backed secrets already used by the app for connection passwords) so nothing plaintext lands in SQLite. Never expose a detokenize tool to the agent.
- **De-tokenizing for the human:** the MCP response stays tokenized; if the app shows the agent's transcript, the renderer asks main to detokenize for display via an IPC channel (new channel, must go through the 5-file contract and `SECRET_INPUT` audit if it carries a secret).
- **Where Presidio would fit if ever wanted:** an optional `detector` plug (interface: string -> spans) behind `valueScan`, backed by a Presidio HTTP sidecar; tokenization stays ours because Presidio is stateless and its only reversible operator is `encrypt`/`decrypt`.

**Iteration 1 must not preclude:**
1. All tool results flow through one serializer; no tool builds its own response from raw docs.
2. Results are tokenized as an *object tree* before string serialization (don't stringify EJSON then regex it; types are lost).
3. All tool arguments pass through one parse step before the existing services (so ingress can hook), and tools don't echo raw argument values in error text, logs, or the `outputSchema`.
4. Tool results carry a session id and connection id in the call context (needed for token scope).
5. Logs and any audit trail avoid raw result data (safedb-mcp's approach; redact-mcp's audit log is the counter-example).
6. Document that, until this exists, the user is the DLP: connection-level `readOnly`, the existing doc/byte caps, and the untrusted-data delimiter pattern are the only controls (what the official server ships).

**Open decisions (for the maintainer):** token scope (call/session/connection); vault persistence (memory vs keychain); whether ingress may ever detokenize into writes (recommend no); whether to ship value-scan regex before any NER.
