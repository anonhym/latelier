import { describe, it, expect, afterEach, vi } from 'vitest';
import { notifications } from '@mantine/notifications';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { UpdateConfirm } from '../../src/pages/Workspace/UpdateConfirm';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  notifications.clean();
  vi.restoreAllMocks();
});

const reviewBtn = () => screen.getByRole('button', { name: /Review|Counting…/ }) as HTMLButtonElement;
const updateBtn = () => screen.queryByRole('button', { name: /Update|Updating…/ }) as HTMLButtonElement | null;
const updateJsonInput = () => screen.getByLabelText('Update document') as HTMLTextAreaElement;

describe('UpdateConfirm', () => {
  it('Update is unavailable until Review resolves and the collection name is typed', async () => {
    const confirmUpdateMany = vi.fn(async () => ({ count: 5, confirmToken: 'tok-1' }));
    installAtelierMock({ doc: { confirmUpdateMany } });

    render(
      <UpdateConfirm
        connectionId="c1"
        dbName="app"
        collection="orders"
        filter='{"status":"pending"}'
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );

    // No Update button before Review has ever run.
    expect(updateBtn()).toBeNull();

    fireEvent.change(updateJsonInput(), { target: { value: '{"$set":{"status":"active"}}' } });
    fireEvent.click(reviewBtn());

    await waitFor(() => expect(confirmUpdateMany).toHaveBeenCalledTimes(1));
    expect(confirmUpdateMany).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'app',
      collection: 'orders',
      filterJson: '{"status":"pending"}',
      updateJson: '{"$set":{"status":"active"}}',
    });
    await waitFor(() => expect(screen.getByText(/5 matching document/)).toBeTruthy());
    expect(updateBtn()!.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('orders'), { target: { value: 'orders' } });
    expect(updateBtn()!.disabled).toBe(false);
  });

  it('editing the update body after Review clears the review and hides Update again', async () => {
    const confirmUpdateMany = vi.fn(async () => ({ count: 5, confirmToken: 'tok-1' }));
    installAtelierMock({ doc: { confirmUpdateMany } });

    render(
      <UpdateConfirm
        connectionId="c1"
        dbName="app"
        collection="orders"
        filter='{"status":"pending"}'
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );

    fireEvent.change(updateJsonInput(), { target: { value: '{"$set":{"status":"active"}}' } });
    fireEvent.click(reviewBtn());
    await waitFor(() => expect(updateBtn()).not.toBeNull());
    fireEvent.change(screen.getByPlaceholderText('orders'), { target: { value: 'orders' } });
    expect(updateBtn()!.disabled).toBe(false);

    // Edit the buffer — the reviewed token described a different update.
    fireEvent.change(updateJsonInput(), { target: { value: '{"$set":{"status":"other"}}' } });

    expect(updateBtn()).toBeNull();
  });

  it('sends updateMany with the exact updateJson and confirmToken the Review call returned', async () => {
    const confirmUpdateMany = vi.fn(async () => ({ count: 2, confirmToken: 'tok-xyz' }));
    const updateMany = vi.fn(async () => ({ matchedCount: 2, modifiedCount: 2 }));
    installAtelierMock({ doc: { confirmUpdateMany, updateMany } });

    const onClose = vi.fn();
    const onUpdated = vi.fn();

    render(
      <UpdateConfirm
        connectionId="c1"
        dbName="app"
        collection="orders"
        filter='{"status":"pending"}'
        onClose={onClose}
        onUpdated={onUpdated}
      />,
    );

    fireEvent.change(updateJsonInput(), { target: { value: '{"$set":{"status":"active"}}' } });
    fireEvent.click(reviewBtn());
    await waitFor(() => expect(updateBtn()).not.toBeNull());
    fireEvent.change(screen.getByPlaceholderText('orders'), { target: { value: 'orders' } });
    fireEvent.click(updateBtn()!);

    await waitFor(() => expect(updateMany).toHaveBeenCalledTimes(1));
    expect(updateMany).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'app',
      collection: 'orders',
      filterJson: '{"status":"pending"}',
      updateJson: '{"$set":{"status":"active"}}',
      confirmToken: 'tok-xyz',
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('2 matched, 2 modified')).toBeTruthy());
  });

  it('disables Review outright when readOnly is true and shows the read-only alert', () => {
    const confirmUpdateMany = vi.fn();
    installAtelierMock({ doc: { confirmUpdateMany } });

    render(
      <UpdateConfirm
        connectionId="c1"
        dbName="app"
        collection="orders"
        filter='{"status":"pending"}'
        readOnly
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );

    fireEvent.change(updateJsonInput(), { target: { value: '{"$set":{"status":"active"}}' } });
    expect(reviewBtn().disabled).toBe(true);
    fireEvent.click(reviewBtn());
    expect(confirmUpdateMany).not.toHaveBeenCalled();
    expect(screen.getByText('This connection is read-only. Updating is disabled.')).toBeTruthy();
  });

  it('a VALIDATION refusal from confirmUpdateMany surfaces via the alert, with no Update button', async () => {
    installAtelierMock({
      doc: {
        confirmUpdateMany: async () => {
          throw new Error('updateJson must be an update-operator document');
        },
      },
    });

    render(
      <UpdateConfirm
        connectionId="c1"
        dbName="app"
        collection="orders"
        filter='{"status":"pending"}'
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );

    fireEvent.change(updateJsonInput(), { target: { value: '{"status":"active"}' } });
    fireEvent.click(reviewBtn());

    await waitFor(() => expect(screen.getByText('updateJson must be an update-operator document')).toBeTruthy());
    expect(updateBtn()).toBeNull();
  });
});
