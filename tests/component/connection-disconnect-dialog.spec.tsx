import { describe, it, expect } from 'vitest';
import { render, screen } from '../helpers/render';
import { ConnectionDisconnectDialog } from '../../src/features/connections/ConnectionDisconnectDialog';

function mount(props: { tabCount: number; unsavedScripts?: string[]; scriptsReopenable?: boolean }) {
  render(<ConnectionDisconnectDialog name="Prod" onCancel={() => {}} onConfirm={() => {}} {...props} />);
  return screen.getByRole('alertdialog');
}

describe('ConnectionDisconnectDialog: scripts that hold code', () => {
  it('says nothing about scripts when there are none', () => {
    const dialog = mount({ tabCount: 2 });
    expect(dialog.textContent).toContain('closes 2 open tabs');
    expect(dialog.textContent).not.toMatch(/script/i);
  });

  it('names the scripts and says ⌘⇧T brings them back when it can', () => {
    const dialog = mount({ tabCount: 3, unsavedScripts: ['Cleanup', 'Script 2'], scriptsReopenable: true });
    expect(dialog.textContent).toContain('2 scripts with code: Cleanup, Script 2');
    expect(dialog.textContent).toMatch(/Reopen closed tab/);
  });

  it('says plainly that they cannot be brought back when they cannot', () => {
    const dialog = mount({ tabCount: 1, unsavedScripts: ['Cleanup'], scriptsReopenable: false });
    expect(dialog.textContent).toContain('1 script with code: Cleanup');
    expect(dialog.textContent).toMatch(/cannot be reopened/);
  });
});
