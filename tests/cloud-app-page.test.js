import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as intents from '../examples/cloud-uns-app/public/order-intent.mjs';

// Execute the actual page code with a tiny DOM/fetch fixture, without a browser,
// external credentials or another package. Only its ESM import is injected.
const source = readFileSync(new URL('../examples/cloud-uns-app/public/app.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '');
async function page({ language = 'en', canWrite = false, canCreate, createState = canCreate === true ? 'createAllowed' : canCreate === false ? 'createDenied' : canWrite ? 'createUnavailable' : 'readonly', dataMode = 'core', data = { orderNo: 'visible-order' }, notifications } = {}) {
  const element = () => ({ textContent: '', dataset: {}, children: [], listeners: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    addEventListener(name, handler) { this.listeners[name] = handler; } });
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const createKey = vi.fn();
  const hint = { canWrite, canCreate, createState };
  const storage = new Map([['uns-orders-language', language]]);
  const translations = [get('#list-heading')]; translations[0].dataset.i18n = 'records';
  const timers = new Map(); let nextTimer = 0;
  const pageEvents = new Map(); const windowEvents = new Map();
  const fetch = vi.fn(async (path) => path.startsWith('/api/orders/notifications/poll') && notifications ? notifications(path) : ({ ok: path === '/api/orders', status: path === '/api/orders' ? 200 : path.startsWith('/api/orders/notifications/poll') ? 404 : 403,
    json: async () => path === '/api/orders' ? { operator: '42', app: 'Fixture', ...hint, dataMode,
      receiptDomain: intents.receiptDomains[dataMode], items: [{ id: 'fixture-id', revision: 1, data }] } : { code: 'CONTROL_FORBIDDEN' } }));
  runInNewContext(source, { ...intents, fetch, crypto: { randomUUID: createKey },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    AbortController, setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    window: { addEventListener: (name, handler) => windowEvents.set(name, handler) },
    document: { hidden: false, addEventListener: (name, handler) => pageEvents.set(name, handler), querySelector: get, querySelectorAll: () => translations, documentElement: { dataset: {} }, createElement: element },
    location: { host: 'fixture.invalid' }, matchMedia: () => ({ matches: false }) });
  await vi.waitFor(() => expect(get('#records').children).toHaveLength(1));
  return { get, createKey, storage, fetch, hint, recordData: data, pageEvents, windowEvents, timers,
    tick: () => { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1].fn(); } } };
}

describe('Cloud App actual page read-only and field visibility', () => {
  it('rechecks creation on refresh without clearing old intents or minting a new one', async () => {
    const fixture = await page({ canWrite: true, canCreate: true });
    fixture.storage.set('existing-save-intent', 'unchanged');
    expect(fixture.get('#save').disabled).toBe(false);
    Object.assign(fixture.hint, { canCreate: false, createState: 'createDenied' });
    fixture.get('#refresh').listeners.click();
    await vi.waitFor(() => expect(fixture.get('#status').textContent).toContain('Creation is not permitted'));
    expect(fixture.get('#save').disabled).toBe(true);
    expect(fixture.get('#order-form [name="amount"]').disabled).toBe(true);
    Object.assign(fixture.hint, { canCreate: true, createState: 'createAllowed' });
    fixture.get('#refresh').listeners.click();
    await vi.waitFor(() => expect(fixture.get('#save').disabled).toBe(false));
    expect(fixture.storage.get('existing-save-intent')).toBe('unchanged');
    expect([...fixture.storage.keys()]).toEqual(['uns-orders-language', 'existing-save-intent']);
    expect(fixture.createKey).not.toHaveBeenCalled();
  });

  it.each(['zh', 'en'])('keeps an approver with write access out of creation in %s while retaining the current read-only list', async language => {
    const fixture = await page({ language, canWrite: true, canCreate: false });
    expect(fixture.get('#save').disabled).toBe(true);
    expect(fixture.get('#data-new').disabled).toBe(true);
    expect(fixture.get('#order-form [name="orderNo"]').disabled).toBe(true);
    expect(fixture.get('#order-form [name="amount"]').disabled).toBe(true);
    expect(fixture.get('#status').textContent).toContain(language === 'zh' ? '当前没有新增权限' : 'Creation is not permitted');
    await fixture.get('#order-form').listeners.submit({ preventDefault() {} });
    fixture.get('#data-new').listeners.click();
    expect(fixture.fetch.mock.calls.every(([, options]) => !options?.body)).toBe(true);
    expect(fixture.createKey).not.toHaveBeenCalled();
    expect(fixture.get('#records').children[0].children).toHaveLength(4);
  });

  it.each([
    { canWrite: true }, { canWrite: true, canCreate: true, createState: 'unknown-v2' },
    { canWrite: true, canCreate: false, createState: 'createUnsupported' },
  ])('does not fall back to generic write permission for unavailable creation %#', async hint => {
    const fixture = await page(hint);
    expect(fixture.get('#save').disabled).toBe(true);
    expect(fixture.get('#data-new').disabled).toBe(true);
    expect(fixture.get('#status').textContent).not.toContain('Data permissions have been upgraded');
    expect(fixture.createKey).not.toHaveBeenCalled();
  });

  it('preserves legacy creation based on its original write hint', async () => {
    const fixture = await page({ dataMode: 'legacy', canWrite: true });
    expect(fixture.get('#save').disabled).toBe(false);
    expect(fixture.get('#order-form [name="amount"]').disabled).toBe(false);
    expect(fixture.get('#data-new').hidden).toBe(true);
  });

  it.each([['en', 'This App has read access'], ['zh', '当前应用只有读取权限']])
  ('shows only the read-only status in %s, without a new-save action prompt', async (language, expected) => {
    const fixture = await page({ language });
    expect(fixture.get('#status').textContent).toBe(expected);
    expect(fixture.get('#save').disabled).toBe(true);
    expect(fixture.get('#data-new').disabled).toBe(true);
    expect(fixture.createKey).not.toHaveBeenCalled();
    expect([...fixture.storage.keys()]).toEqual(['uns-orders-language']);
  });

  it.each([['en', 'Not authorized'], ['zh', '未授权']])
  ('renders absent amount/status as unauthorized in %s without inventing values', async (language, expected) => {
    const fixture = await page({ language });
    const cells = fixture.get('#records').children[0].children.slice(0, 4).map((cell) => cell.textContent);
    expect(cells).toEqual(['visible-order', expected, expected, '1']);
    expect(fixture.fetch.mock.calls.every(([, options]) => !options?.body)).toBe(true);
  });

  it('preserves a visible zero amount and shows migration guidance only when writable', async () => {
    const fixture = await page({ canWrite: true, canCreate: true, data: { orderNo: 'visible-order', amount: 0, status: 'draft' } });
    expect(fixture.get('#records').children[0].children[1].textContent).toBe('0');
    expect(fixture.get('#status').textContent).toContain('Data permissions have been upgraded');
    expect(fixture.get('#data-new').disabled).toBe(false);
    expect(fixture.createKey).not.toHaveBeenCalled();
  });

  it.each([['en', 'Work orders', 'Submitted', 'Approved'], ['zh', '工单列表', '已提交', '已审批']])
  ('uses neutral titles and state labels in %s', async (language, title, submitted, approved) => {
    const fixture = await page({ language, data: { status: 'submitted' } });
    expect(fixture.get('#list-heading').textContent).toBe(title);
    expect(fixture.get('#records').children[0].children[2].textContent).toBe(submitted);
    const next = await page({ language, data: { status: 'approved' } });
    expect(next.get('#records').children[0].children[2].textContent).toBe(approved);
  });
});


const notificationResponse = (items, nextCursor = 'rc1.next') => ({ ok: true, status: 200,
  json: async () => ({ operator: '42', items, nextCursor, retentionMs: 3600000 }) });
const notification = { eventId: 'event-one', collectionId: 'orders', recordId: 'fixture-id', change: 'record', occurredAt: 1792540800000 };

describe('Cloud App authorized Record notification consumer', () => {
  it('establishes a baseline before a scoped snapshot, refreshes on a new ID and deduplicates replay', async () => {
    let count = 0;
    const fixture = await page({ notifications: async () => notificationResponse(++count === 1 ? [] : [notification], 'rc1.' + count) });
    await vi.waitFor(() => expect(fixture.timers.size).toBe(1));
    const orderCalls = () => fixture.fetch.mock.calls.map(([path]) => path).filter(path => path.startsWith('/api/orders'));
    expect(orderCalls().slice(0, 2)).toEqual(['/api/orders/notifications/poll', '/api/orders']);
    fixture.recordData.orderNo = 'current-scoped-value';
    fixture.tick();
    await vi.waitFor(() => expect(fixture.get('#records').children[0].children[0].textContent).toBe('current-scoped-value'));
    const reads = fixture.fetch.mock.calls.filter(([path]) => path === '/api/orders').length;
    await vi.waitFor(() => expect(fixture.timers.size).toBe(1));
    fixture.tick();
    await vi.waitFor(() => expect(count).toBe(3));
    expect(fixture.fetch.mock.calls.filter(([path]) => path === '/api/orders')).toHaveLength(reads);
    expect([...fixture.storage.keys()].some(key => /cursor|proof|notification/i.test(key))).toBe(false);
    expect(fixture.createKey).not.toHaveBeenCalled();
    fixture.windowEvents.get('pagehide')();
    expect(fixture.timers.size).toBe(0);
  });

  it('resets the baseline on an expired retention cursor, without replaying business writes', async () => {
    let count = 0;
    const fixture = await page({ notifications: async () => ++count === 2
      ? { ok: false, status: 409, json: async () => ({ code: 'CURSOR_EXPIRED' }) } : notificationResponse([], 'rc1.' + count) });
    await vi.waitFor(() => expect(fixture.timers.size).toBe(1)); fixture.tick();
    await vi.waitFor(() => expect(fixture.get('#notifications').textContent).toContain('window changed'));
    fixture.tick();
    await vi.waitFor(() => expect(count).toBe(3));
    expect(fixture.fetch.mock.calls.filter(([path]) => path === '/api/orders/notifications/poll')).toHaveLength(2);
    expect(fixture.fetch.mock.calls.every(([, options]) => !options?.body)).toBe(true);
  });

  it.each([401, 403])('clears records and stops old-cursor delivery on current denial %s', async status => {
    let count = 0;
    const fixture = await page({ notifications: async () => ++count === 1 ? notificationResponse([])
      : { ok: false, status, json: async () => ({ code: 'FORBIDDEN' }) } });
    await vi.waitFor(() => expect(fixture.timers.size).toBe(1)); fixture.tick();
    await vi.waitFor(() => expect(fixture.get('#records').children).toHaveLength(0));
    expect(fixture.timers.size).toBe(0);
  });

  it('does not restore the removed audit history panel or network route', async () => {
    const fixture = await page();
    expect(fixture.get('#records').children[0].children).toHaveLength(4);
    expect(fixture.fetch.mock.calls.some(([path]) => path.includes('/history'))).toBe(false);
    const html = readFileSync(new URL('../examples/cloud-uns-app/public/index.html', import.meta.url), 'utf8');
    expect(html).not.toContain('history-panel');
  });
});
