import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { ConnectionForm } from '../../src/features/connections/ConnectionForm';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { Connection } from '@shared/types';

const CANNED_CONNECTION: Connection = {
  id: 'c1',
  name: 'Stored',
  color: '#1A6835',
  connectionType: 'standard',
  readOnly: false,
  host: 'cluster.example.com',
  port: 27017,
  authMech: 'scram256',
  authUsername: 'alice',
  authDatabase: 'admin',
  tls: { enabled: true, verify: true },
  advanced: {
    connectTimeoutMs: 10_000,
    socketTimeoutMs: 30_000,
    serverSelectionTimeoutMs: 30_000,
    readPreference: 'primary',
    maxPoolSize: 100,
    directConnection: false,
  },
  hasPasswordStored: true,
  hasSshPasswordStored: false,
  hasSshPassphraseStored: false,
  createdAt: '2026-04-20T00:00:00Z',
  updatedAt: '2026-04-20T00:00:00Z',
};

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('ConnectionForm (host-agnostic, no router)', () => {
  it('create mode: filling the form and saving calls conn.create then onSaved with the new id, without navigating', async () => {
    const createSpy = vi.fn(async () => ({ id: 'new-id' }) as never);
    installAtelierMock({ conn: { create: createSpy as never } });
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    render(<ConnectionForm mode="create" onSaved={onSaved} onCancel={onCancel} />);

    const nameInput = await screen.findByPlaceholderText(/My MongoDB Server/i);
    await userEvent.type(nameInput, 'X');
    await userEvent.type(screen.getByPlaceholderText(/cluster.mongodb.net/i), 'localhost');
    await userEvent.click(screen.getByText('Auth'));
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0]!, 'none');

    fireEvent.click(screen.getByText(/^Save$/));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-id'));
  });

  it('edit mode: connectionId hydrates from conn.get and saving calls conn.update with that id, then onSaved', async () => {
    const updateSpy = vi.fn(async () => ({ ...CANNED_CONNECTION, id: 'c1' }) as never);
    installAtelierMock({
      conn: {
        get: async () => CANNED_CONNECTION,
        update: updateSpy as never,
      },
    });
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    render(<ConnectionForm mode="edit" connectionId="c1" onSaved={onSaved} onCancel={onCancel} />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText(/My MongoDB Server/i) as HTMLInputElement).value).toBe('Stored');
    });

    fireEvent.click(screen.getByText(/Save changes/i));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('c1', expect.anything()));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('c1'));
  });

  it('Cancel calls onCancel', async () => {
    installAtelierMock({});
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    render(<ConnectionForm mode="create" onSaved={onSaved} onCancel={onCancel} />);

    await screen.findByPlaceholderText(/My MongoDB Server/i);
    fireEvent.click(screen.getByText(/^Cancel$/));
    expect(onCancel).toHaveBeenCalled();
  });

  // the Safety section's read-only toggle lives on General (the
  // default tab), so no tab navigation is needed to reach it.
  it('create mode: toggling "Read-only connection" on and saving sends readOnly: true to conn.create', async () => {
    const createSpy = vi.fn(async () => ({ id: 'new-id' }) as never);
    installAtelierMock({ conn: { create: createSpy as never } });
    const onSaved = vi.fn();
    render(<ConnectionForm mode="create" onSaved={onSaved} onCancel={() => {}} />);

    const nameInput = await screen.findByPlaceholderText(/My MongoDB Server/i);
    await userEvent.type(nameInput, 'X');
    await userEvent.type(screen.getByPlaceholderText(/cluster.mongodb.net/i), 'localhost');

    await userEvent.click(screen.getByRole('switch', { name: 'Read-only connection' }));

    await userEvent.click(screen.getByText('Auth'));
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0]!, 'none');

    fireEvent.click(screen.getByText(/^Save$/));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true })),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-id'));
  });

  // Edit-mode hydration: `conn.get` returns a stored connection with
  // `readOnly: true`; submitting the untouched form must round-trip that
  // value to `conn.update` rather than silently resetting it to false.
  it('edit mode: hydrates readOnly from conn.get and re-submits it unchanged to conn.update', async () => {
    const updateSpy = vi.fn(async () => ({ ...CANNED_CONNECTION, id: 'c1' }) as never);
    installAtelierMock({
      conn: {
        get: async () => ({ ...CANNED_CONNECTION, readOnly: true }),
        update: updateSpy as never,
      },
    });
    const onSaved = vi.fn();
    render(<ConnectionForm mode="edit" connectionId="c1" onSaved={onSaved} onCancel={() => {}} />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText(/My MongoDB Server/i) as HTMLInputElement).value).toBe('Stored');
    });

    fireEvent.click(screen.getByText(/Save changes/i));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('c1', expect.objectContaining({ readOnly: true })),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('c1'));
  });

  it('a VALIDATION error from the IPC layer still sets field errors and jumps to the first offending tab', async () => {
    const createSpy = vi.fn(async () => {
      throw {
        code: 'VALIDATION',
        message: 'password: required',
        details: { issues: [{ path: ['password'], message: 'Password is required for SCRAM authentication' }] },
      };
    });
    installAtelierMock({ conn: { create: createSpy as never } });
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    render(<ConnectionForm mode="create" onSaved={onSaved} onCancel={onCancel} />);

    const nameInput = await screen.findByPlaceholderText(/My MongoDB Server/i);
    await userEvent.type(nameInput, 'X');
    await userEvent.type(screen.getByPlaceholderText(/cluster.mongodb.net/i), 'localhost');

    // Stay on General. The offending field (`password`) lives on the Auth tab,
    // so its error text is only reachable if the save handler jumps tabs for us
    // — asserting it from the Auth tab would pass even with the jump removed.
    expect(screen.queryByText(/Password is required/i)).toBeNull();

    fireEvent.click(screen.getByText(/^Save$/));

    await waitFor(() => {
      expect(screen.getByText(/Password is required/i)).toBeTruthy();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('mode="edit" with no id throws instead of silently falling through to a create', () => {
    expect(() =>
      render(<ConnectionForm mode="edit" connectionId="" onSaved={() => {}} onCancel={() => {}} />),
    ).toThrow('ConnectionForm: mode is "edit" but connectionId is ""');
  });
});

// The wrapper in ConnectionForm.tsx keys ConnectionFormImpl on connectionId
// specifically to force a remount instead of a reconcile when a host swaps
// targets on an already-mounted instance, since `loading` is only seeded
// once at mount while the hydrate effect re-runs per id. These specs pin
// that remount is actually happening, not just documented in a comment.
describe('ConnectionForm: connectionId swap on a mounted instance', () => {
  it('edit A -> edit B: does not show A\'s hydrated values while B is still loading', async () => {
    let resolveB!: (c: Connection) => void;
    const bPending = new Promise<Connection>((res) => {
      resolveB = res;
    });
    installAtelierMock({
      conn: {
        get: (async (id: string) => (id === 'c1' ? CANNED_CONNECTION : bPending)) as never,
      },
    });
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConnectionForm mode="edit" connectionId="c1" onSaved={onSaved} onCancel={onCancel} />,
    );

    await waitFor(() => {
      expect((screen.getByPlaceholderText(/My MongoDB Server/i) as HTMLInputElement).value).toBe('Stored');
    });

    rerender(<ConnectionForm mode="edit" connectionId="c2" onSaved={onSaved} onCancel={onCancel} />);

    expect(screen.getByText(/Loading…/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/My MongoDB Server/i)).toBeNull();

    resolveB({ ...CANNED_CONNECTION, id: 'c2', name: 'FromB' });

    await waitFor(() => {
      expect((screen.getByPlaceholderText(/My MongoDB Server/i) as HTMLInputElement).value).toBe('FromB');
    });
  });

  it('create -> edit: does not show the create draft while the edit target is still loading', async () => {
    let resolveB!: (c: Connection) => void;
    const bPending = new Promise<Connection>((res) => {
      resolveB = res;
    });
    installAtelierMock({
      conn: {
        get: (async () => bPending) as never,
      },
    });
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConnectionForm mode="create" onSaved={onSaved} onCancel={onCancel} />,
    );

    const nameInput = await screen.findByPlaceholderText(/My MongoDB Server/i);
    await userEvent.type(nameInput, 'Draft');

    rerender(<ConnectionForm mode="edit" connectionId="c2" onSaved={onSaved} onCancel={onCancel} />);

    expect(screen.getByText(/Loading…/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/My MongoDB Server/i)).toBeNull();

    resolveB({ ...CANNED_CONNECTION, id: 'c2', name: 'FromB' });

    await waitFor(() => {
      expect((screen.getByPlaceholderText(/My MongoDB Server/i) as HTMLInputElement).value).toBe('FromB');
    });
  });
});

/**
 * `Toggle` was a bare `div` with an `onClick`, inside a `label` that wrapped no
 * form control. So it took no focus, answered no key, announced no state, and
 * its own text did nothing when clicked — on the only control for the
 * read-only safety feature. A user who believed they had armed it, and had
 * not, got exactly the accident that feature exists to prevent.
 *
 * Driving the real app is what surfaced it: clicking the label text left the
 * switch off, and every write probe then succeeded against what was actually a
 * writable connection. That reads as a sandbox escape until you check a
 * screenshot, so it is worth a test that fails loudly instead.
 *
 * The read-only toggle stands in for all five in the form — they are one
 * component.
 */
describe('Toggle is a real control, not a div that happens to be clickable', () => {
  const renderForm = async (): Promise<void> => {
    installAtelierMock({});
    render(<ConnectionForm mode="create" onSaved={() => {}} onCancel={() => {}} />);
    await screen.findByPlaceholderText(/My MongoDB Server/i);
  };

  const toggle = (): HTMLElement =>
    screen.getByRole('switch', { name: 'Read-only connection' });

  it('exposes its state, so a screen reader can report whether writes are blocked', async () => {
    await renderForm();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('is reachable by keyboard', async () => {
    await renderForm();
    toggle().focus();
    expect(document.activeElement).toBe(toggle());
  });

  // Space and Enter separately: a `div` with only an `onClick` answers
  // neither, and a handler wired for one of them still leaves the other dead.
  it.each([
    ['{ }', ' '],
    ['{Enter}', '\n'],
  ])('toggles on %s', async (key) => {
    await renderForm();
    toggle().focus();
    await userEvent.keyboard(key === '{ }' ? '[Space]' : '{Enter}');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('toggles when its label text is clicked, which the cursor already promises', async () => {
    await renderForm();
    await userEvent.click(screen.getByText('Read-only connection'));
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });
});
