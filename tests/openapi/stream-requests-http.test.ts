import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, StreamRequestError, StreamRequestResultUnknownError } from '../../src/index.js';

const definition = {
  code: 'pump.start', name: '启动泵', description: '公开合同', contractVersion: '1',
  inputSchema: { type: 'object' }, outputSchema: {}, sideEffect: 'write',
  idempotency: 'required', timeoutMs: 15000, status: 'active',
};
const result = { code: 'pump.start', contractVersion: '1', result: { started: true }, runID: 'http-run', status: 'completed', replayed: false };
type RequestRecord = { path?: string; method?: string; headers: IncomingMessage['headers']; body: unknown };
const received: RequestRecord[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({ path: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : undefined });
  respond(req, res);
});
let client: ReturnType<typeof createClient>;
let apiHost: string;
function send(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const control = () => client.streams.requests.use({ code: 'pump.start' });

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = createClient({ apiHost, apiKey: 'fixture-workspace-key', transportTimeoutMs: 2000 });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('StreamRequest real HTTP fixture (no external credentials)', () => {
  it('uses injected Node App host/key and APP_ID automatically on the current HTTP mappings', async () => {
    // This loopback adapter verifies SDK transport only. SYS authority rejection
    // and legacy stored-scope migration require their separate native tests.
    const appId = 'fa9e0650-931a-4b49-983b-6d0f130268c0';
    const key = 'sk-app-local-contract-fixture';
    vi.stubEnv('TIER0_API_HOST', apiHost);
    vi.stubEnv('TIER0_API_KEY', key);
    vi.stubEnv('APP_ID', appId);
    const automatic = createClient();
    const start = received.length;
    try {
      expect(typeof window).toBe('undefined');
      respond = (req, res) => {
        if (req.url?.endsWith('/stream-requests/discover')) send(res, { total: 1, list: [definition] });
        else if (req.url?.endsWith('/describe')) send(res, definition);
        else if (req.url?.endsWith('/invoke')) send(res, result);
        else send(res, { errorCode: 'STREAM_MESSAGE_FORBIDDEN', message: 'fixture has no message grant' }, 403);
      };
      await automatic.streams.requests.discover();
      await automatic.streams.requests.use({ code: 'pump.start' }).describe();
      await automatic.streams.requests.use({ code: 'pump.start' }).invoke({}, { idempotencyKey: 'server-env-intent' });
      await expect(automatic.streams.messages.use({ topic: 'server/env' }).publish({ intent: 'explicit' }))
        .rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_CONNECT_DENIED' });
      const rows = received.slice(start);
      expect(rows.map(row => row.path)).toEqual([
        '/openapi/v2/stream-requests/discover', '/openapi/v2/stream-requests/pump.start/describe',
        '/openapi/v2/stream-requests/pump.start/invoke', '/openapi/v2/stream-messages/connect',
      ]);
      for (const row of rows) {
        expect(row.headers.authorization).toBe(`Bearer ${key}`);
        expect(row.headers['x-api-key']).toBe(key);
        expect(row.headers['x-tier0-app-data-subject']).toBeUndefined();
      }
      expect(rows[3].body).toMatchObject({ appId, topics: [{ topic: 'server/env', publish: true, subscribe: false }] });
      expect((rows[3].body as { clientPublicKey: string }).clientPublicKey).toMatch(/^U[A-Z2-7]{55}$/);
    } finally { await automatic.dispose(); vi.unstubAllEnvs(); }
  });

  it('matches all Gateway paths, bodies and existing authentication headers', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, { total: 1, list: [definition] });
    expect(await client.streams.requests.discover({ search: 'pump' })).toEqual({ total: 1, list: [definition] });
    respond = (_req, res) => send(res, definition);
    expect(await control().describe()).toEqual(definition);
    respond = (_req, res) => send(res, result);
    const input = { streamId: 'business-stream', entryId: 'business-entry', deploymentVersion: 'business-version', timeoutMs: 8 };
    expect(await control().invoke(input, { idempotencyKey: 'intent-http' })).toEqual(result);
    const requests = received.slice(start);
    expect(requests).toHaveLength(3);
    expect(requests.map(r => r.path)).toEqual([
      '/openapi/v2/stream-requests/discover', '/openapi/v2/stream-requests/pump.start/describe', '/openapi/v2/stream-requests/pump.start/invoke',
    ]);
    expect(requests.map(r => r.body)).toEqual([{ search: 'pump' }, {}, { input, idempotencyKey: 'intent-http' }]);
    for (const request of requests) {
      expect(request.method).toBe('POST');
      expect(request.headers.authorization).toBe('Bearer fixture-workspace-key');
      expect(request.headers['x-api-key']).toBe('fixture-workspace-key');
      expect(request.headers['content-type']).toBe('application/json');
      expect(request.headers['idempotency-key']).toBeUndefined();
    }
  });

  it.each([
    [401, 'INVALID_CREDENTIAL'], [403, 'STREAM_REQUEST_FORBIDDEN'], [409, 'IDEMPOTENCY_CONFLICT'],
    [429, 'STREAM_REQUEST_RATE_LIMITED'], [503, 'STREAM_REQUEST_UNAVAILABLE'], [504, 'STREAM_REQUEST_RESULT_UNKNOWN'],
  ])('keeps HTTP %s / %s with one actual network request', async (status, errorCode) => {
    const start = received.length;
    respond = (_req, res) => send(res, { errorCode, message: 'public error' }, status);
    const error = await control().invoke({}, { idempotencyKey: 'intent-http' }).catch(e => e);
    expect(error).toBeInstanceOf(StreamRequestError);
    expect(error).toMatchObject({ status, errorCode, retryable: false,
      outcomeUnknown: errorCode === 'STREAM_REQUEST_RESULT_UNKNOWN' });
    expect(error instanceof StreamRequestResultUnknownError).toBe(errorCode === 'STREAM_REQUEST_RESULT_UNKNOWN');
    expect(received.length - start).toBe(1);
    expect(received[start].method).toBe('POST');
    expect(received[start].path).toBe('/openapi/v2/stream-requests/pump.start/invoke');
  });

  it.each(['unknown', 'failed', 'succeeded', 'running'])
  ('rejects actual HTTP 200 with non-success status %s, retaining receipts and one POST', async status => {
    const start = received.length;
    respond = (_req, res) => send(res, { ...result, status, replayed: true });
    const error = await control().invoke({}, { idempotencyKey: 'stable-status-intent' }).catch(e => e);
    expect(error).toBeInstanceOf(StreamRequestResultUnknownError);
    expect(error).toMatchObject({ status: 200, runStatus: status, runID: result.runID,
      contractVersion: result.contractVersion, replayed: true, outcomeUnknown: true, retryable: false });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(received.length - start).toBe(1);
    expect(received[start].body).toEqual({ input: {}, idempotencyKey: 'stable-status-intent' });
  });

  it('requires an explicit call with the same key to replay', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, result);
    await control().invoke({}, { idempotencyKey: 'stable-http' });
    expect(received.length - start).toBe(1);
    respond = (_req, res) => send(res, { ...result, replayed: true });
    expect((await control().invoke({}, { idempotencyKey: 'stable-http' })).replayed).toBe(true);
    expect(received.length - start).toBe(2);
    expect(received[start].body).toEqual(received[start + 1].body);
  });

  it('does not follow a 307 redirect and resend a write', async () => {
    const start = received.length;
    respond = (_req, res) => { res.writeHead(307, { Location: '/redirected' }); res.end(); };
    await expect(control().invoke({})).rejects.toMatchObject({ status: 307, outcomeUnknown: true });
    expect(received.length - start).toBe(1);
  });

  it('does not retry a socket closed after the server reads the request', async () => {
    const start = received.length;
    respond = (req, _res) => req.socket.destroy();
    await expect(control().invoke({}, { idempotencyKey: 'intent-unknown' })).rejects.toBeInstanceOf(StreamRequestResultUnknownError);
    respond = (_req, res) => send(res, result);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(received.length - start).toBe(1);
  });

  it('does not retry a truncated HTTP response', async () => {
    const start = received.length;
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 999 });
      res.write('{"runID":"http-run"');
      setTimeout(() => res.destroy(), 5);
    };
    await expect(control().invoke({})).rejects.toMatchObject({ status: 200, outcomeUnknown: true });
    expect(received.length - start).toBe(1);
  });

  it.each(['headers', 'body', 'error-body'] as const)
  ('aborts stalled %s within the HTTP budget after consuming the request; never resends', async phase => {
    const start = received.length;
    let connectionClosed = false;
    respond = (_req, res) => {
      res.once('close', () => { connectionClosed = true; });
      if (phase !== 'headers') {
        res.writeHead(phase === 'error-body' ? 503 : 200, { 'Content-Type': 'application/json' });
        res.write('{"partial":'); // Send headers but never complete the response body.
      }
    };
    const bounded = createClient({ apiHost, apiKey: 'fixture-workspace-key', transportTimeoutMs: 150 });
    const started = Date.now();
    const error = await bounded.streams.requests.use({ code: 'pump.start' })
      .invoke({ timeoutMs: 9 }, { idempotencyKey: 'stable-deadline-key' }).catch(error => error);
    expect(error).toBeInstanceOf(StreamRequestResultUnknownError);
    expect(error).toMatchObject({
      errorCode: 'STREAM_REQUEST_TRANSPORT_TIMEOUT', status: phase === 'headers' ? undefined : phase === 'error-body' ? 503 : 200,
      outcomeUnknown: true, retryable: false,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    await vi.waitFor(() => expect(connectionClosed).toBe(true));
    respond = (_req, res) => send(res, result); // Recovery cannot cause an automatic resend.
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(received.length - start).toBe(1);
    expect(received[start].body).toEqual({ input: { timeoutMs: 9 }, idempotencyKey: 'stable-deadline-key' });
  });

  it.each(['泵'.repeat(42) + 'ab', '😀'.repeat(32)])('sends an exactly 128-byte key unchanged over HTTP', async key => {
    const start = received.length;
    respond = (_req, res) => send(res, result);
    await control().invoke({}, { idempotencyKey: key });
    expect(received.length - start).toBe(1);
    expect(received[start].body).toEqual({ input: {}, idempotencyKey: key });
  });

});
