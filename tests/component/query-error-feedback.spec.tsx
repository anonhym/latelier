import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab } from '@shared/types';

/**
 * X14 §5 — error feedback for input the query surfaces refuse.
 *
 * Mounts the whole Workspace rather than QueryBar alone, deliberately: two of
 * the four criteria are about the *result* strip and the result grid reacting
 * to the query bar above them, and those live in different components reading
 * the same tab state.
 *
 * The sort, projection and stage-body surfaces have their own coverage —
 * `query-bar-shell-syntax.spec.tsx`, `query-bar-advanced-resync.spec.tsx` and
 * `stage-accordion.spec.tsx` respectively. This file is the Filter Bar and the
 * stale result count, which is the half spec §5 calls the dangerous one.
 */

const now = '2026-04-21T12:00:00.000Z';

const DOCS = [
  { _id: { $oid: '6512a3f19d3b2c0012a4b8e1' }, name: 'Alice' },
  { _id: { $oid: '6512a3f19d3b2c0012a4b8e2' }, name: 'Bob' },
  { _id: { $oid: '6512a3f19d3b2c0012a4b8e3' }, name: 'Carol' },
];

function makeCollectionTab(queryRaw: string): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      view: 'Tree',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw,
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      // A settled run, so the strip has a count to go stale and the grid has
      // rows to dim. Also stops the tab reading as pristine and auto-running.
      lastRun: { documents: DOCS, durationMs: 7, ranAt: now },
      totalCount: 139,
    },
  };
}

const CONNECTIONS = [
  {
    id: 'c1',
    name: 'Local',
    color: '#1A6835',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard' as const,
    readOnly: false,
    status: 'connected' as const,
  },
];

function setup(queryRaw = '{}') {
  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(queryRaw)],
      setActive: async (id) => ({ id }),
      update: async () => makeCollectionTab(queryRaw),
    },
    conn: { list: async () => CONNECTIONS },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
}

/** Type `text` into the filter textarea and blur it, as a user would. */
async function typeAndBlur(text: string) {
  const ta = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.blur(ta);
  return ta;
}

const filterNotice = () => document.getElementById('query-bar-filter-error');

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Filter Bar — inline reason for refused input (X14 §5)', () => {
  it('shows the transform reason under the textarea, located by line and column', async () => {
    setup();
    await typeAndBlur('{status: active}');

    await waitFor(() => expect(filterNotice()).not.toBeNull());
    const msg = filterNotice()!.textContent ?? '';
    // The transform's own reason, verbatim — not a message this file invented.
    expect(msg).toContain('"active" is a bare word');
    // …with the offset rendered as a 1-based line and column.
    expect(msg).toMatch(/^Line 1, column 10: /);
  });

  it('locates a refusal many lines into a multi-line filter', async () => {
    setup();
    await typeAndBlur('{\n  "a": 1,\n  "b": 2,\n  "c": broken\n}');

    await waitFor(() => expect(filterNotice()).not.toBeNull());
    expect(filterNotice()!.textContent).toMatch(/^Line 4, column 8: /);
  });

  it('names the regex flag it cannot keep, rather than dropping it', async () => {
    setup();
    await typeAndBlur('{name: /^acme/gi}');

    await waitFor(() => expect(filterNotice()).not.toBeNull());
    const msg = filterNotice()!.textContent ?? '';
    // The flag has to be named. Silently repairing `/^acme/gi` to
    // `/^acme/i` would run a query that looks right and is not the one asked
    // for — the one failure mode a refusal exists to prevent.
    expect(msg).toContain('"g"');
    expect(msg).toContain('global');
  });

  it('associates the message with the textarea it belongs to', async () => {
    setup();
    const ta = await typeAndBlur('{status: active}');

    await waitFor(() => expect(ta.getAttribute('aria-invalid')).toBe('true'));
    expect(ta.getAttribute('aria-describedby')).toBe('query-bar-filter-error');
    expect(filterNotice()!.getAttribute('role')).toBe('alert');
  });

  it('clears the message once the input becomes runnable again', async () => {
    setup();
    const ta = await typeAndBlur('{status: active}');
    await waitFor(() => expect(filterNotice()).not.toBeNull());

    // Shell Syntax this time — repaired, so runnable.
    fireEvent.change(ta, { target: { value: "{status: 'active'}" } });
    // Cleared the moment the user starts fixing it, not only after the blur.
    expect(filterNotice()).toBeNull();

    fireEvent.blur(ta);
    await waitFor(() => expect(ta.value).toBe('{"status": "active"}'));
    expect(filterNotice()).toBeNull();
    expect(ta.getAttribute('aria-invalid')).toBe('false');
  });

  // "can't parse this" and "must be a document" point at different
  // fixes, and a shared error element must not collapse them into one.
  it('keeps the parse refusal and the document refusal distinct', async () => {
    setup();
    await typeAndBlur('{status: active}');
    await waitFor(() => expect(filterNotice()).not.toBeNull());
    const parseRefusal = filterNotice()!.textContent;

    // `[1, 2]` is already valid JSON, so the transform returns `unchanged` and
    // never refuses it. The shape rule is what refuses it.
    await typeAndBlur('[1, 2]');
    await waitFor(() =>
      expect(filterNotice()!.textContent).toMatch(/must be a document/),
    );
    expect(filterNotice()!.textContent).not.toBe(parseRefusal);
  });
});

describe('Result strip and grid — a stale count must not read as current (X14 §5)', () => {
  const staleMarker = () => screen.queryByTestId('result-count-stale');
  const grid = () => document.querySelector('[data-stale]');

  it('does not mark a runnable query stale', async () => {
    setup();
    await screen.findByTestId('query-bar-input');

    expect(await screen.findByText('139')).toBeTruthy();
    expect(staleMarker()).toBeNull();
    expect(grid()).toBeNull();
  });

  it('marks the count not current and dims the grid while the filter is refused', async () => {
    setup();
    await screen.findByTestId('query-bar-input');
    expect(await screen.findByText('139')).toBeTruthy();

    await typeAndBlur('{status: active}');

    await waitFor(() => expect(staleMarker()).not.toBeNull());
    expect(staleMarker()!.textContent).toMatch(/not current/i);
    // The number is still on screen — it describes a real earlier query — but
    // it is no longer presented as the answer to what is in the box.
    expect(screen.getByText('139')).toBeTruthy();
    // …and the rows it describes are dimmed rather than hidden or made inert.
    const body = grid() as HTMLElement;
    expect(body).not.toBeNull();
    expect(Number(body.style.opacity)).toBeLessThan(1);
    expect(body.style.pointerEvents).toBe('');
  });

  it('stops marking it stale as soon as the query is runnable again', async () => {
    setup();
    const ta = await typeAndBlur('{status: active}');
    await waitFor(() => expect(staleMarker()).not.toBeNull());

    fireEvent.change(ta, { target: { value: "{status: 'active'}" } });
    fireEvent.blur(ta);

    await waitFor(() => expect(staleMarker()).toBeNull());
    expect(grid()).toBeNull();
  });

  // The sort and projection fields close the same Run gate, so they must move
  // the same marker — otherwise a stale count survives a broken sort.
  it('marks the count stale for a refused sort too, not only a refused filter', async () => {
    setup();
    await screen.findByTestId('query-bar-input');
    const trigger = document.querySelector('[aria-controls="query-bar-advanced"]');
    if (trigger && trigger.getAttribute('aria-expanded') !== 'true') {
      fireEvent.click(trigger);
    }

    const sort = (await screen.findByTestId('query-bar-sort')) as HTMLInputElement;
    fireEvent.change(sort, { target: { value: '{name: /^acme/gi}' } });
    fireEvent.blur(sort);

    await waitFor(() => expect(staleMarker()).not.toBeNull());
  });
});
