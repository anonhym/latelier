import { describe, it, expect } from 'vitest';
import { isContextMenuKey, anchorFromRect } from '../../src/utils/contextMenuKey';

// X19/#55 — the platform-conventional keys for "open the context menu for the
// focused thing": the dedicated ContextMenu key, and Shift+F10. Every caller
// (DbCollectionNavigator, TableView, TabStrip) shares this one predicate
// rather than re-deriving it, so the five assertions below are what actually
// protects every keyboard-open call site.
describe('isContextMenuKey', () => {
  it('is true for the dedicated ContextMenu key alone', () => {
    expect(isContextMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true);
  });

  it('is true for the ContextMenu key even with Shift held', () => {
    expect(isContextMenuKey({ key: 'ContextMenu', shiftKey: true })).toBe(true);
  });

  it('is true for Shift+F10', () => {
    expect(isContextMenuKey({ key: 'F10', shiftKey: true })).toBe(true);
  });

  it('is false for F10 without Shift', () => {
    expect(isContextMenuKey({ key: 'F10', shiftKey: false })).toBe(false);
  });

  it('is false for Shift held with an unrelated key', () => {
    expect(isContextMenuKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });
});

describe('anchorFromRect', () => {
  it('anchors at the bottom-left corner of the rect, matching the bottom-start menu position', () => {
    expect(anchorFromRect({ left: 42, bottom: 84 })).toEqual({ x: 42, y: 84 });
  });
});
