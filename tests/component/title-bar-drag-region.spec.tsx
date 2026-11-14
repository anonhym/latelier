import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '../helpers/render';
import { TitleBar } from '../../src/pages/Workspace/TitleBar';

const baseProps = {
  sidebarCollapsed: false,
  onToggleSidebar: () => {},
  onOpenSettings: () => {},
  onOpenPalette: () => {},
  shellOpen: false,
  shellAvailable: true,
  onToggleShell: () => {},
};

const region = (el: HTMLElement) => (el.style as unknown as Record<string, string>).WebkitAppRegion;

describe('TitleBar', () => {
  it('the bar is the window drag area; only the breadcrumb wrapper opts out', () => {
    render(<TitleBar {...baseProps} breadcrumb={<button type="button">Switch</button>} />);
    const button = screen.getByRole('button', { name: 'Switch' });
    expect(region(button.parentElement as HTMLElement)).toBe('no-drag');
    expect(region(button.parentElement!.parentElement as HTMLElement)).toBe('drag');
  });

  it('the breadcrumb wrapper stays a shrinkable flex box so its segments can ellipsize', () => {
    render(<TitleBar {...baseProps} breadcrumb={<button type="button">Switch</button>} />);
    const wrapper = screen.getByRole('button', { name: 'Switch' }).parentElement as HTMLElement;
    expect(wrapper.style.display).toBe('flex');
    expect(wrapper.style.minWidth).toBe('0px');
  });

  it('has no theme toggle', () => {
    render(<TitleBar {...baseProps} />);
    expect(screen.queryByRole('button', { name: /Switch to (dark|light) theme/ })).toBeNull();
  });

  it('the sidebar toggle reports its state and calls back', () => {
    const onToggleSidebar = vi.fn();
    render(<TitleBar {...baseProps} sidebarCollapsed onToggleSidebar={onToggleSidebar} />);
    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it('the search field opens the palette', () => {
    const onOpenPalette = vi.fn();
    render(<TitleBar {...baseProps} onOpenPalette={onOpenPalette} />);
    const field = screen.getByRole('button', { name: 'Search collections and actions' });
    expect(field.getAttribute('data-hint-anchor')).toBe('palette.discover');
    fireEvent.click(field);
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
