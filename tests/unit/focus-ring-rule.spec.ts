import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * W15 §5 — the advanced-row disclosure trigger's `:focus-visible`
 * style, asserted rather than inspected.
 *
 * The real proof is in `tests/e2e/w15-advanced-row-sort-limit.e2e.ts`, which
 * keyboard-focuses the trigger under Chromium and reads the computed outline
 * back. This file covers the half of the wiring that a jsdom component test
 * structurally cannot: jsdom applies no stylesheet, so a component test can
 * only see that the *class* is on the element — deleting the rule it names
 * leaves every vitest project green, and e2e runs only on PRs targeting
 * `main`.
 *
 * So: read both ends and assert they still refer to each other. Crude, but it
 * is the one check that fails if either side is renamed or removed, which is
 * the actual failure mode (an inline style cannot express `:focus-visible`,
 * so the rule will always live one file away from its user).
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('the advanced-row disclosure trigger has a defined focus-visible style', () => {
  it('names a class that index.css actually defines a :focus-visible rule for', () => {
    const queryBar = read('src/pages/Workspace/QueryBar.tsx');

    // The trigger is the element wired to the advanced region. Search
    // *backwards* from that anchor for the nearest `className` rather than
    // forwards from a fixed offset — a fixed window slides onto an unrelated
    // element the moment someone adds a comment above the trigger, and that
    // failure mode is a false pass.
    const anchor = queryBar.indexOf('aria-controls="query-bar-advanced"');
    expect(anchor, 'no element controls #query-bar-advanced').toBeGreaterThan(-1);
    const before = queryBar.slice(0, anchor);
    const className = /className="([\w-]+)"(?![\s\S]*className=")/.exec(before)?.[1];
    expect(className, 'the disclosure trigger carries no className').toBeTruthy();

    const css = read('src/index.css');
    const rule = new RegExp(`\\.${className}:focus-visible\\s*\\{([^}]*)\\}`).exec(css);
    expect(rule, `index.css defines no :focus-visible rule for .${className}`).toBeTruthy();

    // A rule that sets nothing visible would satisfy the regex above and
    // still leave the trigger with no ring.
    expect(rule![1]).toMatch(/outline:\s*\d+px\s+solid/);
  });
});
