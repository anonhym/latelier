import { describe, it, expect, vi } from 'vitest';
import {
  onColumnScrollRequest,
  requestColumnScroll,
  scrollLeftToReveal,
  type ColumnReveal,
} from '../../src/pages/Workspace/views/columnScroll';

const base: ColumnReveal = {
  scrollLeft: 0,
  clientWidth: 600,
  left: 0,
  right: 160,
  leftObstruction: 0,
  rightObstruction: 0,
};

describe('scrollLeftToReveal', () => {
  it('leaves the scroll alone when the column is already fully visible', () => {
    expect(scrollLeftToReveal({ ...base, scrollLeft: 100, left: 200, right: 360 })).toBe(100);
  });

  it('scrolls right just far enough to show a column past the right edge', () => {
    expect(scrollLeftToReveal({ ...base, left: 700, right: 860 })).toBe(260);
  });

  it('scrolls left to the column when it is before the visible area', () => {
    expect(scrollLeftToReveal({ ...base, scrollLeft: 500, left: 200, right: 360 })).toBe(200);
  });

  it('never scrolls below zero', () => {
    expect(scrollLeftToReveal({ ...base, scrollLeft: 50, left: 10, right: 100 })).toBe(10);
    expect(scrollLeftToReveal({ ...base, scrollLeft: 50, left: 10, right: 100, leftObstruction: 250 })).toBe(0);
    expect(scrollLeftToReveal({ ...base, scrollLeft: 0, left: 10, right: 1000, leftObstruction: 250, clientWidth: 100 })).toBe(0);
  });

  it('keeps a column clear of the pinned left edge', () => {
    // 254px pinned (gutter + _id): the column must start after it.
    expect(scrollLeftToReveal({ ...base, scrollLeft: 300, left: 400, right: 560, leftObstruction: 254 })).toBe(146);
    expect(scrollLeftToReveal({ ...base, scrollLeft: 100, left: 400, right: 560, leftObstruction: 254 })).toBe(100);
  });

  it('keeps a column clear of the pinned right edge', () => {
    // 92px of actions column on the right: the visible span is 508px.
    expect(scrollLeftToReveal({ ...base, scrollLeft: 0, left: 400, right: 560, rightObstruction: 92 })).toBe(52);
    expect(scrollLeftToReveal({ ...base, scrollLeft: 0, left: 300, right: 500, rightObstruction: 92 })).toBe(0);
  });

  it('aligns the left edge of a column wider than the free space', () => {
    expect(scrollLeftToReveal({ ...base, scrollLeft: 0, left: 100, right: 900 })).toBe(100);
  });
});

describe('column scroll requests', () => {
  it('delivers the field to every subscriber until it unsubscribes', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onColumnScrollRequest(a);
    const offB = onColumnScrollRequest(b);

    requestColumnScroll('name');
    offA();
    requestColumnScroll('age');
    offB();
    requestColumnScroll('ignored');

    expect(a.mock.calls).toEqual([['name']]);
    expect(b.mock.calls).toEqual([['name'], ['age']]);
  });

  it('is a no-op with nobody listening', () => {
    expect(() => requestColumnScroll('nobody')).not.toThrow();
  });
});

describe('scrollLeftToReveal edges', () => {
  it('keeps the scroll when the column sits exactly on either visible edge', () => {
    expect(scrollLeftToReveal({ ...base, scrollLeft: 200, left: 200, right: 360 })).toBe(200);
    expect(scrollLeftToReveal({ ...base, scrollLeft: 260, left: 700, right: 860 })).toBe(260);
  });

  it('clears the pinned edges and never scrolls below zero', () => {
    expect(scrollLeftToReveal({ ...base, scrollLeft: 500, left: 50, right: 210, leftObstruction: 80 })).toBe(0);
    expect(scrollLeftToReveal({ ...base, scrollLeft: 0, left: 100, right: 900, leftObstruction: 40 })).toBe(60);
  });
});
