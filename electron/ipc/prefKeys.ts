import { z } from 'zod';

/**
 * Keys the renderer may read or write through `prefs:get` / `prefs:set`.
 *
 * The renderer is untrusted, and the main process reads security-relevant
 * keys from the same store, so a free-form key would let it flip them. A key
 * absent from both sets below is main-only (window bounds, the theme — which
 * has its own validated channel — and the maintenance stamp). Add a key here
 * before the renderer starts using it: an unlisted key is rejected, and most
 * call sites swallow that, so the preference would silently stop persisting.
 */

/** The plaintext-password fallback switch; main reads it, only a confirmed channel writes it. */
export const PLAINTEXT_FALLBACK_KEY = 'secrets.allowPlaintextFallback';

const finite = z.number().finite();

const SET_SCHEMAS = new Map<string, z.ZodType>([
  ['ui.showSystemDbs', z.boolean()],
  ['ui.users.lastDb', z.string().max(1024)],
  [
    'ui.hints.dismissed',
    z.object({
      dismissedIds: z.array(z.string().max(64)).max(64),
      resetAt: z.string().max(64).optional(),
    }),
  ],
  ['ui.workspace.defaultPageSize', finite],
  ['ui.workspace.defaultView', z.enum(['Table', 'Tree', 'JSON'])],
  ['ui.workspace.copyFormat', z.enum(['readable', 'canonical', 'mongosh'])],
  ['ui.editor.fontSize', z.number().int().min(10).max(20)],
  ['ui.workspace.leftWidth', finite],
  ['ui.workspace.refDrawerWidth', finite],
  ['ui.workspace.innerHSplit', finite],
  ['ui.workspace.shellSplit', finite],
  ['ui.workspace.sidebarCollapsed', z.boolean()],
  ['ui.workspace.builderCollapsed', z.boolean()],
  ['ui.workspace.restoreTabs', z.boolean()],
  ['ui.scripts.confirmDestructive', z.boolean()],
  ['ui.workspace.documentEditorSize', z.object({ width: finite, height: finite.optional() })],
  ['ui.commandPalette.mru', z.array(z.string().max(512)).max(16)],
  ['ui.connections.pinned', z.array(z.string().uuid()).max(500)],
  // The version whose release notes the What's new window last showed (X22 §6.2).
  ['whatsNew.lastSeenVersion', z.string().max(32)],
  // The version the away-from-workspace update toast last showed for (X22 §4): once per version.
  ['update.toastShownFor', z.string().max(32)],
  // Warn when a value copied on another Connection is pasted into a query (X25 §5). X25 names the key, so it has no `ui.` prefix.
  ['warnings.crossConnectionPaste', z.boolean()],
  // Reference pairs the user chose Never for (X26 §6): `connectionId|` then the six names as a JSON array (or a hash of it when longer than the cap below, `MAX_PAIR_KEY_LENGTH` in `src/utils/referenceDiscovery.ts`), oldest first.
  ['refs.discovery.never', z.array(z.string().max(1024)).max(500)],
]);

// Connection ids are `crypto.randomUUID()`. One bounded character class and an
// exact length: nothing for the engine to backtrack over.
const CONN_EXPANDED_KEY = /^ui\.workspace\.navigator\.connExpanded:[0-9a-f-]{36}$/;
const CONN_EXPANDED_SCHEMA = z.boolean();

/** The value schema for a key the renderer may write, or null when it may not. */
export function prefSetSchema(key: string): z.ZodType | null {
  if (CONN_EXPANDED_KEY.test(key)) return CONN_EXPANDED_SCHEMA;
  return SET_SCHEMAS.get(key) ?? null;
}

/** Readable = writable, plus the plaintext switch the connection form displays. */
export function isPrefGetKey(key: string): boolean {
  return key === PLAINTEXT_FALLBACK_KEY || prefSetSchema(key) !== null;
}
