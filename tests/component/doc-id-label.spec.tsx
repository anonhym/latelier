import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';

const copied = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/clipboard', () => ({
  copyToClipboard: (text: string) => {
    copied(text);
    return Promise.resolve(true);
  },
}));

import { DocIdLabel } from '../../src/pages/Workspace/views/DocIdLabel';

describe('DocIdLabel copy', () => {
  beforeEach(() => copied.mockClear());

  it('copies an embedded-document _id whole, not its {n} label', () => {
    render(<DocIdLabel doc={{ _id: { tenant: 'a', id: { $numberInt: '1' } } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy _id of document/ }));
    expect(JSON.parse(copied.mock.calls[0][0] as string)).toEqual({ tenant: 'a', id: 1 });
  });

  it('keeps an ObjectId _id as its bare hex', () => {
    render(<DocIdLabel doc={{ _id: { $oid: '507f1f77bcf86cd799439011' } }} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy _id of document/ }));
    expect(copied).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
  });
});
