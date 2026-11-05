import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from '../../src/files.js';
import { configureClient, HttpClient } from '../../src/openapi/client.js';

type Seen = { url: string; headers: IncomingHttpHeaders };
const key = 'task-only-fixture-key';
let origin: Server;
let storage: Server;
let originURL: string;
let storageURL: string;
let originRequests: Seen[] = [];
let storageRequests: Seen[] = [];

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('downloadFile real HTTP redirects', () => {
  beforeAll(async () => {
    storage = createServer((req, res) => {
      storageRequests.push({ url: req.url ?? '', headers: req.headers });
      if (req.url === '/return') {
        res.writeHead(302, { Location: `${originURL}/returned` }).end();
      } else if (req.url === '/denied') {
        res.writeHead(403).end('object denied');
      } else if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"value":"storage"}');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=report.csv' });
        res.end('storage-content');
      }
    });
    storageURL = await listen(storage);
    origin = createServer((req, res) => {
      originRequests.push({ url: req.url ?? '', headers: req.headers });
      const url = new URL(req.url ?? '/', originURL);
      const path = url.searchParams.get('filePath');
      if (url.pathname === '/sdk/cross') {
        res.writeHead(302, { Location: `${storageURL}/json` }).end();
      } else if (url.pathname === '/sdk/cross307') {
        res.writeHead(307, { Location: `${storageURL}/json` }).end();
      } else if (url.pathname === '/sdk/same') {
        res.writeHead(307, { Location: '/sdk/final' }).end();
      } else if (url.pathname === '/sdk/final') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"value":"origin"}');
      } else if (url.pathname === '/openapi/v1/auth/whoami' || url.pathname === '/openapi/v2/auth/whoami') {
        if (req.headers['x-api-key'] !== key || req.headers.authorization !== undefined) {
          res.writeHead(401).end('invalid or ambiguous credential');
        } else if (url.searchParams.get('redirect') === 'true') {
          res.writeHead(307, { Location: `${storageURL}/json` }).end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"value":"whoami"}');
        }
      } else if (url.pathname === '/openapi/v1/assets/files/download' && path === 'same') {
        res.writeHead(302, { Location: '/same-origin' }).end();
      } else if (url.pathname === '/openapi/v1/assets/files/download' && path === 'cross') {
        res.writeHead(302, { Location: `${storageURL}/object?signature=fixture` }).end();
      } else if (url.pathname === '/openapi/v1/assets/files/download' && path === 'return') {
        res.writeHead(302, { Location: `${storageURL}/return` }).end();
      } else if (url.pathname === '/openapi/v1/assets/files/download' && path === 'denied') {
        res.writeHead(302, { Location: `${storageURL}/denied` }).end();
      } else if (url.pathname === '/same-origin' || url.pathname === '/returned') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('origin-content');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('direct-content');
      }
    });
    originURL = await listen(origin);
  });

  beforeEach(() => {
    vi.stubEnv('TIER0_API_HOST', undefined);
    vi.stubEnv('TIER0_API_KEY', undefined);
    configureClient({ apiHost: originURL, apiKey: key });
    originRequests = [];
    storageRequests = [];
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all([close(origin), close(storage)]);
  });

  it('authenticates the initial direct download and preserves the response', async () => {
    const result = await downloadFile({ filePath: 'direct' });
    expect(await result.response.text()).toBe('direct-content');
    expect(result.contentType).toBe('text/plain');
    expect(originRequests[0].headers.authorization).toBe(`Bearer ${key}`);
    expect(originRequests[0].headers['x-api-key']).toBeUndefined();
  });

  it('retains authentication for a same-origin relative redirect', async () => {
    const result = await downloadFile({ filePath: 'same' });
    expect(await result.response.text()).toBe('origin-content');
    expect(originRequests).toHaveLength(2);
    expect(originRequests[1].headers.authorization).toBe(`Bearer ${key}`);
    expect(originRequests[1].headers['x-api-key']).toBeUndefined();
  });

  it('downloads a cross-origin signed URL without forwarding the Tier0 key', async () => {
    const result = await downloadFile({ filePath: 'cross' });
    expect(await result.response.text()).toBe('storage-content');
    expect(result.contentType).toBe('text/csv');
    expect(result.contentDisposition).toBe('attachment; filename=report.csv');
    expect(originRequests[0].headers.authorization).toBe(`Bearer ${key}`);
    expect(storageRequests).toHaveLength(1);
    expect(storageRequests[0].url).toBe('/object?signature=fixture');
    expect(storageRequests[0].headers.authorization).toBeUndefined();
    expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
  });

  it('does not restore credentials when a cross-origin redirect returns to the API origin', async () => {
    const result = await downloadFile({ filePath: 'return' });
    expect(await result.response.text()).toBe('origin-content');
    expect(storageRequests[0].headers.authorization).toBeUndefined();
    expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
    expect(originRequests[1].headers.authorization).toBeUndefined();
    expect(originRequests[1].headers['x-api-key']).toBeUndefined();
  });

  it('propagates the final storage error without sending credentials', async () => {
    await expect(downloadFile({ filePath: 'denied' })).rejects.toThrow('download failed: 403 object denied');
    expect(storageRequests[0].headers.authorization).toBeUndefined();
    expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
  });

  it('preserves abort behavior', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(downloadFile({ filePath: 'direct', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(originRequests).toHaveLength(0);
  });

  it('keeps ordinary HttpClient redirects usable without forwarding credentials across origins', async () => {
    const client = new HttpClient({ apiHost: originURL, apiKey: key });
    await expect(client.get('/sdk/cross')).resolves.toEqual({ value: 'storage' });
    expect(originRequests[0].headers.authorization).toBe(`Bearer ${key}`);
    expect(originRequests[0].headers['x-api-key']).toBeUndefined();
    expect(storageRequests[0].headers.authorization).toBeUndefined();
    expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
  });

  it('keeps ordinary same-origin 307 POST redirects and authentication', async () => {
    const client = new HttpClient({ apiHost: originURL, apiKey: key });
    await expect(client.post('/sdk/same', { value: 1 })).resolves.toEqual({ value: 'origin' });
    expect(originRequests).toHaveLength(2);
    expect(originRequests[1].headers.authorization).toBe(`Bearer ${key}`);
    expect(originRequests[1].headers['x-api-key']).toBeUndefined();
  });

  it('does not forward the key on an ordinary cross-origin 307 POST', async () => {
    const client = new HttpClient({ apiHost: originURL, apiKey: key });
    await expect(client.post('/sdk/cross307', { value: 1 })).resolves.toEqual({ value: 'storage' });
    expect(originRequests[0].headers.authorization).toBe(`Bearer ${key}`);
    expect(storageRequests[0].headers.authorization).toBeUndefined();
    expect(storageRequests[0].headers['x-api-key']).toBeUndefined();
  });

  it.each(['/openapi/v1/auth/whoami', '/openapi/v2/auth/whoami'])(
    'keeps %s authentication but rejects its redirects before forwarding the key',
    async (path) => {
      const client = new HttpClient({ apiHost: originURL, apiKey: key });
      await expect(client.post(path, {})).resolves.toEqual({ value: 'whoami' });
      expect(originRequests[0].headers['x-api-key']).toBe(key);
      expect(originRequests[0].headers.authorization).toBeUndefined();
      await expect(client.post(`${path}?redirect=true`, {})).rejects.toThrow();
      expect(storageRequests).toHaveLength(0);
    }
  );
});
