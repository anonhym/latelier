import { api } from '../api/atelier';
import type { RendererLogInput, RendererLogSource } from '@shared/ipc';

// Main refuses a longer message or stack outright, so both are cut here
// rather than losing the whole line to the cap.
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

let fallbackUsed = false;

/**
 * Sends one line to main's log file (`app:log`). Returns nothing and never
 * throws or rejects: it runs inside the global `error` and
 * `unhandledrejection` handlers, where a failure of its own would raise the
 * very event being handled and loop.
 */
export function logToMain(
  level: RendererLogInput['level'],
  message: string,
  source: RendererLogSource,
  stack?: string,
): void {
  const input: RendererLogInput = { level, message: message.slice(0, MAX_MESSAGE), source };
  if (stack !== undefined) input.stack = stack.slice(0, MAX_STACK);
  try {
    // `api` throws synchronously when the bridge is missing; the call itself
    // rejects when main refuses or is gone.
    api.app.log(input).catch(fallBack);
  } catch (err) {
    fallBack(err);
  }
}

// When main cannot take the line, devtools is the only place left to say so.
// Once only, and through console.warn rather than logToMain: a bridge that
// stays broken would otherwise warn for every line, or feed itself.
function fallBack(err: unknown): void {
  if (fallbackUsed) return;
  fallbackUsed = true;
  console.warn('[rendererLog] could not send a log line to main; later failures are not reported', err);
}

/** A thrown value as a message and, for an Error, its stack. */
export function describeError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  try {
    return { message: String(value) };
  } catch {
    // String() throws for an object with no usable toString (a null-prototype
    // object, say); the line is still worth sending without the value.
    return { message: 'a value that cannot be printed was thrown' };
  }
}

/** Forwards uncaught errors and unhandled rejections to main's log. Install once, before the app renders. */
export function installGlobalErrorLogging(target: Window = window): void {
  target.addEventListener('error', (event) => {
    const { message, stack } = describeError(event.error ?? event.message);
    logToMain('error', message, 'window.error', stack);
  });
  target.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = describeError(event.reason);
    logToMain('error', message, 'unhandledrejection', stack);
  });
}
