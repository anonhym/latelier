// Shell Syntax reaches the write surfaces.
//
// ADR 0004 held the write surfaces strict on the grounds that a
// misread value here corrupts a document rather than returning wrong rows.
// What makes the leniency safe is the ADR's *other* rule — a destructive
// operation always shows the Canonical EJSON it will actually run — so the
// assertions below are as much about what is on screen before the write as
// about the write itself.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { InsertDrawer } from '../../src/pages/Workspace/InsertDrawer';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function renderInsert(): Array<{ docJson?: string; docsJson?: string }> {
  const calls: Array<{ docJson?: string; docsJson?: string }> = [];
  installAtelierMock({
    doc: {
      insert: async (input) => {
        calls.push(input as { docJson: string });
        return { insertedId: '1' };
      },
      insertMany: async (input) => {
        calls.push(input as { docsJson: string });
        return { insertedCount: 2, insertedIds: ['1', '2'] };
      },
    },
  });
  render(
    <InsertDrawer
      collection="coll"
      connectionId="c1"
      dbName="db"
      onClose={() => undefined}
      onInserted={() => undefined}
    />,
  );
  return calls;
}

function insertBuffer(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('InsertDrawer — Shell Syntax input', () => {
  it('rewrites Shell Syntax in the box, on blur', () => {
    renderInsert();

    fireEvent.change(insertBuffer(), { target: { value: "{name: 'foo', at: ISODate('2026-01-01T00:00:00.000Z')}" } });
    fireEvent.blur(insertBuffer());

    expect(insertBuffer().value).toBe(
      '{"name": "foo", "at": {"$date":"2026-01-01T00:00:00.000Z"}}',
    );
  });

  it('inserts Canonical EJSON even when Insert is pressed before any blur', async () => {
    const calls = renderInsert();

    fireEvent.change(insertBuffer(), { target: { value: "{name: 'foo',}" } });
    fireEvent.click(screen.getByRole('button', { name: /^Insert/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // No spacing: the payload is re-stringified from the parsed value
    // (a review finding), so the wire carries normalized Canonical EJSON whatever
    // the user typed. The repair's in-place spacing survives where it is
    // meant to — in the buffer, asserted below — not on the wire.
    expect(calls[0]!.docJson).toBe('{"name":"foo"}');
    expect(insertBuffer().value).toBe('{"name": "foo"}');
  });

  it('still classifies an array as insertMany after the repair', async () => {
    // The transform runs in front of `classifyInsertPayload`, not inside it,
    // so the array-versus-document rule is unchanged and still reads
    // Canonical EJSON.
    const calls = renderInsert();

    fireEvent.change(insertBuffer(), { target: { value: "[{name: 'a'}, {name: 'b'},]" } });
    fireEvent.blur(insertBuffer());

    expect(screen.getByRole('button', { name: 'Insert 2 documents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Insert 2 documents' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // Normalized on the wire — see the note on the previous case.
    expect(calls[0]!.docsJson).toBe('[{"name":"a"},{"name":"b"}]');
    expect(insertBuffer().value).toBe('[{"name": "a"}, {"name": "b"}]');
  });

  it('names the token it cannot read instead of saying "Invalid EJSON"', () => {
    renderInsert();

    fireEvent.change(insertBuffer(), { target: { value: '{name: nope}' } });

    expect(screen.getByText(/Line 1, column 8: /)).toBeTruthy();
    expect(screen.queryByText('Invalid EJSON')).toBeNull();
  });

  // A rejected regex flag is a different refusal from a bare word: the flag
  // allowlist in `regexText` throws after the literal has already parsed, so
  // it is the one refusal a purely syntactic reading would let through. The
  // reason has to name the flag, because "Invalid EJSON" over a valid regex
  // literal tells the user nothing about which character to delete.
  it('names the rejected regex flag rather than falling back to "Invalid EJSON"', () => {
    renderInsert();

    fireEvent.change(insertBuffer(), { target: { value: '{name: /^a/g}' } });

    expect(
      screen.getByText(
        'Line 1, column 8: The regular expression flag "g" (global) has no MongoDB equivalent. Remove it.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Invalid EJSON')).toBeNull();
    expect(screen.getByRole('button', { name: /^Insert/ })).toHaveProperty('disabled', true);
  });

  it('does not insert anything it could not read', async () => {
    const calls = renderInsert();

    fireEvent.change(insertBuffer(), { target: { value: '{name: nope}' } });
    fireEvent.click(screen.getByRole('button', { name: /^Insert/ }));

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });
});
