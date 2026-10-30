import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// The renderer has a channel to the main log (`logToMain` / `logFailure`), so a
// rejection or a failed await must not vanish. ESLint's no-empty accepts a
// comment-only block and has no rule for `.catch(() => {})`, so this walks the
// syntax tree itself.

// A synchronous catch around a parser that falls back to a lenient path is
// control flow, not a lost failure, so only a try block that awaits is checked.
// Each entry below is a call that is dropped on purpose, with the reason.
const ALLOWED: Record<string, string> = {
  'src/features/fieldSuggestions/useSuggestions.ts':
    'the sync pass runs async sources only to find out they are async; the effect runs them again and owns the outcome',
};

function containsAwait(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isAwaitExpression(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isEmptyHandler(arg: ts.Expression): boolean {
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const body = arg.body;
    if (ts.isBlock(body)) return body.statements.length === 0;
    return ts.isVoidExpression(body) || (ts.isIdentifier(body) && body.text === 'undefined');
  }
  return false;
}

function findSwallowedErrors(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const at = (n: ts.Node, what: string) =>
    hits.push(`${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${what}`);
  const visit = (n: ts.Node) => {
    if (ts.isCatchClause(n) && n.block.statements.length === 0) {
      const tryBlock = (n.parent as ts.TryStatement).tryBlock;
      if (containsAwait(tryBlock)) at(n, 'empty catch around an await');
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'catch' &&
      n.arguments.length === 1
    ) {
      const arg = n.arguments[0]!;
      if (isEmptyHandler(arg)) at(n, '.catch with an empty handler');
      else if (ts.isPropertyAccessExpression(arg) && arg.expression.getText(sf) === 'console') {
        at(n, '.catch(console.*) never reaches the main log');
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe('swallowed errors in src/', () => {
  it('finds no empty catch around an await and no empty or console-only .catch', () => {
    const hits = sourceFiles('src')
      .filter((f) => !(f.split(path.sep).join('/') in ALLOWED))
      .flatMap((f) => findSwallowedErrors(f, readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('flags each swallowing shape', () => {
    const src = [
      'async function f() {',
      '  try { await g(); } catch { /* ignore */ }',
      '  g().catch(() => {});',
      '  g().catch(() => { /* ok */ });',
      '  g().catch(() => undefined);',
      '  g().catch(() => void 0);',
      '  g().catch(console.warn);',
      '}',
    ].join('\n');
    expect(findSwallowedErrors('x.ts', src).map((h) => h.split(' ')[0])).toEqual([
      'x.ts:2',
      'x.ts:3',
      'x.ts:4',
      'x.ts:5',
      'x.ts:6',
      'x.ts:7',
    ]);
  });

  it('accepts a handler that does something, and a synchronous parse fallback', () => {
    const src = [
      'async function f() {',
      '  try { await g(); } catch (e) { log(e); }',
      '  g().catch((e) => log(e));',
      '  try { JSON.parse(s); } catch { /* lenient path */ }',
      '}',
    ].join('\n');
    expect(findSwallowedErrors('x.ts', src)).toEqual([]);
  });
});
