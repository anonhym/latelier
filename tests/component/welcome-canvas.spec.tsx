import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, titleBar, waitFor, within } from '../helpers/render';
import Workspace from '../../src/pages/Workspace';
import { ConnectionTransferProvider } from '../../src/features/connections/ConnectionTransferProvider';
import { TroubleshootingProvider } from '../../src/troubleshooting/TroubleshootingProvider';
import { connectionFixture, installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionInput, ConnectionSummary, ParsedUri, ProbeResult } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const PASSWORD = 's3cr3t-pw';
const URI = `mongodb://ana:${PASSWORD}@localhost:27017`;

const PARSED: ParsedUri = {
  input: {
    connectionType: 'standard',
    host: 'localhost',
    port: 27017,
    authMech: 'default',
    authUsername: 'ana',
    password: PASSWORD,
    tls: { enabled: false, verify: true },
  },
  warnings: [],
};

type Overrides = NonNullable<Parameters<typeof installAtelierMock>[0]>;

/**
 * Every bridge call, by channel, with its arguments as text: what the secrecy
 * assertions read. Wraps the installed mock in place, so it sees the calls of
 * the whole Workspace, not only the canvas's own.
 */
function recordBridge(api: IpcApi): { channel: string; args: string }[] {
  const calls: { channel: string; args: string }[] = [];
  for (const [ns, methods] of Object.entries(api) as [string, Record<string, unknown>][]) {
    for (const [name, fn] of Object.entries(methods)) {
      if (typeof fn !== 'function') continue;
      methods[name] = (...args: unknown[]) => {
        calls.push({ channel: `${ns}.${name}`, args: JSON.stringify(args) ?? '' });
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    }
  }
  return calls;
}

function mount(opts: { rows?: ConnectionSummary[]; conn?: Overrides['conn']; secrets?: Overrides['secrets'] } = {}) {
  // Mutated in place: `conn.list` closes over this array, as the saved list does in main.
  const rows = opts.rows ?? [];
  const parseUri = vi.fn<(uri: string) => Promise<ParsedUri>>(async () => PARSED);
  const test = vi.fn<(input: ConnectionInput) => Promise<ProbeResult>>(async () => ({ ok: true, serverVersion: '8.0.5' }));
  const create = vi.fn(async (input: ConnectionInput) => {
    rows.push(connectionFixture({ id: 'new1', name: input.name, status: 'unknown' }));
    return { id: 'new1' } as never;
  });
  const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
  const api = installAtelierMock({
    tabs: { list: async () => [] },
    conn: { list: async () => [...rows], parseUri, test, create, touchUsed: async (id: string) => ({ id }), ...opts.conn },
    mongo: { connect },
    secrets: opts.secrets,
  });
  const calls = recordBridge(api);
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <TroubleshootingProvider>
        <ConnectionTransferProvider>
          <Workspace />
        </ConnectionTransferProvider>
      </TroubleshootingProvider>
    </MemoryRouter>,
  );
  return { rows, parseUri, test, create, connect, calls };
}

const field = () => screen.findByRole('textbox', { name: 'Connection string' }) as Promise<HTMLInputElement>;

async function submit(uri = URI) {
  await userEvent.type(await field(), `${uri}{Enter}`);
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Welcome canvas (C03 §13.1)', () => {
  it('with no saved Connection the window is the canvas: no tab strip, navigator or status bar', async () => {
    mount();

    await screen.findByRole('heading', { name: 'Connect to MongoDB' });
    const input = await field();
    expect(input.placeholder).toBe('mongodb://localhost:27017  or  mongodb+srv://…');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(
      await screen.findByText('Passwords are encrypted with your system keychain and never leave this machine.'),
    ).toBeTruthy();

    expect(screen.queryByRole('tablist', { name: 'Open tabs' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Filter collections' })).toBeNull();
    expect(screen.queryByLabelText('Status bar')).toBeNull();
    // The title bar keeps the search field and Settings, and nothing that acts on a workbench.
    expect(titleBar().getByRole('button', { name: 'Search collections and actions' })).toBeTruthy();
    expect(titleBar().getByRole('button', { name: 'Open settings' })).toBeTruthy();
    expect(titleBar().queryByRole('button', { name: 'Toggle sidebar' })).toBeNull();
    expect(titleBar().queryByRole('button', { name: 'Console' })).toBeNull();
    expect(titleBar().queryByRole('button', { name: /^Connection: / })).toBeNull();
  });

  it('with one saved Connection there is no canvas, and the workbench is back', async () => {
    mount({ rows: [connectionFixture({ status: 'unknown' })] });

    await screen.findByRole('textbox', { name: 'Filter collections' });
    expect(screen.queryByRole('heading', { name: 'Connect to MongoDB' })).toBeNull();
    expect(titleBar().getByRole('button', { name: 'Toggle sidebar' })).toBeTruthy();
    expect(screen.getByLabelText('Status bar')).toBeTruthy();
  });

  it('makes no promise about the keychain while the keychain does not hold the key', async () => {
    const status = vi.fn(async () => ({ columnKeyProtected: false }));
    mount({ secrets: { status } });

    await screen.findByRole('heading', { name: 'Connect to MongoDB' });
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByText(/encrypted with your system keychain/)).toBeNull();
  });

  it('Enter parses, tests, saves under the host name and connects, in that order', async () => {
    const { parseUri, test, create, connect } = mount();

    await submit();

    await waitFor(() => expect(connect).toHaveBeenCalledWith('new1'));
    expect(parseUri).toHaveBeenCalledWith(URI);
    // Named already: main validates the whole input on a test, and an unnamed one is refused.
    expect(test.mock.calls[0]![0]).toMatchObject({ name: 'localhost', host: 'localhost', port: 27017, authUsername: 'ana', password: PASSWORD });
    expect(create.mock.calls[0]![0]).toMatchObject({ name: 'localhost', host: 'localhost', password: PASSWORD });
    expect(parseUri.mock.invocationCallOrder[0]!).toBeLessThan(test.mock.invocationCallOrder[0]!);
    expect(test.mock.invocationCallOrder[0]!).toBeLessThan(create.mock.invocationCallOrder[0]!);
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan(connect.mock.invocationCallOrder[0]!);
    // One Connection saved now: the canvas gives way to the workbench.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Connect to MongoDB' })).toBeNull());
  });

  it('the Connect button does what Enter does', async () => {
    const { connect } = mount();

    await userEvent.type(await field(), 'mongodb://localhost:27017');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(connect).toHaveBeenCalledWith('new1'));
  });

  it('a name already taken gets the next suffix', async () => {
    const { rows, create } = mount();
    const input = await field();
    // Saved since the list was last read (another window, an import): the name is read at Connect time.
    rows.push(connectionFixture({ id: 'c1', name: 'localhost' }), connectionFixture({ id: 'c2', name: 'localhost 2' }));

    await userEvent.type(input, `${URI}{Enter}`);

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0].name).toBe('localhost 3');
  });

  it('empties the field once the Connection is saved', async () => {
    // A list that never shows the new row keeps the canvas mounted, so the field can be read.
    const create = vi.fn(async () => ({ id: 'new1' }) as never);
    const { connect } = mount({ conn: { create } });

    await submit();

    await waitFor(() => expect(connect).toHaveBeenCalledWith('new1'));
    expect((await field()).value).toBe('');
  });

  it('a URI that does not parse shows the parser’s reason, and tests and saves nothing', async () => {
    const parseUri = vi.fn(async () => {
      throw { code: 'VALIDATION', message: 'unsupported authMechanism: PLAIN' };
    });
    const { test, create } = mount({ conn: { parseUri: parseUri as never } });

    await submit('mongodb://localhost/?authMechanism=PLAIN');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('unsupported authMechanism: PLAIN');
    expect(within(alert).queryByRole('button', { name: 'Troubleshoot' })).toBeNull();
    expect(test).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    // Still there to be corrected, and the error clears with the first edit.
    const input = await field();
    expect(input.value).toBe('mongodb://localhost/?authMechanism=PLAIN');
    await userEvent.type(input, 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a URI that fails its test shows the reason and Troubleshoot, and saves nothing', async () => {
    const test = vi.fn(async (): Promise<ProbeResult> => ({
      ok: false,
      errorCode: 'NETWORK',
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:27017',
    }));
    const { create, connect } = mount({ conn: { test } });

    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the server. Check host, port, and firewall.');
    // The field stays focused through the attempt, so the URI can be fixed at once.
    expect(document.activeElement).toBe(await field());
    expect(create).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();

    await userEvent.click(within(alert).getByRole('button', { name: 'Troubleshoot' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('an error that quotes the URI or its password is shown with both taken out', async () => {
    const test = vi.fn(async (): Promise<ProbeResult> => ({
      ok: false,
      errorCode: 'UNKNOWN',
      errorMessage: `could not open ${URI} (password ${PASSWORD} rejected)`,
    }));
    mount({ conn: { test } });

    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not open •••');
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain('ana:');
  });

  it.each([
    ['a success', {} as Overrides['conn']],
    [
      'a failed test',
      { test: async (): Promise<ProbeResult> => ({ ok: false, errorCode: 'UNKNOWN', errorMessage: `no ${URI}` }) },
    ],
    [
      'a failed save',
      {
        create: async () => {
          throw { code: 'CONFLICT', message: `cannot save ${URI}` };
        },
      } as Overrides['conn'],
    ],
  ])('after %s the URI has reached parseUri only, and the password only the three secret channels', async (_case, conn) => {
    const { calls, parseUri } = mount({ conn });

    await submit();
    await waitFor(() => expect(parseUri).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })?.getAttribute('data-loading')).not.toBe('true'));
    // Let the debounced writers (tab state, prefs) have their turn before reading the record.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // No pref, tab state, palette history or log line: every channel is in the record.
    expect(calls.filter((c) => c.args.includes(URI)).map((c) => c.channel)).toEqual(['conn.parseUri']);
    const withPassword = new Set(calls.filter((c) => c.args.includes(PASSWORD)).map((c) => c.channel));
    for (const channel of withPassword) {
      expect(['conn.parseUri', 'conn.test', 'conn.create']).toContain(channel);
    }
    expect(withPassword.has('conn.parseUri')).toBe(true);
    // The renderer log is its own channel, named so a leak there reads as one. Palette history
    // is fed only from the palette's own input, which the canvas never writes to.
    expect(calls.filter((c) => c.channel === 'app.log' && (c.args.includes(URI) || c.args.includes(PASSWORD)))).toEqual([]);
  });

  it('the links open the form and the Import Wizard', async () => {
    mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Import from Compass or a file' }));
    const wizard = await screen.findByRole('dialog', { name: 'Import Connections' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(wizard.isConnected).toBe(false));

    await userEvent.click(screen.getByRole('button', { name: 'Paste several URIs' }));
    expect(await screen.findByRole('textbox', { name: /paste connection strings/i })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import Connections' })).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Enter details manually' }));
    expect(await screen.findByRole('dialog', { name: 'New Connection' })).toBeTruthy();
  });
});
