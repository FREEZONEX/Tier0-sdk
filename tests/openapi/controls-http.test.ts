import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, ControlError, ControlResultUnknownError } from '../../src/index.js';

const definition = {
  code: 'pump.start', name: '启动泵', description: '公开合同', contractVersion: '1',
  inputSchema: { type: 'object' }, outputSchema: {}, sideEffect: 'write',
  idempotency: 'required', timeoutMs: 15000, status: 'active',
};
const result = { code: 'pump.start', contractVersion: '1', result: { started: true }, runID: 'http-run', status: 'succeeded', replayed: false };
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
const control = () => client.controls.use({ code: 'pump.start' });

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = createClient({ apiHost, apiKey: 'fixture-workspace-key', transportTimeoutMs: 2000 });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('Control real HTTP fixture (no external credentials)', () => {
  it('matches all Gateway paths, bodies and existing authentication headers', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, { total: 1, list: [definition] });
    expect(await client.controls.discover({ search: 'pump' })).toEqual({ total: 1, list: [definition] });
    respond = (_req, res) => send(res, definition);
    expect(await control().describe()).toEqual(definition);
    respond = (_req, res) => send(res, result);
    const input = { streamId: 'business-stream', entryId: 'business-entry', deploymentVersion: 'business-version', timeoutMs: 8 };
    expect(await control().invoke(input, { idempotencyKey: 'intent-http' })).toEqual(result);
    const requests = received.slice(start);
    expect(requests).toHaveLength(3);
    expect(requests.map(r => r.path)).toEqual([
      '/openapi/v1/controls/discover', '/openapi/v1/controls/pump.start/describe', '/openapi/v1/controls/pump.start/invoke',
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
    [400, 'CONTROL_INVALID_INPUT'], [401, 'INVALID_CREDENTIAL'], [403, 'CONTROL_FORBIDDEN'],
    [404, 'CONTROL_NOT_FOUND'], [409, 'CONTROL_INACTIVE'], [409, 'IDEMPOTENCY_CONFLICT'], [422, 'CONTROL_OUTPUT_INVALID'],
    [429, 'CONTROL_RATE_LIMITED'], [502, 'SOURCE_PROTOCOL_ERROR'], [503, 'CONTROL_UNAVAILABLE'], [504, 'CONTROL_RESULT_UNKNOWN'],
  ])('keeps HTTP %s / %s with one actual network request', async (status, errorCode) => {
    const start = received.length;
    respond = (_req, res) => send(res, { errorCode, message: 'public error' }, status);
    const error = await control().invoke({}, { idempotencyKey: 'intent-http' }).catch(e => e);
    expect(error).toBeInstanceOf(ControlError);
    expect(error).toMatchObject({ status, errorCode, retryable: false });
    expect(error instanceof ControlResultUnknownError).toBe(errorCode === 'CONTROL_RESULT_UNKNOWN');
    expect(received.length - start).toBe(1);
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
    await expect(control().invoke({}, { idempotencyKey: 'intent-unknown' })).rejects.toBeInstanceOf(ControlResultUnknownError);
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
    const error = await bounded.controls.use({ code: 'pump.start' })
      .invoke({ timeoutMs: 9 }, { idempotencyKey: 'stable-deadline-key' }).catch(error => error);
    expect(error).toBeInstanceOf(ControlResultUnknownError);
    expect(error).toMatchObject({
      errorCode: 'CONTROL_TRANSPORT_TIMEOUT', status: phase === 'headers' ? undefined : phase === 'error-body' ? 503 : 200,
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
