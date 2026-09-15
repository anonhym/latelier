import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { ConnectionFormModal } from '../../src/features/connections/ConnectionFormModal';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { Connection } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * the unsaved-changes guard on the connection form's modal host.
 *
 * This modal shipped with both of Mantine's dismissal defaults while hosting an
 * entire connection form, typed password included. X15 missed it for the reason
 * spec §3 records: it was already Mantine and never hand-rolled, so it appeared
 * on neither the epic's audit nor the spec's nine guarded surfaces.
 *
 * Dirtiness comes from `@mantine/form`'s own `isDirty()`, surfaced through
 * `onDirtyChange`. That matters for the edit-mode case below: the form calls
 * `formApi.resetDirty()` after hydrating, so a freshly-opened Edit is clean
 * without this file having to know what a loaded connection looks like.
 */

const STORED: Connection = {
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
} as Connection;

const dialog = () => screen.getByRole('dialog', { name: /Connection/ });
const discardPrompt = () => screen.queryByRole('dialog', { name: 'Discard changes?' });
const overlay = () => document.body.querySelector('.mantine-Modal-overlay') as HTMLElement;
const nameInput = () => screen.findByPlaceholderText(/My MongoDB Server/i);

/** Let a click's async handler settle so a *negative* assertion means something. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('ConnectionFormModal — unsaved-changes guard', () => {
  it('closing an untouched create form does not prompt', async () => {
    installAtelierMock({});
    const onClose = vi.fn();
    render(<ConnectionFormModal onSaved={vi.fn()} onClose={onClose} />);
    await nameInput();

    fireEvent.click(within(dialog()).getByText(/^Cancel$/));
    await settle();

    expect(discardPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * The pre-fill case — the bug class found in `SavePipelineModal`,
   * `UserDrawer` and `ReferenceRulesEditor`. A guard written
   * against literals rather than the form's own initial values prompts here,
   * on a form the user has not touched.
   */
  it('closing a freshly-loaded edit form does not prompt', async () => {
    installAtelierMock({ conn: { get: async () => STORED } as never });
    const onClose = vi.fn();
    render(<ConnectionFormModal connectionId="c1" onSaved={vi.fn()} onClose={onClose} />);
    await waitFor(async () =>
      expect(((await nameInput()) as HTMLInputElement).value).toBe('Stored'),
    );

    fireEvent.click(within(dialog()).getByText(/^Cancel$/));
    await settle();

    expect(discardPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape with a typed name prompts, and Cancel keeps every field', async () => {
    installAtelierMock({});
    const onClose = vi.fn();
    render(<ConnectionFormModal onSaved={vi.fn()} onClose={onClose} />);
    const name = (await nameInput()) as HTMLInputElement;
    await userEvent.type(name, 'Half typed');
    await userEvent.type(screen.getByPlaceholderText(/cluster.mongodb.net/i), 'localhost');

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(((await nameInput()) as HTMLInputElement).value).toBe('Half typed');
    expect(
      (screen.getByPlaceholderText(/cluster.mongodb.net/i) as HTMLInputElement).value,
    ).toBe('localhost');
  });

  it('Escape with a typed name closes once Discard is confirmed', async () => {
    installAtelierMock({});
    const onClose = vi.fn();
    render(<ConnectionFormModal onSaved={vi.fn()} onClose={onClose} />);
    await userEvent.type((await nameInput()) as HTMLInputElement, 'Half typed');

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  /**
   * MUTATION TARGET — delete `closeOnClickOutside={false}` from
   * `ConnectionFormModal` and the last assertion must go red: the backdrop
   * starts routing through `requestClose` and raises a prompt nobody asked for.
   *
   * The first two assertions stay green under that mutation, which is exactly
   * why "no prompt appeared" is the one that has to be asserted. Do not "fix"
   * this test into expecting a prompt — an inert backdrop is the point.
   */
  it('a backdrop click with a typed password is inert — no close, no prompt, fields intact', async () => {
    installAtelierMock({});
    const onClose = vi.fn();
    render(<ConnectionFormModal onSaved={vi.fn()} onClose={onClose} />);
    await userEvent.type((await nameInput()) as HTMLInputElement, 'Prod cluster');
    await userEvent.click(screen.getByText('Auth'));
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0]!, 'scram256');
    const pw = (await screen.findByPlaceholderText(/^••••••••$/)) as HTMLInputElement;
    await userEvent.type(pw, 'hunter2');

    fireEvent.click(overlay());
    await settle();

    // The password lives on the Auth tab, which is the one still showing.
    expect((screen.getByPlaceholderText(/^••••••••$/) as HTMLInputElement).value).toBe('hunter2');
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).toBeNull();

    // Back to General — the name typed before the tab switch survived too, so
    // this covers the whole form rather than just the visible pane.
    await userEvent.click(screen.getByText('General'));
    expect(((await nameInput()) as HTMLInputElement).value).toBe('Prod cluster');
  });

  it('gives the close control an accessible name', async () => {
    installAtelierMock({});
    render(<ConnectionFormModal onSaved={vi.fn()} onClose={vi.fn()} />);
    await nameInput();
    expect(within(dialog()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
