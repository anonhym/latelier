import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, multiConnectionMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => uninstallAtelierMock());

describe('Tab Group headers — the Family name', () => {
  it('shows a member\'s Family after its name, read-only, and nothing for a Connection with none', async () => {
    installAtelierMock({
      ...multiConnectionMock({
        connections: [
          { id: 'c1', name: 'Prod', familyId: 'f1', familyName: 'Acme' },
          { id: 'c2', name: 'Staging', color: '#8A4B00', familyId: null, familyName: null },
        ],
        tabs: [
          { id: 'a', connectionId: 'c1', collection: 'alpha', isActive: true },
          { id: 'x', connectionId: 'c2', collection: 'xray' },
        ],
      }),
    });
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    const strip = within(await screen.findByRole('tablist', { name: 'Open tabs' }));
    await waitFor(() => expect(strip.getAllByRole('group')).toHaveLength(2));
    const prod = strip.getByRole('group', { name: 'Prod' });
    const header = within(prod).getByRole('button', { name: 'Prod (Acme)' });
    expect(within(header).getByText('Acme')).toBeTruthy();
    // The same single button as before: the Family adds no control of its own.
    expect(within(prod).getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') !== null)).toHaveLength(1);

    const staging = strip.getByRole('group', { name: 'Staging' });
    expect(within(staging).getByRole('button', { name: 'Staging' })).toBeTruthy();
    expect(within(staging).queryByText('Acme')).toBeNull();
  });
});
