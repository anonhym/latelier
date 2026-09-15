import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectId, Int32 } from 'bson';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { InsertDrawer } from '../../src/pages/Workspace/InsertDrawer';
import { stripIdForDuplicate } from '../../src/pages/Workspace/views/docId';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * T2.6 — `initialDocJson` lets "Duplicate document" (Workspace.tsx's
 * `openDuplicate`) pre-fill the Insert drawer with the source document's
 * EJSON minus `_id`, without changing the drawer's default empty-document
 * behavior for the ordinary "Insert" toolbar action.
 */
describe('InsertDrawer — initialDocJson (T2.6, Duplicate document)', () => {
  it('defaults the textarea to "{}" when no initialDocJson is given', () => {
    installAtelierMock({});
    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('{}');
  });

  it('seeds the textarea from initialDocJson', () => {
    installAtelierMock({});
    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={'{\n  "name": "alpha"\n}'}
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('"name": "alpha"');
  });

  it('the seeded textarea is still user-editable before inserting', () => {
    installAtelierMock({});
    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={'{"name":"alpha"}'}
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
  });
});

// T2.7 — a top-level JSON array routes to doc:insertMany; a single object
// keeps using doc:insert unchanged (regression guard).
describe('InsertDrawer — array insert routes to doc:insertMany (T2.7)', () => {
  it('calls doc.insertMany (not doc.insert) for an array payload and closes on success', async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 2, insertedIds: [] });
    const insert = vi.fn().mockResolvedValue({ insertedId: 'x' });
    installAtelierMock({ doc: { insertMany, insert } });
    const onClose = vi.fn();
    const onInserted = vi.fn();
    const docsJson = '[{"a":1},{"b":2}]';

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={docsJson}
        onClose={onClose}
        onInserted={onInserted}
      />,
    );

    const button = screen.getByRole('button', { name: /insert/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();

    await waitFor(() => expect(insertMany).toHaveBeenCalledTimes(1));
    // Canonical, not the literal `docsJson` above (a review finding): the drawer
    // now re-stringifies the parsed payload, so a bare `1` leaves as
    // `{"$numberInt":"1"}`. Same Int32 either way — main's `safeEjsonParse`
    // hands a bare JSON number to the driver, which serializes an in-range
    // integer as Int32 — so this is a change of spelling on the wire, not of
    // the document that gets written.
    expect(insertMany).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'app',
      collection: 'orders',
      docsJson: '[{"a":{"$numberInt":"1"}},{"b":{"$numberInt":"2"}}]',
    });
    expect(insert).not.toHaveBeenCalled();
    await waitFor(() => expect(onInserted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still calls doc.insert (not doc.insertMany) for a single-object payload', async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1, insertedIds: [] });
    const insert = vi.fn().mockResolvedValue({ insertedId: 'x' });
    installAtelierMock({ doc: { insertMany, insert } });
    const onClose = vi.fn();
    const onInserted = vi.fn();
    const docJson = '{"a":1}';

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={docJson}
        onClose={onClose}
        onInserted={onInserted}
      />,
    );

    screen.getByRole('button', { name: /insert/i }).click();

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    // Canonical — see the note on the insertMany case above.
    expect(insert).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'app',
      collection: 'orders',
      docJson: '{"a":{"$numberInt":"1"}}',
    });
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('disables Insert and shows an inline error for an empty array, making no IPC call', () => {
    const insertMany = vi.fn();
    const insert = vi.fn();
    installAtelierMock({ doc: { insertMany, insert } });

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson="[]"
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );

    const button = screen.getByRole('button', { name: /insert/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(insert).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('disables Insert and shows an inline error for an array with a non-object item, making no IPC call', () => {
    const insertMany = vi.fn();
    const insert = vi.fn();
    installAtelierMock({ doc: { insertMany, insert } });

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={'[{"a":1},"oops"]'}
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );

    const button = screen.getByRole('button', { name: /insert/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(insert).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('on a partial-failure (E11000 with details.insertedCount), keeps the drawer open, shows a partial-insert banner, and fires onPartialInsert instead of onClose/onInserted', async () => {
    const insertMany = vi.fn().mockRejectedValue({
      code: 'CONFLICT',
      message: 'E11000 duplicate key error',
      details: { insertedCount: 1 },
    });
    installAtelierMock({ doc: { insertMany } });
    const onClose = vi.fn();
    const onInserted = vi.fn();
    const onPartialInsert = vi.fn();
    const docsJson = '[{"_id":2},{"_id":1},{"_id":3}]';

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={docsJson}
        onClose={onClose}
        onInserted={onInserted}
        onPartialInsert={onPartialInsert}
      />,
    );

    screen.getByRole('button', { name: /insert/i }).click();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 of 3');
    expect(onClose).not.toHaveBeenCalled();
    expect(onInserted).not.toHaveBeenCalled();
    expect(onPartialInsert).toHaveBeenCalledTimes(1);
  });

  it('on a total failure (no insertedCount in details), keeps the existing single-doc behavior: banner shown, no refresh, drawer stays open', async () => {
    const insertMany = vi.fn().mockRejectedValue({
      code: 'VALIDATION',
      message: 'docsJson must be an array of documents',
    });
    installAtelierMock({ doc: { insertMany } });
    const onClose = vi.fn();
    const onInserted = vi.fn();
    const onPartialInsert = vi.fn();
    const docsJson = '[{"a":1},{"b":2}]';

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={docsJson}
        onClose={onClose}
        onInserted={onInserted}
        onPartialInsert={onPartialInsert}
      />,
    );

    screen.getByRole('button', { name: /insert/i }).click();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('docsJson must be an array of documents');
    expect(onClose).not.toHaveBeenCalled();
    expect(onInserted).not.toHaveBeenCalled();
    expect(onPartialInsert).not.toHaveBeenCalled();
  });
});

/**
 * Review finding — the write payload must be Canonical EJSON.
 *
 * "Duplicate document" seeds this drawer from `stripIdForDuplicate`, which
 * renders the *readable* form: a date as `{"$date":"<ISO>"}` and an
 * int32 as a bare number. Inserted unedited, that Relaxed spelling used to
 * reach `doc:insert` verbatim. It revives to the identical BSON — the whole
 * guarantee of `ejsonStringifyReadable` — so no document was ever written
 * wrong, but the wire format is contracted as Canonical and the helper's own
 * doc comment says nothing it renders crosses the boundary.
 *
 * Driven through the real `stripIdForDuplicate` rather than a hand-written
 * seed string, because the seam under test is Workspace's `openDuplicate` →
 * `InsertDrawer`, and a literal would let the two drift apart silently.
 */
describe('InsertDrawer — the write payload is Canonical EJSON', () => {
  it('canonicalizes a readable duplicate seed before it crosses IPC', async () => {
    const insert = vi.fn().mockResolvedValue({ insertedId: 'new' });
    installAtelierMock({ doc: { insert } });

    const seed = stripIdForDuplicate({
      _id: new ObjectId('64a7f0e1b1d4e8f2c3a45678'),
      age: new Int32(67),
      createdAt: new Date('2025-01-31T00:48:48.524Z'),
    });
    // Precondition, not the assertion: the seed really is the readable form.
    expect(seed).toContain('"$date": "2025-01-31T00:48:48.524Z"');
    expect(seed).toContain('"age": 67');

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={seed}
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );
    screen.getByRole('button', { name: /insert/i }).click();

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    const { docJson } = insert.mock.calls[0]![0] as { docJson: string };
    expect(docJson).toContain('"createdAt":{"$date":{"$numberLong":"1738284528524"}}');
    expect(docJson).toContain('"age":{"$numberInt":"67"}');
    expect(docJson).not.toContain('2025-01-31T00:48:48.524Z');
    // The duplicate still drops the source _id, so Mongo assigns a fresh one.
    expect(docJson).not.toContain('_id');
  });

  it('canonicalizes an array payload on the insertMany path too', async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    installAtelierMock({ doc: { insertMany } });

    render(
      <InsertDrawer
        collection="orders"
        connectionId="c1"
        dbName="app"
        initialDocJson={'[{"createdAt": {"$date": "2025-01-31T00:48:48.524Z"}}]'}
        onClose={() => undefined}
        onInserted={() => undefined}
      />,
    );
    screen.getByRole('button', { name: /insert/i }).click();

    await waitFor(() => expect(insertMany).toHaveBeenCalledTimes(1));
    const { docsJson } = insertMany.mock.calls[0]![0] as { docsJson: string };
    expect(docsJson).toContain('{"$numberLong":"1738284528524"}');
    expect(docsJson).not.toContain('2025-01-31T00:48:48.524Z');
  });
});

/**
 * X15 T4 — the unsaved-changes guard.
 *
 * This drawer was already Mantine, which is precisely why it carried the bug
 * unnoticed: Mantine defaults `closeOnClickOutside` to `true`, so a backdrop
 * click discarded a fully-typed document exactly the way the hand-rolled
 * overlays did.
 *
 * The first test below is the ticket's mutation target.
 */

const drawer = () => screen.getByRole('dialog', { name: 'Insert document' });
const discardPrompt = () => screen.queryByRole('dialog', { name: 'Discard changes?' });
/** The overlay carries no role by design, so it has no accessible handle. */
const overlay = () => document.body.querySelector('.mantine-Drawer-overlay') as HTMLElement;
const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement;

/** Let a click's async handler settle so a *negative* assertion means something. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

function renderInsert(onClose: () => void = vi.fn(), initialDocJson?: string) {
  installAtelierMock({});
  render(
    <InsertDrawer
      collection="orders"
      connectionId="c1"
      dbName="app"
      initialDocJson={initialDocJson}
      onClose={onClose}
      onInserted={() => undefined}
    />,
  );
  return onClose;
}

describe('InsertDrawer — unsaved-changes guard (X15 T4)', () => {
  /**
   * MUTATION TARGET — delete `closeOnClickOutside={false}` from InsertDrawer
   * and the last assertion must go red: the backdrop starts routing through
   * `requestClose` and raises a prompt the user never asked for. The other two
   * assertions stay green under that mutation, which is exactly why "no prompt"
   * has to be asserted rather than "text survived".
   *
   * Do not "fix" this test into expecting a prompt. An inert backdrop is the
   * point: `closeOnClickOutside={false}` is what stops one stray click from
   * reaching the close path at all.
   */
  it('a backdrop click with a dirty buffer is inert — no close, no prompt, text intact', async () => {
    const onClose = renderInsert();
    const typed = '{"sku": "half-typed';
    fireEvent.change(textarea(), { target: { value: typed } });

    fireEvent.click(overlay());
    await settle();

    expect(textarea().value).toBe(typed);
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).toBeNull();
  });

  it('Escape with a dirty buffer prompts, and Cancel leaves the typed text intact', async () => {
    const onClose = renderInsert();
    const typed = '{"sku": "typed-by-hand"}';
    fireEvent.change(textarea(), { target: { value: typed } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(textarea().value).toBe(typed);
  });

  it('Escape with a dirty buffer closes once Discard is confirmed', async () => {
    const onClose = renderInsert();
    fireEvent.change(textarea(), { target: { value: '{"sku": "typed"}' } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closing a clean drawer from Cancel does not prompt', async () => {
    const onClose = renderInsert();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Cancel' }));
    await settle();

    expect(discardPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The Duplicate pre-fill (T2.6) opens this drawer already full of text.
   * `isDirty` is "differs from initial", never "was touched" — otherwise every
   * duplicate the user thinks better of would prompt on the way out.
   */
  it('a Duplicate pre-fill on its own is not dirty', async () => {
    const onClose = renderInsert(vi.fn(), '{"name":"alpha"}');
    expect(textarea().value).toBe('{"name":"alpha"}');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await settle();

    expect(discardPrompt()).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
