// `QueryExpandModal` runs the Filter Bar's repair/validate pipeline twice over,
// at two different moments, and until now had no test file at all.
//
// `formatForDisplay` repairs once on mount purely to pretty-print the seed, and
// `apply` repairs again against whatever the user has since typed. The two are
// not interchangeable: the first discards its commit callback because there is
// no state to write into yet, and the second is the only one whose text reaches
// `onApply`. Both are asserted separately below for that reason.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import { QueryExpandModal } from '../../src/pages/Workspace/QueryExpandModal';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function renderModal(queryRaw: string) {
  const applied: string[] = [];
  installAtelierMock({});
  render(
    <QueryExpandModal
      queryRaw={queryRaw}
      onApply={(next) => applied.push(next)}
      onClose={() => undefined}
    />,
  );
  return { applied };
}

const draft = () => screen.getByTestId('query-expand-textarea') as HTMLTextAreaElement;
const applyButton = () => screen.getByTestId('query-expand-apply');

describe('QueryExpandModal — Shell Syntax', () => {
  it('opens seeded with a pretty-printed repair of a Shell Syntax filter', () => {
    // The point of the popup is room to read, so the seed is re-indented as
    // well as repaired — the small bar's single line is not what should
    // greet the user here.
    renderModal('{age: {$gt: 60}}');

    expect(draft().value).toBe('{\n  "age": {\n    "$gt": 60\n  }\n}');
  });

  // The seed path is *best-effort* and the apply path is not. A filter the
  // transform cannot read still has to open, showing exactly what the small bar
  // showed, rather than erroring on the way in — the user opened the popup to
  // fix it.
  it('opens text it cannot repair exactly as it stands, with no error', () => {
    renderModal('{name: /^acme/g}');

    expect(draft().value).toBe('{name: /^acme/g}');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Typed fresh rather than applied straight from the seed: `formatForDisplay`
  // has already canonicalized the seed, so applying it unedited exercises the
  // `unchanged` branch and would pin nothing about the repair.
  it('repairs on Apply and hands onApply the Canonical EJSON', () => {
    const { applied } = renderModal('{}');

    fireEvent.change(draft(), {
      target: { value: "{status: 'active', n: NumberLong('9007199254740993')}" },
    });
    fireEvent.click(applyButton());

    // 9007199254740993 is past 2^53, so a transform that evaluated the AST
    // instead of splicing source spans would hand back …992 here.
    expect(applied).toEqual([
      '{"status": "active", "n": {"$numberLong":"9007199254740993"}}',
    ]);
    // And the box shows what was applied, not what was typed.
    expect(draft().value).toBe('{"status": "active", "n": {"$numberLong":"9007199254740993"}}');
  });

  it('shows the transform’s own reason for text it cannot repair, and applies nothing', () => {
    const { applied } = renderModal('{}');

    fireEvent.change(draft(), { target: { value: '{name: /^acme/g}' } });
    fireEvent.click(applyButton());

    expect(screen.getByRole('alert').textContent).toBe(
      'Line 1, column 8: The regular expression flag "g" (global) has no MongoDB equivalent. Remove it.',
    );
    expect(applied).toEqual([]);
    // Left exactly as typed — a refusal never rewrites the buffer.
    expect(draft().value).toBe('{name: /^acme/g}');
  });

  /**
   * The one branch of `refusalMessage`'s blank-text suppression that no other
   * surface reaches.
   *
   * `repairToCanonicalEjson('')` fails with "The input is empty.", and
   * `refusalMessage` swallows that because a blank sort and a blank projection
   * are legitimate "no sort" / "no projection" states. A blank *filter* is not:
   * `filterProblem` speaks instead.
   *
   * Do not "correct" this to the document-shape message, which reads better
   * over an empty box. `filterProblem` tests `isValidEjson` first and returns
   * on it, and `''` is not valid EJSON — so blank input never reaches the
   * shape branch at all. That branch is for text that parses and is not a
   * document, like `[1, 2]`. Better copy for an empty filter is a change to
   * `filterProblem`, not to this assertion.
   */
  it('refuses a blank filter with filterProblem’s message, not "The input is empty."', () => {
    const { applied } = renderModal('{}');

    fireEvent.change(draft(), { target: { value: '   ' } });
    fireEvent.click(applyButton());

    expect(screen.getByRole('alert').textContent).toBe(
      'Can\'t parse this filter. Expected EJSON like { "status": "active" }.',
    );
    expect(applied).toEqual([]);
  });
});
