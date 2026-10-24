import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as intents from '../examples/cloud-uns-app/public/order-intent.mjs';

// Actual page source; controlled HTTP completion deliberately ignores abort to
// exercise generation checks as well as transport cancellation. No network.
const source = readFileSync(process.env.C3_EPOCH_APP_SOURCE ?? new URL('../examples/cloud-uns-app/public/app.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '');
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const baseline = (n = 1) => response({ operator: '42', items: [], nextCursor: `rc1.${n}`, retentionMs: 3600000 });
const changed = () => response({ operator: '42', items: [{ eventId: 'one', recordId: 'owned', change: 'record' }], nextCursor: 'rc1.changed' });
const list = (orderNo, canCreate = true, operator = '42') => response({ operator, app: 'Fixture', dataMode: 'core',
  receiptDomain: intents.receiptDomains.core, canCreate, createState: canCreate ? 'createAllowed' : 'createDenied',
  items: [{ id: 'owned', revision: 1, data: { orderNo, amount: 10, status: 'draft' } }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
async function page({ orders, polls }) {
  const element = () => ({ textContent: '', dataset: {}, children: [], listeners: {}, reset() {},
    append(...values) { this.children.push(...values); }, replaceChildren() { this.children = []; },
    addEventListener(name, handler) { this.listeners[name] = handler; } });
  const elements = new Map();
  const get = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const timers = new Map(), events = new Map(), windowEvents = new Map(), calls = [];
  const storage = new Map([['uns-orders-language', 'en'], ['previous-save-intent', 'keep']]);
  let timerID = 0, orderCount = 0, pollCount = 0;
  const document = { hidden: false, addEventListener: (name, handler) => events.set(name, handler), querySelector: get,
    querySelectorAll: () => [], documentElement: { dataset: {} }, createElement: element };
  const fetch = async (path, options) => {
    assert.ok(!options?.body, 'notification tests must not execute business writes');
    calls.push({ path, options });
    if (path === '/api/orders') return orders(++orderCount, options);
    if (path.startsWith('/api/orders/notifications/poll')) return polls(++pollCount, path, options);
    return response({ code: 'FORBIDDEN' }, 403);
  };
  runInNewContext(source, { ...intents, fetch, AbortController,
    crypto: { randomUUID() { throw new Error('notification refresh must not mint a write intent'); } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: (fn, ms) => { const id = ++timerID; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    window: { addEventListener: (name, handler) => windowEvents.set(name, handler) }, document,
    location: { host: 'fixture.invalid' }, matchMedia: () => ({ matches: false }) });
  await flush();
  assert.equal(get('#records').children.length, 1);
  const tick = async () => { const entry = timers.entries().next().value; assert.ok(entry, 'expected scheduled poll/reset'); timers.delete(entry[0]); entry[1].fn(); await flush(); };
  const restart = async () => { document.hidden = true; events.get('visibilitychange')(); document.hidden = false; events.get('visibilitychange')(); await flush(); };
  const snapshot = () => ({ rows: get('#records').children.map(row => row.children[0].textContent), employee: get('#employee').textContent,
    status: get('#status').textContent, saveDisabled: get('#save').disabled, newDisabled: get('#data-new').disabled,
    refreshDisabled: get('#refresh').disabled });
  return { get, calls, timers, tick, restart, snapshot, document, events, storage, stop: () => windowEvents.get('pagehide')() };
}

for (const deniedStatus of [401, 403]) {
  test(`late old list success cannot undo new ${deniedStatus} revocation`, async () => {
    const old = deferred();
    const f = await page({ orders: n => n === 2 ? old.promise : list('initial'),
      polls: n => n === 1 ? baseline() : n === 2 ? changed() : response({ code: 'FORBIDDEN' }, deniedStatus) });
    await f.tick();
    const oldRequest = f.calls.filter(call => call.path === '/api/orders')[1];
    await f.restart();
    const denied = f.snapshot();
    assert.deepEqual(denied.rows, []); assert.equal(denied.saveDisabled, true); assert.equal(denied.employee, '');
    old.resolve(list('stale-private-row', true, '999')); await flush();
    assert.deepEqual(f.snapshot(), denied, 'late data, permissions, operator and finally must not change denial');
    assert.equal(oldRequest.options?.signal?.aborted, true, 'stopping must abort the old list request');
    assert.equal(f.timers.size, 0); assert.equal(f.storage.get('previous-save-intent'), 'keep'); f.stop();
  });
}

for (const failure of ['network', '403']) test(`late old list ${failure} failure cannot clear a newer successful list`, async () => {
  const old = deferred();
  const f = await page({ orders: n => n === 2 ? old.promise : list(n === 1 ? 'initial' : 'current'),
    polls: n => n === 2 ? changed() : baseline(n) });
  await f.tick(); await f.restart();
  const current = f.snapshot(); assert.deepEqual(current.rows, ['current']); assert.equal(current.saveDisabled, false);
  if (failure === '403') old.resolve(response({ code: 'FORBIDDEN' }, 403));
  else old.reject(new Error('old request failed late'));
  await flush();
  assert.deepEqual(f.snapshot(), current); assert.equal(f.timers.size, 1); f.stop();
});

test('old finally cannot release a newer in-flight refresh control', async () => {
  const old = deferred(), current = deferred();
  const f = await page({ orders: n => n === 2 ? old.promise : n === 3 ? current.promise : list('initial'),
    polls: n => n === 2 ? changed() : baseline(n) });
  await f.tick(); await f.restart();
  assert.equal(f.get('#refresh').disabled, true);
  old.resolve(list('stale-row')); await flush();
  assert.equal(f.get('#refresh').disabled, true, 'only the current refresh can complete its controls');
  assert.deepEqual(f.snapshot().rows, []);
  current.resolve(list('latest')); await flush();
  assert.deepEqual(f.snapshot().rows, ['latest']); assert.equal(f.get('#refresh').disabled, false); f.stop();
});

test('cursor reset invalidates another pending refresh before a new baseline', async () => {
  const old = deferred();
  const f = await page({ orders: n => n === 2 ? old.promise : list(n === 1 ? 'initial' : 'reset-current', false),
    polls: n => n === 2 ? response({ code: 'CURSOR_EXPIRED' }, 409) : baseline(n) });
  f.get('#language').listeners.change({ target: { value: 'en' } }); await flush();
  const oldRequest = f.calls.filter(call => call.path === '/api/orders')[1];
  await f.tick(); assert.match(f.get('#notifications').textContent, /window changed/);
  await f.tick(); const current = f.snapshot(); assert.deepEqual(current.rows, ['reset-current']);
  old.resolve(list('pre-reset-private-row', true, '999')); await flush();
  assert.deepEqual(f.snapshot(), current); assert.equal(oldRequest.options?.signal?.aborted, true); f.stop();
});
