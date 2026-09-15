// Main-process twin of `src/utils/ownProperty.ts` — electron/** can't import from src/,
// and shared/ is types-only, so this small pure module duplicates instead.
// Plain `{}` maps keyed by user-controlled strings collide with Object.prototype
// members (constructor, toString, __proto__, ...). `Object.create(null)` doesn't
// fix it either: consumers rebuild via `{ ...map, [key]: value }`, and a spread
// always produces an ordinary object, losing the null prototype on the next write.
// Route every write through this instead.

/**
 * `map['__proto__'] = value` calls Object.prototype's accessor setter instead
 * of creating an own key, and silently no-ops for a non-object value.
 * `defineProperty` always creates an own key regardless of the name.
 */
export function ownSet<T>(map: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
}
