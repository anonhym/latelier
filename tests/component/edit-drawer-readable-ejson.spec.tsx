// UX review §4.1 — the edit drawer stops showing wire-format sentinels.
//
// `tests/unit/ejson-readable.spec.ts` owns the round-trip property. What only
// the drawer can show is that the buffer a user actually sees is the readable
// form, and that saving it unedited still writes the original BSON.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { ObjectId, Long, Int32, Decimal128 } from 'bson';
import { EditDrawer } from '../../src/pages/Workspace/EditDrawer';
import { ejsonParse, ejsonStringify } from '../../src/utils/ejson';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function renderDrawer(doc: unknown): { calls: Array<{ docJson: string }> } {
  const calls: Array<{ docJson: string }> = [];
  installAtelierMock({
    doc: {
      replace: async (input) => {
        calls.push(input as { docJson: string });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
  });
  render(
    <EditDrawer
      connectionId="c1"
      dbName="db"
      collection="coll"
      doc={doc}
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
  );
  return { calls };
}

function buffer(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

describe('EditDrawer — readable EJSON in the buffer', () => {
  it('shows an int32 as a plain number, not a string in a wrapper', () => {
    // The review's example: changing an age from 67 to 68 used to mean editing
    // a string inside `{"$numberInt": "67"}`.
    renderDrawer({ _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'), age: new Int32(67) });

    expect(buffer().value).toContain('"age": 67');
    expect(buffer().value).not.toContain('$numberInt');
  });

  it('shows a date as an ISO string, not epoch milliseconds', () => {
    renderDrawer({
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      createdAt: new Date('2025-01-31T00:48:48.524Z'),
    });

    expect(buffer().value).toContain('"$date": "2025-01-31T00:48:48.524Z"');
    expect(buffer().value).not.toContain('1738284528524');
  });

  it('collapses an array of ints to one line of numbers', () => {
    renderDrawer({
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      rgb: [new Int32(52), new Int32(35), new Int32(88)],
    });

    expect(JSON.parse(buffer().value).rgb).toEqual([52, 35, 88]);
  });

  it('keeps an int64 as a sentinel rather than showing a rounded number', () => {
    // The line this feature will not cross. bson's relaxed mode renders this
    // as 9007199254740992 — the user would edit, and then save, a value that
    // was never in the document.
    renderDrawer({
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      big: Long.fromString('9007199254740993'),
    });

    expect(buffer().value).toContain('9007199254740993');
    expect(buffer().value).not.toContain('9007199254740992');
  });

  it('keeps a Decimal128 as a sentinel — money has no lossless JSON form', () => {
    renderDrawer({
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      price: Decimal128.fromString('19.99'),
    });

    expect(buffer().value).toContain('$numberDecimal');
  });

  it('saving the buffer untouched writes back the identical BSON', async () => {
    // The claim that makes a relaxed buffer safe to *edit* rather than merely
    // display: nothing was unwrapped that re-parses differently, so an
    // unedited save is a no-op on every field's type and value.
    const doc = {
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      age: new Int32(67),
      ratio: 1.5,
      big: Long.fromString('9007199254740993'),
      price: Decimal128.fromString('19.99'),
      createdAt: new Date('2025-01-31T00:48:48.524Z'),
      tags: [new Int32(1), 'two'],
    };
    const { calls } = renderDrawer(doc);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // The payload itself, NOT a re-canonicalized reading of it.
    //
    // This assertion used to run `ejsonStringify(ejsonParse(...))` over the
    // left side too, which made it blind to the thing it looks like it
    // tests: the drawer was submitting the readable buffer verbatim, so a
    // date crossed IPC as `{"$date":"<ISO>"}` and an int32 as a bare number.
    // Both revive to the identical BSON, so nothing was written wrong — but
    // Relaxed EJSON on a wire that is contracted as Canonical is drift, and
    // re-canonicalizing the actual value is exactly how a test fails to see
    // it.
    expect(calls[0]!.docJson).toBe(ejsonStringify(doc));
  });

  it('submits canonical sentinels, not the readable spellings on screen', async () => {
    // The narrow version of the assertion above, named after what it guards
    // so a future reader does not have to diff two long EJSON strings to see
    // which half of it broke.
    const doc = {
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      age: new Int32(67),
      createdAt: new Date('2025-01-31T00:48:48.524Z'),
    };
    const { calls } = renderDrawer(doc);

    // What the user reads is the relaxed form…
    expect(buffer().value).toContain('"$date": "2025-01-31T00:48:48.524Z"');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // …and what crosses IPC is not.
    expect(calls[0]!.docJson).toContain('"$date":{"$numberLong":"1738284528524"}');
    expect(calls[0]!.docJson).toContain('"age":{"$numberInt":"67"}');
    expect(calls[0]!.docJson).not.toContain('2025-01-31T00:48:48.524Z');
    // And it still means the same document.
    expect(ejsonParse<{ createdAt: Date }>(calls[0]!.docJson).createdAt).toEqual(doc.createdAt);
  });

  it('an edit made in the readable form lands as the right BSON type', async () => {
    const doc = { _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'), age: new Int32(67) };
    const { calls } = renderDrawer(doc);

    // Anchored on the field: a bare '67' also appears inside the _id hex.
    fireEvent.change(buffer(), { target: { value: buffer().value.replace('"age": 67', '"age": 68') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(ejsonStringify(ejsonParse(calls[0]!.docJson))).toContain('"age":{"$numberInt":"68"}');
  });
});
