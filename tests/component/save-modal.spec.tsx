import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { SaveModal } from '../../src/pages/Workspace/SaveModal';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { BuilderState } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const builderState: BuilderState = {
  projection: [],
  sort: '',
  limit: '',
};

function setupMocks(createSpy: (input: unknown) => Promise<{ id: string }>) {
  installAtelierMock({
    saved: {
      create: createSpy as never,
    },
  });
}

function renderModal() {
  return render(
    <SaveModal
      connectionId="c1"
      dbName="shop"
      collection="orders"
      builderState={builderState}
      queryRaw="{}"
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
}

describe('SaveModal — description field', () => {
  it('includes a typed description in the create payload', async () => {
    const calls: unknown[] = [];
    setupMocks(async (input) => {
      calls.push(input);
      return { id: 'q1' };
    });

    renderModal();

    await userEvent.type(screen.getByLabelText(/Name/), 'My Query');
    await userEvent.type(screen.getByLabelText(/Description/), 'a helpful note');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({
      payload: { description: 'a helpful note' },
    });
  });

  it('omits description from the payload when left blank', async () => {
    const calls: unknown[] = [];
    setupMocks(async (input) => {
      calls.push(input);
      return { id: 'q1' };
    });

    renderModal();

    await userEvent.type(screen.getByLabelText(/Name/), 'My Query');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(calls.length).toBe(1));
    const payload = (calls[0] as { payload: { description?: string } }).payload;
    expect(payload.description).toBeUndefined();
  });

  it('treats a whitespace-only description as blank', async () => {
    const calls: unknown[] = [];
    setupMocks(async (input) => {
      calls.push(input);
      return { id: 'q1' };
    });

    renderModal();

    await userEvent.type(screen.getByLabelText(/Name/), 'My Query');
    await userEvent.type(screen.getByLabelText(/Description/), '   ');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(calls.length).toBe(1));
    const payload = (calls[0] as { payload: { description?: string } }).payload;
    expect(payload.description).toBeUndefined();
  });

  // #91 — the submit button now stays real-enabled while `saving` (only
  // `data-disabled`/`aria-disabled`, not `disabled`), so a submit button's
  // own `disabled` attribute is no longer what blocks the form's implicit
  // Enter-to-submit while a save is in flight. `handleSubmit`'s `canSubmit`
  // guard (still `fieldsValid && !saving`) is what has to stop a second
  // `api.saved.create` call now.
  it('ignores a form submit that arrives while a save is already in flight', async () => {
    let resolveCreate!: (v: { id: string }) => void;
    const create = vi.fn(() => new Promise<{ id: string }>((r) => (resolveCreate = r)));
    setupMocks(create as never);

    renderModal();

    await userEvent.type(screen.getByLabelText(/Name/), 'My Query');
    const submit = screen.getByRole('button', { name: /^Save$/ });
    await userEvent.click(submit);
    fireEvent.submit(submit.closest('form')!);

    expect(create).toHaveBeenCalledTimes(1);
    resolveCreate({ id: 'q1' });
  });
});
