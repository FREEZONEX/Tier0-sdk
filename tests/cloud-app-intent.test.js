import { describe, expect, it, vi } from 'vitest';
import { intentStorageKey, orderIntent, receiptDomains } from '../examples/cloud-uns-app/public/order-intent.mjs';

const fingerprint = JSON.stringify({ orderNo: 'fixture-order', amount: 100 });
const key = '9a86af12-27c2-4e9b-a0a5-b7203fa7e30d';

describe('Cloud App receipt-domain migration gate', () => {
  it('preserves v5 legacy storage, intent keys and replay behavior', () => {
    expect(intentStorageKey('app.invalid', '42', 'legacy')).toBe('uns-orders-intent:v2:app.invalid:42');
    const stored = { fingerprint, key };
    const createKey = vi.fn();
    expect(orderIntent({ mode: 'legacy', stored, fingerprint, createKey })).toBe(stored);
    expect(createKey).not.toHaveBeenCalled();
  });

  it('never silently generates a Core key for absent, old, changed or foreign-domain intents', () => {
    const createKey = vi.fn(() => key);
    for (const stored of [undefined, { fingerprint, key },
      { fingerprint, key, receiptDomain: receiptDomains.legacy },
      { fingerprint: 'old-content', key: `core-v1-${key}`, receiptDomain: receiptDomains.core },
    ]) {
      expect(() => orderIntent({ mode: 'core', stored, fingerprint, createKey })).toThrow('NEW_DATA_INTENT_REQUIRED');
    }
    expect(createKey).not.toHaveBeenCalled();
  });

  it('requires an explicit new action and preserves that Core key on replay', () => {
    const createKey = vi.fn(() => key);
    const stored = orderIntent({ mode: 'core', fingerprint, explicitNew: true, createKey });
    expect(stored).toEqual({ fingerprint, key: `core-v1-${key}`, receiptDomain: receiptDomains.core });
    expect(orderIntent({ mode: 'core', stored, fingerprint, createKey })).toBe(stored);
    expect(createKey).toHaveBeenCalledTimes(1);
    expect(intentStorageKey('app.invalid', '42', 'core')).not.toBe(intentStorageKey('app.invalid', '42', 'legacy'));
  });

  it('blocks replacing an uncertain Core intent while retaining its original replay key', () => {
    const createKey = vi.fn();
    const stored = { fingerprint, key: `core-v1-${key}`, receiptDomain: receiptDomains.core, outcomeUnknown: true };
    expect(() => orderIntent({ mode: 'core', stored, fingerprint, explicitNew: true, createKey }))
      .toThrow('RECONCILE_DATA_INTENT_REQUIRED');
    expect(orderIntent({ mode: 'core', stored, fingerprint, createKey })).toBe(stored);
    expect(createKey).not.toHaveBeenCalled();
  });
});
