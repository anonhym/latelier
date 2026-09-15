// Shell Syntax reaches the write surfaces.
//
// ADR 0004 held `EditDrawer` and `InsertDrawer` strict on the grounds that a
// misread value here corrupts a document rather than returning wrong rows.
// What makes the leniency safe is the ADR's *other* rule — a destructive
// operation always shows the Canonical EJSON it will actually run — so the
// assertions below are as much about what is on screen before the write as
// about the write itself.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { ObjectId } from 'bson';
import { EditDrawer } from '../../src/pages/Workspace/EditDrawer';
import { InsertDrawer } from '../../src/pages/Workspace/InsertDrawer';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const ID = new ObjectId('64a7f0e1b1d4e8f2c3a45678');

function renderEdit(): { replaced: Array<{ docJson: string }>; updated: Array<{ updateJson: string }> } {
  const replaced: Array<{ docJson: string }> = [];
  const updated: Array<{ updateJson: string }> = [];
  installAtelierMock({
    doc: {
      replace: async (input) => {
        replaced.push(input as { docJson: string });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      updateOne: async (input) => {
        updated.push(input as { updateJson: string });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
  });
  render(
    <EditDrawer
      connectionId="c1"
      dbName="db"
      collection="coll"
      doc={{ _id: ID, name: 'foo' }}
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
  );
  return { replaced, updated };
}

function editBuffer(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('EditDrawer — Shell Syntax input', () => {
  it('rewrites Shell Syntax to Canonical EJSON in the box, on blur', () => {
    renderEdit();

    fireEvent.change(editBuffer(), { target: { value: "{_id: ObjectId('64a7f0e1b1d4e8f2c3a45678'), name: 'foo'}" } });
    fireEvent.blur(editBuffer());

    expect(editBuffer().value).toBe(
      '{"_id": {"$oid":"64a7f0e1b1d4e8f2c3a45678"}, "name": "foo"}',
    );
  });

  it('opens Save for a buffer that is only Shell Syntax, before any commit', () => {
    // Without this the feature is unusable: `isValidEjson` says no, Save is
    // disabled, and a disabled button does not take the click that would
    // blur the textarea and fix it.
    renderEdit();

    fireEvent.change(editBuffer(), { target: { value: "{name: 'foo'}" } });

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
    // …and the enabling is *derived per render*, not the side effect of a
    // commit that already rewrote the buffer. The distinction is the whole
    // asymmetry with the Filter Bar, which keeps Run gated until a commit
    // fires, so a seam that unified the two would have to break one of them.
    expect(editBuffer().value).toBe("{name: 'foo'}");
  });

  it('writes Canonical EJSON even when Save is pressed before any blur', async () => {
    const { replaced } = renderEdit();

    fireEvent.change(editBuffer(), { target: { value: "{_id: ObjectId('64a7f0e1b1d4e8f2c3a45678'), name: 'bar'}" } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(replaced).toHaveLength(1));
    expect(replaced[0]!.docJson).toContain('"$oid"');
    expect(replaced[0]!.docJson).not.toContain('ObjectId(');
    // …and the user is looking at what was written, not at what they typed.
    expect(editBuffer().value).toContain('"$oid"');
  });

  // The ordinary order of events — the user tabs out, *then* saves — as one
  // sequence rather than as two tests that each cover half of it. The repair
  // has already committed by the time Save runs, so the second
  // `repairOnCommit` sees text that parses strictly and returns `unchanged`;
  // this is what proves the second call is idempotent rather than merely
  // harmless when it is the only one.
  it('saves the repaired text after a blur has already committed it', async () => {
    const { replaced } = renderEdit();

    fireEvent.change(editBuffer(), { target: { value: '{age: 1}' } });
    fireEvent.blur(editBuffer());

    expect(editBuffer().value).toBe('{"age": 1}');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(replaced).toHaveLength(1));

    // Not the buffer's own text: the replace path re-stringifies the parsed
    // value, so the wire carries normalized Canonical EJSON with the `_id` the
    // buffer no longer mentions re-injected from the original document.
    expect(replaced[0]!.docJson).toBe(
      '{"age":{"$numberInt":"1"},"_id":{"$oid":"64a7f0e1b1d4e8f2c3a45678"}}',
    );
    // The repaired text — never the Shell Syntax — is what stays on screen.
    expect(editBuffer().value).toBe('{"age": 1}');
  });

  it('carries the transform through the $set path too', async () => {
    const { updated } = renderEdit();

    fireEvent.click(screen.getByRole('button', { name: 'Update fields ($set)' }));
    fireEvent.change(editBuffer(), { target: { value: "{status: 'active',}" } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply update' }));

    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]!.updateJson).toBe('{"$set":{"status":"active"}}');
  });

  it('leaves text it cannot read exactly as typed, and names the reason', () => {
    renderEdit();

    fireEvent.change(editBuffer(), { target: { value: '{status: active}' } });
    fireEvent.blur(editBuffer());

    expect(editBuffer().value).toBe('{status: active}');
    const notice = screen.getByRole('alert').textContent ?? '';
    expect(notice).toContain('active');
    expect(notice).toMatch(/^Line 1, column 10: /);
  });

  it('does not write anything it could not read', async () => {
    const { replaced } = renderEdit();

    fireEvent.change(editBuffer(), { target: { value: '{status: active}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await new Promise((r) => setTimeout(r, 20));
    expect(replaced).toHaveLength(0);
  });

  it('leaves text that is already Canonical EJSON byte-identical', () => {
    renderEdit();
    const HAND_ARRANGED = '{\n  "_id": {"$oid":"64a7f0e1b1d4e8f2c3a45678"},\n  "name":   "foo"\n}';

    fireEvent.change(editBuffer(), { target: { value: HAND_ARRANGED } });
    fireEvent.blur(editBuffer());

    expect(editBuffer().value).toBe(HAND_ARRANGED);
  });
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
