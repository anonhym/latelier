import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
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
});
