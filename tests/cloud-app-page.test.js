import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as intents from '../examples/cloud-uns-app/public/order-intent.mjs';

// Execute the actual page code with a tiny DOM/fetch fixture, without a browser,
// external credentials or another package. Only its ESM import is injected.
const source = readFileSync(new URL('../examples/cloud-uns-app/public/app.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '');
async function page({ language = 'en', canWrite = false, canCreate, createState = canCreate === true ? 'createAllowed' : canCreate === false ? 'createDenied' : canWrite ? 'createUnavailable' : 'readonly', dataMode = 'core', data = { orderNo: 'visible-order' }, history } = {}) {
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
  const translations = ['#list-heading', '#history-heading'].map((selector, index) => {
    const node = get(selector); node.dataset.i18n = index === 0 ? 'records' : 'history'; return node;
  });
  const fetch = vi.fn(async (path) => path.includes('/history?') && history ? history(path) : ({ ok: path === '/api/orders', status: path === '/api/orders' ? 200 : 403,
    json: async () => path === '/api/orders' ? { operator: '42', app: 'Fixture', ...hint, dataMode,
      receiptDomain: intents.receiptDomains[dataMode], items: [{ id: 'fixture-id', revision: 1, data }] } : { code: 'CONTROL_FORBIDDEN' } }));
  runInNewContext(source, { ...intents, fetch, crypto: { randomUUID: createKey },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: get, querySelectorAll: () => translations, documentElement: { dataset: {} }, createElement: element },
    location: { host: 'fixture.invalid' }, matchMedia: () => ({ matches: false }) });
  await vi.waitFor(() => expect(get('#records').children).toHaveLength(1));
  return { get, createKey, storage, fetch, hint };
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

  it.each(['zh', 'en'])('keeps an approver with write access out of creation in %s without hiding history', async language => {
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
    expect(fixture.get('#records').children[0].children[4].children[0].listeners.click).toBeTypeOf('function');
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

const response = (items, nextCursor = '') => ({ ok: true, status: 200,
  json: async () => ({ operator: '42', recordId: 'fixture-id', items, nextCursor }) });
const historyEvent = (revision, before, after, changedFields, actor = '42') => ({ eventId: `event-${revision}`,
  action: revision === 1 ? 'create' : 'update', revisionBefore: String(revision - 1), revisionAfter: String(revision),
  before, after, changedFields, createdAt: '1792540800000', actor: { kind: 'app_employee', userId: actor } });
function openHistory(fixture) {
  fixture.get('#records').children[0].children[4].children[0].listeners.click();
}
const contents = (node) => [node.textContent, ...node.children.map(contents)].join(' ');

describe('Cloud App actual history UI', () => {
  it.each(['zh', 'en'])('selects a record and renders four persisted-event views with actor/revision/before/after in %s', async language => {
    const events = [
      historyEvent(4, { status: 'submitted' }, { status: 'approved' }, ['status'], '374985657484080'),
      historyEvent(3, { status: 'draft' }, { status: 'submitted' }, ['status']),
      historyEvent(2, { amount: 731 }, { amount: 732 }, ['amount']),
      historyEvent(1, null, { orderNo: 'order-1', amount: 731, status: 'draft' }, ['orderNo', 'amount', 'status']),
    ];
    const fixture = await page({ language, history: async () => response(events) });
    openHistory(fixture);
    await vi.waitFor(() => expect(fixture.get('#history-events').children).toHaveLength(4));
    expect(fixture.get('#history-panel').hidden).toBe(false);
    expect(fixture.get('#history-record').textContent).toBe('fixture-id');
    const text = contents(fixture.get('#history-events'));
    expect(text).toContain('374985657484080'); expect(text).toContain('3 → 4'); expect(text).toContain('731 → 732');
    expect(text).toContain(language === 'zh' ? '已提交 → 已审批' : 'Submitted → Approved');
    expect(text).not.toContain('ownerUserId'); expect(text).not.toContain('keyOwnerId'); expect(text).not.toContain('privateNote');
    expect(fixture.fetch.mock.calls.filter(([path]) => path.includes('/history?'))).toHaveLength(1);
    expect(fixture.createKey).not.toHaveBeenCalled();
  });

  it.each([[400, 'INVALID_ARGUMENT'], [400, 'INVALID_REQUEST'], [422, 'INVALID_REQUEST']])
  ('allows manual continuation and clears snapshots on expired cursor %s/%s', async (status, code) => {
    let calls = 0;
    const fixture = await page({ history: async () => {
      calls++;
      if (calls === 1) return response([], 'cursor.first');
      if (calls === 2) return response([historyEvent(2, { amount: 731 }, { amount: 732 }, ['amount'])], 'cursor.second');
      return { ok: false, status, json: async () => ({ code }) };
    } });
    openHistory(fixture);
    await vi.waitFor(() => expect(fixture.get('#history-more').disabled).toBe(false));
    expect(fixture.get('#history-status').textContent).toContain('No visible changes on this page');
    expect(calls).toBe(1);
    fixture.get('#history-more').listeners.click();
    await vi.waitFor(() => expect(fixture.get('#history-events').children).toHaveLength(1));
    expect(fixture.fetch.mock.calls.at(-1)[0]).toContain('cursor=cursor.first');
    fixture.get('#history-more').listeners.click();
    await vi.waitFor(() => expect(fixture.get('#history-status').textContent).toContain('expired'));
    expect(fixture.get('#history-events').children).toHaveLength(0);
    expect(fixture.get('#history-more').disabled).toBe(true); expect(calls).toBe(3);
    expect(fixture.get('#history-refresh').disabled).toBe(false);
    expect(fixture.createKey).not.toHaveBeenCalled();
  });

  it.each(['zh', 'en'])('maps Core 422 INVALID_REQUEST to explicit history refresh guidance in %s', async language => {
    const fixture = await page({ language, history: async () => ({ ok: false, status: 422,
      json: async () => ({ code: 'INVALID_REQUEST' }) }) });
    openHistory(fixture);
    await vi.waitFor(() => expect(fixture.get('#history-status').dataset.error).toBe('true'));
    expect(fixture.get('#history-status').textContent).toContain(language === 'zh' ? '历史读取已失效，请点击刷新重新读取' : 'expired. Refresh to read it again');
    expect(fixture.get('#history-events').children).toHaveLength(0);
    expect(fixture.get('#history-more').disabled).toBe(true);
    expect(fixture.fetch.mock.calls.filter(([path]) => path.includes('/history?'))).toHaveLength(1);
    expect(fixture.createKey).not.toHaveBeenCalled();
  });

  it.each([[422, 'UNAVAILABLE'], [422, 'INVALID_INPUT'], [503, 'INVALID_REQUEST']])
  ('keeps unrelated history failures %s/%s distinct from cursor expiry', async (status, code) => {
    const fixture = await page({ history: async () => ({ ok: false, status, json: async () => ({ code }) }) });
    openHistory(fixture);
    await vi.waitFor(() => expect(fixture.get('#history-status').dataset.error).toBe('true'));
    expect(fixture.get('#history-status').textContent).toBe('Change history is temporarily unavailable');
    expect(fixture.get('#history-more').disabled).toBe(true);
    expect(fixture.fetch.mock.calls.filter(([path]) => path.includes('/history?'))).toHaveLength(1);
  });

  it.each(['zh', 'en'])('distinguishes denied/disabled history from empty history in %s', async language => {
    const fixture = await page({ language, history: async () => ({ ok: false, status: 403, json: async () => ({ code: 'FORBIDDEN' }) }) });
    openHistory(fixture);
    await vi.waitFor(() => expect(fixture.get('#history-status').dataset.error).toBe('true'));
    expect(fixture.get('#history-status').textContent).toContain(language === 'zh' ? '历史读取权限或历史读取未开启' : 'denied or history reading is not enabled');
    expect(fixture.get('#history-events').children).toHaveLength(0);
  });

  it('drops an in-flight history response after list refresh and keeps no history in storage', async () => {
    let complete;
    const fixture = await page({ history: () => new Promise((resolve) => { complete = resolve; }) });
    openHistory(fixture);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await fixture.get('#refresh').listeners.click();
    complete(response([historyEvent(2, { amount: 731 }, { amount: 732 }, ['amount'])]));
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.get('#history-panel').hidden).toBe(true);
    expect(fixture.get('#history-events').children).toHaveLength(0);
    expect([...fixture.storage.keys()]).toEqual(['uns-orders-language']);
  });
});
