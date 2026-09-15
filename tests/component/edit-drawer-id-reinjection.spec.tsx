import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { ObjectId, Decimal128 } from 'bson';
import { EditDrawer } from '../../src/pages/Workspace/EditDrawer';
import { ejsonParse, ejsonStringify } from '../../src/utils/ejson';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

interface ReplaceCall {
  connectionId: string;
  dbName: string;
  collection: string;
  filterJson: string;
  docJson: string;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * Regression test for P0-1 (REVIEW-2026-05-12):
 *   EditDrawer's `_id` re-injection path previously used `JSON.parse` and
 *   `JSON.stringify` on a buffer that contains canonical EJSON. That
 *   round-trip would lose BSON instance identity for non-`_id` typed
 *   fields, so any consumer relying on `instanceof ObjectId` / `Date` /
 *   `Decimal128` could break. The fix uses `ejsonParse` / `ejsonStringify`
 *   so the submitted document is normalized canonical EJSON that decodes
 *   back to proper BSON instances.
 */
describe('EditDrawer — _id re-injection preserves BSON types', () => {
  it('submits canonical EJSON that round-trips ObjectId, Date, and Decimal128', async () => {
    const originalId = new ObjectId('64a7f0e1b1d4e8f2c3a45678');
    const createdAt = new Date('2026-04-20T12:00:00.000Z');
    const amount = Decimal128.fromString('19.99');

    const calls: ReplaceCall[] = [];
    installAtelierMock({
      doc: {
        replace: async (input) => {
          calls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
        <EditDrawer
          connectionId="c1"
          dbName="db"
          collection="coll"
          doc={{ _id: originalId, name: 'foo', createdAt, amount }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
    );

    // Simulate the user deleting the `_id` line from the buffer entirely.
    // The drawer should re-inject originalId before submitting.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const editedBuffer = ejsonStringify({ name: 'foo', createdAt, amount }, 2);
    fireEvent.change(textarea, { target: { value: editedBuffer } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(calls.length).toBe(1));
    const submitted = ejsonParse<Record<string, unknown>>(calls[0]!.docJson);

    expect(submitted._id).toBeInstanceOf(ObjectId);
    expect((submitted._id as ObjectId).toHexString()).toBe(originalId.toHexString());
    expect(submitted.createdAt).toBeInstanceOf(Date);
    expect((submitted.createdAt as Date).toISOString()).toBe(createdAt.toISOString());
    expect(submitted.amount).toBeInstanceOf(Decimal128);
    expect((submitted.amount as Decimal128).toString()).toBe('19.99');
    expect(submitted.name).toBe('foo');
  });

  it('does not re-inject _id if the buffer still contains one', async () => {
    const originalId = new ObjectId('64a7f0e1b1d4e8f2c3a45678');
    const newId = new ObjectId('64a7f0e1b1d4e8f2c3a45679');

    const calls: ReplaceCall[] = [];
    installAtelierMock({
      doc: {
        replace: async (input) => {
          calls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
        <EditDrawer
          connectionId="c1"
          dbName="db"
          collection="coll"
          doc={{ _id: originalId, name: 'foo' }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
    );

    // User edits _id to a different ObjectId — buffer should be sent as-is,
    // no re-injection of originalId.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: ejsonStringify({ _id: newId, name: 'foo' }, 2) },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(calls.length).toBe(1));
    const submitted = ejsonParse<Record<string, unknown>>(calls[0]!.docJson);
    expect((submitted._id as ObjectId).toHexString()).toBe(newId.toHexString());
  });

  /**
   * Review finding: `_id in parsed` throws TypeError
   * when `parsed` is a non-object (e.g. user types `null` or `42`).
   * `isValidEjson` accepts those as valid EJSON, so we have to guard at
   * the re-injection site.
   */
  it('rejects a buffer whose top level is not a JSON object', async () => {
    const originalId = new ObjectId('64a7f0e1b1d4e8f2c3a45678');
    const calls: ReplaceCall[] = [];
    installAtelierMock({
      doc: {
        replace: async (input) => {
          calls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
        <EditDrawer
          connectionId="c1"
          dbName="db"
          collection="coll"
          doc={{ _id: originalId, name: 'foo' }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'null' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/JSON object/i),
    );
    expect(calls.length).toBe(0);
  });

  /**
   * Phase 2 (#2.18): a document with no `_id` would build the filter `{}`,
   * and replaceOne({}, doc) overwrites an ARBITRARY document. Guard before the
   * filter is built — surface an error and never call replace.
   */
  it('refuses to save a document with no _id (#2.18)', async () => {
    const calls: ReplaceCall[] = [];
    installAtelierMock({
      doc: {
        replace: async (input) => {
          calls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
        <EditDrawer
          connectionId="c1"
          dbName="db"
          collection="coll"
          doc={{ name: 'foo' }}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
    );

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/without an _id/i),
    );
    expect(calls.length).toBe(0);
  });

  /**
   * Review finding: default constants should be frozen so a
   * stray write (e.g. accidental `DEFAULT_COLLECTION_TAB_STATE.page = 5`)
   * doesn't silently affect every future tab seeded from the default.
   */
  it('exposes DEFAULT_COLLECTION_TAB_STATE as a frozen object', async () => {
    const { DEFAULT_COLLECTION_TAB_STATE } = await import('@shared/defaults');
    expect(Object.isFrozen(DEFAULT_COLLECTION_TAB_STATE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COLLECTION_TAB_STATE.builder)).toBe(true);
  });
});
