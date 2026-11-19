import { describe, it, expect, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { AddToFamilyDialog } from '../../src/features/connections/FamilyDialogs';
import type { ConnectionSummary } from '@shared/types';

afterEach(() => uninstallAtelierMock());

const CONN = { id: 'c1', name: 'Client A' } as ConnectionSummary;

describe('AddToFamilyDialog — a new family', () => {
  it('removes the family it just made when adding the connections fails, so a retry meets no orphan', async () => {
    const user = userEvent.setup();
    const create = vi.fn(async () => ({ id: 'new', name: 'Prod', memberIds: [], createdAt: 'x', updatedAt: 'x' }));
    const setMembership = vi.fn(async () => {
      throw new Error('a selected connection no longer exists');
    });
    const del = vi.fn(async () => undefined);
    installAtelierMock({ families: { create, setMembership, delete: del } as never });
    render(<AddToFamilyDialog connections={[CONN]} families={[]} onCancel={() => {}} onDone={() => {}} />);

    await user.type(await screen.findByLabelText('New family name'), 'Prod');
    await user.click(screen.getByRole('button', { name: 'Create family' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith({ id: 'new', keepAsLocal: false }));
    expect(await screen.findByText(/no longer exists/)).toBeTruthy();
  });
});
