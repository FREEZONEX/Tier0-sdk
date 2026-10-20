import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as intents from '../examples/cloud-uns-app/public/order-intent.mjs';

// Execute the actual page code with a tiny DOM/fetch fixture, without a browser,
// external credentials or another package. Only its ESM import is injected.
const source = readFileSync(new URL('../examples/cloud-uns-app/public/app.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '');
async function page({ language = 'en', canWrite = false, data = { orderNo: 'visible-order' } } = {}) {
  const element = () => ({ textContent: '', dataset: {}, children: [], listeners: {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    addEventListener(name, handler) { this.listeners[name] = handler; } });
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const createKey = vi.fn();
  const storage = new Map([['uns-orders-language', language]]);
  const fetch = vi.fn(async (path) => ({ ok: path === '/api/orders', status: path === '/api/orders' ? 200 : 403,
    json: async () => path === '/api/orders' ? { operator: '42', app: 'Fixture', canWrite, dataMode: 'core',
      receiptDomain: intents.receiptDomains.core, items: [{ id: 'fixture-id', revision: 1, data }] } : { code: 'CONTROL_FORBIDDEN' } }));
  runInNewContext(source, { ...intents, fetch, crypto: { randomUUID: createKey },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: get, querySelectorAll: () => [], documentElement: { dataset: {} }, createElement: element },
    location: { host: 'fixture.invalid' }, matchMedia: () => ({ matches: false }) });
  await vi.waitFor(() => expect(get('#records').children).toHaveLength(1));
  return { get, createKey, storage, fetch };
}

describe('Cloud App actual page read-only and field visibility', () => {
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
    const cells = fixture.get('#records').children[0].children.map((cell) => cell.textContent);
    expect(cells).toEqual(['visible-order', expected, expected, '1']);
    expect(fixture.fetch.mock.calls.every(([, options]) => !options?.body)).toBe(true);
  });

  it('preserves a visible zero amount and shows migration guidance only when writable', async () => {
    const fixture = await page({ canWrite: true, data: { orderNo: 'visible-order', amount: 0, status: 'draft' } });
    expect(fixture.get('#records').children[0].children[1].textContent).toBe('0');
    expect(fixture.get('#status').textContent).toContain('Data permissions have been upgraded');
    expect(fixture.get('#data-new').disabled).toBe(false);
    expect(fixture.createKey).not.toHaveBeenCalled();
  });
});
