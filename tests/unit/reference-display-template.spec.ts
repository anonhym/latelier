import { describe, it, expect } from 'vitest';
import { renderDisplayTemplate } from '../../src/features/references/display';

describe('renderDisplayTemplate', () => {
  it('substitutes plain string fields', () => {
    const out = renderDisplayTemplate('{name}', { name: 'alice' });
    expect(out).toBe('alice');
  });

  it('substitutes plain number fields', () => {
    const out = renderDisplayTemplate('{name} (qty {qty})', { name: 'alice', qty: 5 });
    expect(out).toBe('alice (qty 5)');
  });

  it('walks dotted paths', () => {
    const out = renderDisplayTemplate('{addr.city}', { addr: { city: 'Paris' } });
    expect(out).toBe('Paris');
  });

  it('canonical EJSON $oid → hex string', () => {
    const out = renderDisplayTemplate('id={_id}', {
      _id: { $oid: '507f1f77bcf86cd799439011' },
    });
    expect(out).toBe('id=507f1f77bcf86cd799439011');
  });

  it('canonical EJSON $numberInt → numeric string (was JSON.stringified before)', () => {
    const out = renderDisplayTemplate('qty={qty}', {
      qty: { $numberInt: '5' },
    });
    expect(out).toBe('qty=5');
  });

  it('canonical EJSON $numberDouble → numeric string', () => {
    const out = renderDisplayTemplate('price={price}', {
      price: { $numberDouble: '3.14' },
    });
    expect(out).toBe('price=3.14');
  });

  it('canonical EJSON $numberLong → numeric string', () => {
    const out = renderDisplayTemplate('big={big}', {
      big: { $numberLong: '9007199254740993' },
    });
    expect(out).toBe('big=9007199254740993');
  });

  it('canonical EJSON $date → iso string', () => {
    const out = renderDisplayTemplate('at={at}', {
      at: { $date: '2024-01-15T12:00:00.000Z' },
    });
    expect(out).toBe('at=2024-01-15T12:00:00.000Z');
  });

  it('missing path renders empty', () => {
    const out = renderDisplayTemplate('{addr.city}', { addr: {} });
    expect(out).toBe('');
  });

  it('plain nested object falls back to JSON', () => {
    const out = renderDisplayTemplate('{tags}', { tags: { a: 1, b: 2 } });
    expect(out).toBe('{"a":1,"b":2}');
  });
});
