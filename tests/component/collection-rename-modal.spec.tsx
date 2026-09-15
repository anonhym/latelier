import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { RenameCollectionModal } from '../../src/pages/Workspace/RenameCollectionModal';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('RenameCollectionModal', () => {
  it('disables submit when empty or unchanged, then calls api.collection.rename', async () => {
    const calls: unknown[] = [];
    installAtelierMock({
      collection: {
        rename: async (input) => {
          calls.push(input);
          return { name: (input as { newName: string }).newName };
        },
      },
    });
    const onRenamed = vi.fn();

    render(
      <RenameCollectionModal
        connectionId="c1"
        dbName="shop"
        collection="orders"
        onCancel={() => {}}
        onRenamed={onRenamed}
      />,
    );

    const submit = screen.getByText('Rename').closest('button')!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText('New name');
    await userEvent.type(input, 'orders');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(input);
    await userEvent.type(input, 'purchase_orders');
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(submit);

    await waitFor(() => expect(calls).toEqual([
      { connectionId: 'c1', dbName: 'shop', collection: 'orders', newName: 'purchase_orders' },
    ]));
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('purchase_orders'));
  });

  it('shows an inline error on CONFLICT', async () => {
    installAtelierMock({
      collection: {
        rename: async () => {
          throw { code: 'CONFLICT', message: 'target already exists' };
        },
      },
    });

    render(
      <RenameCollectionModal
        connectionId="c1"
        dbName="shop"
        collection="orders"
        onCancel={() => {}}
        onRenamed={() => {}}
      />,
    );

    await userEvent.type(screen.getByLabelText('New name'), 'existing');
    await userEvent.click(screen.getByText('Rename').closest('button')!);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/already exists/),
    );
  });
});
