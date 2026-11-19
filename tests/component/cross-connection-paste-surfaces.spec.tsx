import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  createEvent,
  waitFor,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { BuilderPane } from '../../src/pages/Workspace/BuilderPane';
import { FieldsControl } from '../../src/pages/Workspace/FieldsControl';
import { StageAccordion } from '../../src/pages/Workspace/Aggregation/StageAccordion';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { ScriptEditor } from '../../src/components/ScriptEditor';
import { MongoShellPane } from '../../src/pages/Workspace/MongoShellPane';
import { DocumentEditor } from '../../src/pages/Workspace/DocumentEditor';
import { clearCopyOrigin, recordCopyOrigin } from '../../src/utils/copyOrigin';
import { getPasteWarning } from '../../src/state/pasteWarning';
import type { CollectionTabState, ConnectionSummary, Stage } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

/**
 * A value copied on Connection A and pasted into a query surface of a tab on
 * Connection B shows the strip under that surface, and the paste lands.
 * Each surface keeps its own test because each one wires its own paste hook.
 */

// jsdom has no layout, and CodeMirror measures its text through Range rects on
// the next frame; an empty answer is all it needs to leave a paste alone.
const NO_RECTS = { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
Range.prototype.getClientRects ??= () => NO_RECTS;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const ID = '507f1f77bcf86cd799439011';
const A = { connectionId: 'conn-a', dbName: 'shop', collection: 'orders' };

function conn(id: string, name: string): ConnectionSummary {
  return {
    id,
    name,
    color: '#000',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'connected',
    familyId: null,
    familyName: null,
  };
}

let prefValue: unknown = null;
let prefsGet = vi.fn<(key: string) => Promise<unknown>>();

function install() {
  prefsGet = vi.fn(async (key: string) => (key === 'warnings.crossConnectionPaste' ? prefValue : null));
  installAtelierMock({
    conn: { list: async () => [conn('conn-a', 'Client A'), conn('conn-b', 'Client B')] },
    prefs: {
      get: prefsGet,
      set: async (_k: string, v: unknown) => v,
    } as unknown as IpcApi['prefs'],
  });
}

beforeEach(() => {
  prefValue = null;
  install();
  recordCopyOrigin(A, `{ "_id": { "$oid": "${ID}" }, "name": "Alice Wonderland" }`);
});
afterEach(() => {
  clearCopyOrigin();
  uninstallAtelierMock();
});

function makeState(over: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    ...over,
  };
}

/** Holds the tab state as the workspace does, so typing and pasting round-trip through props. */
function Tab({ connectionId = 'conn-b', children }: { connectionId?: string; children: React.ReactNode }) {
  const [state, setState] = React.useState(makeState());
  const actions = React.useMemo(
    () =>
      emptyWorkspaceActions({
        patch: (p) => setState((prev) => ({ ...prev, ...p })),
        patchWith: (fn) => setState((prev) => ({ ...prev, ...fn(prev) })),
      }),
    [],
  );
  const meta = React.useMemo(() => emptyWorkspaceMeta({ connectionId, dbName: 'shop', collection: 'orders' }), [connectionId]);
  return (
    <CollectionWorkspaceProvider state={state} actions={actions} meta={meta}>
      {children}
    </CollectionWorkspaceProvider>
  );
}

/** Fires a paste carrying `text` and returns the event, so a test can read `defaultPrevented`. */
function paste(target: Element, text: string): Event {
  const event = createEvent.paste(target, { clipboardData: { getData: () => text } });
  fireEvent(target, event);
  return event;
}

const strip = () => screen.queryByTestId('paste-warning-strip');
const pastedId = `{ _id: ObjectId("${ID}") }`;

async function expectWarned() {
  await waitFor(() => expect(strip()).not.toBeNull());
  expect(strip()!.textContent).toContain('Copied from Client A · shop.orders.');
  expect(strip()!.textContent).toContain('This tab is on Client B.');
}

/** Lets the paste's async preference read settle, then says nothing showed. */
async function expectNotWarned() {
  await new Promise((r) => setTimeout(r, 20));
  expect(strip()).toBeNull();
  expect(getPasteWarning('t1')).toBeUndefined();
}

describe('Cross-Connection Paste: Filter Bar', () => {
  const mountBar = (connectionId?: string) =>
    render(
      <Tab connectionId={connectionId}>
        <QueryBar suggestionContext={null} />
      </Tab>,
    );

  it('warns under the Filter Bar, and the paste is not prevented', async () => {
    mountBar();
    const event = paste(screen.getByTestId('query-bar-input'), pastedId);
    expect(event.defaultPrevented).toBe(false);
    await expectWarned();
  });

  it('warns for a Connection in the same Family too', async () => {
    install();
    installAtelierMock({
      conn: {
        list: async () => [
          { ...conn('conn-a', 'Client A'), familyId: 'f1', familyName: 'Client deployments' },
          { ...conn('conn-b', 'Client B'), familyId: 'f1', familyName: 'Client deployments' },
        ],
      },
    });
    mountBar();
    paste(screen.getByTestId('query-bar-input'), pastedId);
    await waitFor(() => expect(strip()?.textContent).toContain('(both in Client deployments)'));
  });

  it('shows nothing for the same Connection, whatever the Collection', async () => {
    mountBar('conn-a');
    paste(screen.getByTestId('query-bar-input'), pastedId);
    await expectNotWarned();
  });

  it('shows nothing for a short value or a boolean', async () => {
    clearCopyOrigin();
    recordCopyOrigin(A, '{ "n": 3, "active": true, "tag": "abc" }');
    mountBar();
    paste(screen.getByTestId('query-bar-input'), '{ n: 3, active: true, tag: "abc" }');
    await expectNotWarned();
  });

  it('shows nothing when the pasted text carries none of the copied values', async () => {
    mountBar();
    paste(screen.getByTestId('query-bar-input'), '{ status: "shipped" }');
    await expectNotWarned();
  });

  it('shows nothing once an in-app copy that is not data has cleared the origin', async () => {
    clearCopyOrigin();
    mountBar();
    paste(screen.getByTestId('query-bar-input'), pastedId);
    await expectNotWarned();
  });

  it('shows nothing with the preference off', async () => {
    prefValue = false;
    mountBar();
    paste(screen.getByTestId('query-bar-input'), pastedId);
    await waitFor(() => expect(prefsGet).toHaveBeenCalledWith('warnings.crossConnectionPaste'));
    await new Promise((r) => setTimeout(r, 20));
    expect(strip()).toBeNull();
  });

  it('warns when the preference is stored as on', async () => {
    prefValue = true;
    mountBar();
    paste(screen.getByTestId('query-bar-input'), pastedId);
    await expectWarned();
  });

  it('does not touch the stored preference when nothing matched', async () => {
    mountBar();
    paste(screen.getByTestId('query-bar-input'), '{ status: "shipped" }');
    await new Promise((r) => setTimeout(r, 20));
    expect(prefsGet).not.toHaveBeenCalledWith('warnings.crossConnectionPaste');
  });
});

describe('Cross-Connection Paste: expanded Filter Bar', () => {
  it('is the same surface: the paste warns for the tab, and is not prevented', async () => {
    render(
      <Tab>
        <QueryBar suggestionContext={null} />
      </Tab>,
    );
    fireEvent.click(screen.getByTestId('query-bar-expand-btn'));
    const event = paste(await screen.findByTestId('query-expand-textarea'), pastedId);
    expect(event.defaultPrevented).toBe(false);
    await waitFor(() => expect(getPasteWarning('t1')).toMatchObject({ surface: 'filter' }));
  });
});

describe('Cross-Connection Paste: sort', () => {
  it('warns under the Filter Bar row, and the paste is not prevented', async () => {
    render(
      <Tab>
        <QueryBar suggestionContext={null} />
      </Tab>,
    );
    fireEvent.click(screen.getByTestId('option-pill-sort'));
    const event = paste(await screen.findByTestId('query-bar-sort'), `{ "_id": "${ID}" }`);
    expect(event.defaultPrevented).toBe(false);
    await expectWarned();
  });
});

describe('Cross-Connection Paste: projection', () => {
  it('warns, and the paste is not prevented', async () => {
    render(
      <Tab>
        <QueryBar suggestionContext={null} />
      </Tab>,
    );
    fireEvent.click(screen.getByTestId('option-pill-project'));
    const event = paste(await screen.findByTestId('fields-projection'), `{ "${ID}": 1 }`);
    expect(event.defaultPrevented).toBe(false);
    await expectWarned();
  });

  it('is its own surface on a bare FieldsControl too', async () => {
    render(
      <Tab>
        <FieldsControl />
      </Tab>,
    );
    fireEvent.click(screen.getByTestId('option-pill-project'));
    paste(await screen.findByTestId('fields-projection'), `{ "${ID}": 1 }`);
    await waitFor(() => expect(getPasteWarning('t1')).toMatchObject({ surface: 'projection' }));
  });
});

describe('Cross-Connection Paste: Query Builder values', () => {
  async function addCondition() {
    render(
      <Tab>
        <BuilderPane onOpenAsPipeline={vi.fn()} loadGen={0} onLoaded={vi.fn()} />
      </Tab>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    return screen.findByPlaceholderText('value');
  }

  it('warns under the builder, and the paste is not prevented', async () => {
    const input = await addCondition();
    const event = paste(input, ID);
    expect(event.defaultPrevented).toBe(false);
    await expectWarned();
    expect(getPasteWarning('t1')).toMatchObject({ surface: 'builder' });
  });

  it('shows nothing for the same Connection', async () => {
    render(
      <Tab connectionId="conn-a">
        <BuilderPane onOpenAsPipeline={vi.fn()} loadGen={0} onLoaded={vi.fn()} />
      </Tab>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    paste(await screen.findByPlaceholderText('value'), ID);
    await expectNotWarned();
  });
});

describe('Cross-Connection Paste: aggregation stage body', () => {
  const stages: Stage[] = [{ id: 1, op: '$match', body: '{}', enabled: true } as Stage];

  function mountAccordion(pasteTarget: { tabId: string; connectionId: string } | undefined) {
    const noop = () => {};
    return render(
      <StageAccordion
        stages={stages}
        activeId={1}
        openIds={new Set([1])}
        multiOpen={false}
        onToggleMultiOpen={noop}
        collection="orders"
        sourceCount={10}
        outputCount={null}
        outputStale={false}
        stageCounts={{}}
        staleStageIds={new Set()}
        previewLoading={new Set()}
        darkMode={false}
        suggestionContext={null}
        pasteTarget={pasteTarget}
        onAdd={noop}
        onToggleActive={noop}
        onSelect={noop}
        onToggleEnabled={noop}
        onChangeOp={noop}
        onBodyChange={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onReorder={noop}
        onRemove={noop}
        onDuplicate={noop}
        onRunToStage={noop}
      />,
    );
  }

  const cmContent = (container: HTMLElement) => container.querySelector<HTMLElement>('.cm-content')!;

  it('warns under the stage, and the stage body keeps its own paste handling', async () => {
    const { container } = mountAccordion({ tabId: 't1', connectionId: 'conn-b' });
    // CodeMirror takes the paste over and prevents the browser's own; the
    // handler here must add nothing to that, so the baseline is the same event
    // on a bare editor.
    const baseline = paste(
      render(<ScriptEditor value="" onChange={() => {}} />).container.querySelector<HTMLElement>('.cm-content')!,
      `{ _id: "${ID}" }`,
    );
    const event = paste(cmContent(container), `{ _id: "${ID}" }`);
    expect(event.defaultPrevented).toBe(baseline.defaultPrevented);
    await expectWarned();
    expect(getPasteWarning('t1')).toMatchObject({ surface: 'stage:1' });
  });

  it('shows nothing for a tab on the Connection it was copied on', async () => {
    const { container } = mountAccordion({ tabId: 't1', connectionId: 'conn-a' });
    paste(cmContent(container), `{ _id: "${ID}" }`);
    await expectNotWarned();
  });

  it('shows nothing where there is no tab to warn on', async () => {
    const { container } = mountAccordion(undefined);
    paste(cmContent(container), `{ _id: "${ID}" }`);
    await expectNotWarned();
  });
});

describe('Cross-Connection Paste: surfaces that never warn', () => {
  // Both sit inside a tab on Connection B, so a paste hook wired into either
  // would find a tab to warn on: that is what these cases would catch.
  it('the shell pane takes the paste without a warning', async () => {
    installAtelierMock({
      conn: { list: async () => [conn('conn-a', 'Client A'), conn('conn-b', 'Client B')] },
      mshell: {
        start: async () => ({ sessionId: 's1', connectionId: 'conn-b', startedAt: new Date().toISOString() }),
        write: async () => undefined,
        stop: async () => undefined,
        list: async () => [],
        onOutput: () => () => {},
      },
    });
    render(
      <Tab>
        <MongoShellPane connectionId="conn-b" connectionName="Client B" height={260} onClose={() => {}} />
      </Tab>,
    );
    const input = await screen.findByLabelText('Mongo shell input');
    paste(input, pastedId);
    await expectNotWarned();
  });

  it('the Document Editor takes it: moving a document between servers is legitimate', async () => {
    installAtelierMock({
      conn: { list: async () => [conn('conn-a', 'Client A'), conn('conn-b', 'Client B')] },
    });
    render(
      <Tab>
        <DocumentEditor
          mode="insert"
          connectionId="conn-b"
          dbName="shop"
          collection="orders"
          initialDocJson="{}"
          onClose={vi.fn()}
          onInserted={vi.fn()}
          onPartialInsert={vi.fn()}
        />
      </Tab>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    const fields = dialog.querySelectorAll('textarea, input, .cm-content');
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) paste(field, pastedId);
    paste(dialog, pastedId);
    await expectNotWarned();
  });
});
