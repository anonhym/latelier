/**
 * The pure half of X29: reading what a 2026-07-28 request carries (client
 * info, client capabilities, the answer to the one question the app asks) and
 * writing that question. Everything here arrives from the Agent client, so
 * nothing is trusted to have the shape the specification describes.
 */

/** The `inputRequests` key of the one question X29 §4 asks. */
export const OPEN_CONNECTION_KEY = 'openConnection';

/** A Connection name the user chose, cut before it goes into a message the Agent's host shows. */
export const MAX_PROMPT_NAME = 256;

/** What the client calls itself goes into Agent Read Log rows and so into the log screen: a cut, because the client chooses it. */
export const MAX_CLIENT_INFO_CHARS = 128;

const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';

export interface ClientInfo {
  clientName: string | null;
  clientVersion: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string the client sent, cut; anything else is recorded as absent. */
export function cutClientInfo(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, MAX_CLIENT_INFO_CHARS) : null;
}

/** Name and version from an `initialize`-scoped `clientInfo` or a per-request envelope's. */
export function clientInfoOf(info: unknown): ClientInfo {
  if (!isRecord(info)) return { clientName: null, clientVersion: null };
  return { clientName: cutClientInfo(info.name), clientVersion: cutClientInfo(info.version) };
}

/** The client info a 2026-07-28 request carries in its envelope. */
export function envelopeClientInfo(envelope: unknown): ClientInfo {
  return clientInfoOf(isRecord(envelope) ? envelope[CLIENT_INFO_META_KEY] : undefined);
}

/**
 * Whether the request's declared capabilities cover a form-mode elicitation.
 * The SDK's own rule, which it does not export: `elicitation.form`, or a bare
 * `elicitation` naming neither `form` nor `url` (a declaration from before
 * modes existed, which meant form). Asking a client this returns false for
 * would make the SDK refuse the answer after its Read Log row was written.
 */
export function acceptsFormElicitation(envelope: unknown): boolean {
  if (!isRecord(envelope)) return false;
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY];
  if (!isRecord(capabilities)) return false;
  const elicitation = capabilities.elicitation;
  if (!isRecord(elicitation)) return false;
  return elicitation.form !== undefined || elicitation.url === undefined;
}

/**
 * Where a call stands on the question: not asked yet, accepted, or answered
 * any other way. A malformed answer, or one the SDK dropped as malformed,
 * counts as answered: one call never asks twice.
 */
export type OpenConnectionAnswer = 'none' | 'accept' | 'refused';

export function openConnectionAnswer(
  inputResponses: Record<string, unknown> | undefined,
  droppedKeys: readonly string[] | undefined,
): OpenConnectionAnswer {
  if (droppedKeys?.includes(OPEN_CONNECTION_KEY)) return 'refused';
  if (inputResponses === undefined || !Object.hasOwn(inputResponses, OPEN_CONNECTION_KEY)) return 'none';
  const answer = inputResponses[OPEN_CONNECTION_KEY];
  return isRecord(answer) && answer.action === 'accept' ? 'accept' : 'refused';
}

/** The question, in the app's words. Only the name the user gave the Connection goes in: nothing from the database. */
export function openConnectionMessage(connectionName: string): string {
  return `The Connection "${connectionName.slice(0, MAX_PROMPT_NAME)}" is closed. Open it in L'Atelier, then accept to continue.`;
}
