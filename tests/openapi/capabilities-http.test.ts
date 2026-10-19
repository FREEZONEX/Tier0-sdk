import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, CapabilityError } from '../../src/index.js';

const fixture = {
  product: 'cloud', contractVersion: '1.0', apiContractVersions: ['openapi/v1'],
  interpreterContractVersions: ['tier0-stream/v2'], sdkContractVersions: ['control/v1'],
  capabilities: [{ code: 'control.invoke.v1', releaseEnabled: true, allowed: true, enabled: false,
    state: 'unavailable', availability: 'unavailable', contractVersions: ['openapi/v1', 'tier0-stream/v2', 'control/v1'] }],
  deprecations: [],
};
const received: { path?: string; method?: string; headers: IncomingMessage['headers']; body: string }[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({ path: req.url, method: req.method, headers: req.headers, body });
  respond(req, res);
});
let apiHost: string;
function send(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const client = (transportTimeoutMs = 2000) => createClient({ apiHost, apiKey: 'fixture-workspace-key', transportTimeoutMs });
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('capability real HTTP fixture (no device execution or external credentials)', () => {
  it('sends the exact authenticated POST with an empty body object and returns direct public JSON', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, fixture);
    expect(await client().capabilities.discover()).toEqual(fixture);
    expect(received.length - start).toBe(1);
    expect(received[start]).toMatchObject({ path: '/openapi/v1/capabilities/discover', method: 'POST', body: '{}',
      headers: { authorization: 'Bearer fixture-workspace-key', 'x-api-key': 'fixture-workspace-key', 'content-type': 'application/json' } });
    expect(received[start].headers['idempotency-key']).toBeUndefined();
  });

  it('accepts Namespace API v2 beside Control API v1 over the actual HTTP transport', async () => {
    const start = received.length;
    const body = { ...fixture, apiContractVersions: ['openapi/v1', 'openapi/v2'], capabilities: [
      { code: 'namespace.v2', releaseEnabled: true, allowed: true, enabled: true,
        state: 'ready', availability: 'available', contractVersions: ['openapi/v2'] },
      ...fixture.capabilities,
    ] };
    respond = (_req, res) => send(res, body);
    const result = await client().capabilities.discover();
    expect(result).toEqual(body);
    expect(result.capabilities[1]).toMatchObject({ enabled: false, state: 'unavailable' });
    expect(received.length - start).toBe(1);
    expect(received[start].path).toBe('/openapi/v1/capabilities/discover');
  });

  it('does not cache a release or readiness transition', async () => {
    const api = client();
    const start = received.length;
    respond = (_req, res) => send(res, fixture);
    expect((await api.capabilities.discover()).capabilities[0].enabled).toBe(false);
    respond = (_req, res) => send(res, { ...fixture, capabilities: [{ ...fixture.capabilities[0], enabled: true, state: 'ready', availability: 'available' }] });
    expect((await api.capabilities.discover()).capabilities[0].enabled).toBe(true);
    expect(received.length - start).toBe(2);
  });

  it.each([[401, 'INVALID_CREDENTIAL'], [403, 'CAPABILITY_FORBIDDEN'], [503, 'CAPABILITY_UNAVAILABLE'], [500, 'FUTURE_STRING_CODE']] as const)
  ('preserves real HTTP %s / %s with exactly one request', async (status, errorCode) => {
    const start = received.length;
    respond = (_req, res) => send(res, { errorCode, message: 'public message' }, status);
    const error = await client().capabilities.discover().catch(error => error);
    expect(error).toBeInstanceOf(CapabilityError);
    expect(error).toMatchObject({ status, errorCode, retryable: false });
    expect(received.length - start).toBe(1);
  });

  it('does not follow redirects', async () => {
    const start = received.length;
    respond = (_req, res) => { res.writeHead(307, { Location: '/redirected' }); res.end('{}'); };
    await expect(client().capabilities.discover()).rejects.toMatchObject({ status: 307, errorCode: 'CAPABILITY_PROTOCOL_ERROR' });
    expect(received.length - start).toBe(1);
  });

  it.each(['envelope', 'invalid-json', 'unsupported-version', 'socket', 'truncated'])('does not retry %s failures', async kind => {
    const start = received.length;
    respond = (req, res) => {
      if (kind === 'socket') { req.socket.destroy(); return; }
      if (kind === 'envelope') { send(res, { code: 200, data: fixture }); return; }
      if (kind === 'unsupported-version') { send(res, { ...fixture, contractVersion: '2.0' }); return; }
      if (kind === 'invalid-json') { res.writeHead(200); res.end('not JSON'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 999 });
      res.write('{"product":');
      setTimeout(() => res.destroy(), 5);
    };
    const error = await client().capabilities.discover().catch(error => error);
    expect(error).toBeInstanceOf(CapabilityError);
    expect(error.errorCode).toBe(kind === 'socket' ? 'CAPABILITY_TRANSPORT_ERROR' :
      kind === 'unsupported-version' ? 'CAPABILITY_UNSUPPORTED_VERSION' : 'CAPABILITY_PROTOCOL_ERROR');
    respond = (_req, res) => send(res, fixture);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(received.length - start).toBe(1);
  });

  it.each(['headers', 'body', 'error-body'])('aborts stalled %s within the whole-exchange budget', async phase => {
    const start = received.length;
    let closed = false;
    respond = (_req, res) => {
      res.once('close', () => { closed = true; });
      if (phase !== 'headers') {
        res.writeHead(phase === 'body' ? 200 : 503, { 'Content-Type': 'application/json' });
        res.write('{"partial":');
      }
    };
    const started = Date.now();
    await expect(client(150).capabilities.discover()).rejects.toMatchObject({
      name: 'CapabilityError', errorCode: 'CAPABILITY_TRANSPORT_TIMEOUT', retryable: false,
      status: phase === 'headers' ? undefined : phase === 'body' ? 200 : 503,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    await vi.waitFor(() => expect(closed).toBe(true));
    respond = (_req, res) => send(res, fixture);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(received.length - start).toBe(1);
  });
});
