// Receipt domains are deployment contracts, never delegation tokens. Legacy v5
// storage and keys remain untouched when Core is selected (and on rollback).
export const receiptDomains = Object.freeze({ legacy: 'legacy-app-data/v5', core: 'core-app-data/v1' });
export function intentStorageKey(host, operator, mode) {
  const legacy = `uns-orders-intent:v2:${host}:${operator}`;
  return mode === 'core' ? `${legacy}:${receiptDomains.core}` : legacy;
}

export function orderIntent({ mode, stored, fingerprint, explicitNew = false, createKey }) {
  if (mode === 'core') {
    if (explicitNew) {
      if (stored?.outcomeUnknown) throw new Error('RECONCILE_DATA_INTENT_REQUIRED');
      return { fingerprint, key: `core-v1-${createKey()}`, receiptDomain: receiptDomains.core };
    }
    if (stored?.receiptDomain !== receiptDomains.core || stored.fingerprint !== fingerprint ||
        !/^core-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stored.key)) {
      throw new Error('NEW_DATA_INTENT_REQUIRED');
    }
    return stored;
  }
  if (mode !== 'legacy') throw new Error('APP_DATA_CONFIGURATION_INVALID');
  return stored?.fingerprint === fingerprint ? stored : { fingerprint, key: createKey() };
}
