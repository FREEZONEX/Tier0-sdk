import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureClient } from '../../src/openapi/client.js';
import { controls, createClient, ControlError, ControlResultUnknownError } from '../../src/index.js';

const contract = {
  code: 'pump.start', name: 'Start pump', description: '', contractVersion: 'v1',
  inputSchema: { type: 'object' }, outputSchema: {}, sideEffect: 'write',
  idempotency: 'required', timeoutMs: 12000, status: 'active',
};
const result = { code: 'pump.start', contractVersion: 'v1', result: null, runID: 'run-1', status: 'succeeded', replayed: false };
const client = () => createClient({ apiHost: 'https://cloud.example', apiKey: 'fixture-key' });
const handle = () => client().controls.use({ code: 'pump.start' });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); configureClient({}); });

describe('Cloud Control single-attempt transport', () => {
  it('uses the root factory and sends business binding-like fields only inside input', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(result));
    vi.stubGlobal('fetch', fetch);
    const input = { streamId: 'business', entryId: 'row', deploymentVersion: 'value', timeoutMs: 42 };
    expect(await handle().invoke(input, { idempotencyKey: 'intent-1' })).toEqual(result);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cloud.example/openapi/v1/controls/pump.start/invoke', {
      method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key', 'X-API-Key': 'fixture-key' },
      body: JSON.stringify({ input, idempotencyKey: 'intent-1' }),
    });
  });

  it('describe/discover each issue exactly one POST and do not unwrap a data envelope', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(contract)).mockResolvedValueOnce(reply({ total: 1, list: [contract] }))
      .mockResolvedValueOnce(reply({ code: 200, data: contract }));
    vi.stubGlobal('fetch', fetch);
    expect(await handle().describe()).toEqual(contract);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://cloud.example/openapi/v1/controls/pump.start/describe');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
    expect(await client().controls.discover({ page: 2, size: 5, search: 'pump' })).toEqual({ total: 1, list: [contract] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('https://cloud.example/openapi/v1/controls/discover');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ page: 2, size: 5, search: 'pump' });
    await expect(handle().describe()).rejects.toMatchObject({ errorCode: 'CONTROL_PROTOCOL_ERROR', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns explicit replay and uses caller keys unchanged on deliberate calls', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(result)).mockResolvedValueOnce(reply({ ...result, replayed: true }));
    vi.stubGlobal('fetch', fetch);
    const control = handle();
    expect((await control.invoke({}, { idempotencyKey: 'stable' })).replayed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await control.invoke({}, { idempotencyKey: 'stable' })).replayed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].body).toEqual(fetch.mock.calls[1][1].body);
  });

  it('never invents an idempotency key or fetches a contract before invocation', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(result));
    vi.stubGlobal('fetch', fetch);
    await handle().invoke(null);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ input: null });
  });

  it.each([
    [400, 'CONTROL_INVALID_INPUT'], [401, 'INVALID_CREDENTIAL'], [403, 'CONTROL_FORBIDDEN'],
    [404, 'CONTROL_NOT_FOUND'], [409, 'CONTROL_INACTIVE'], [409, 'IDEMPOTENCY_CONFLICT'], [422, 'CONTROL_OUTPUT_INVALID'],
    [429, 'CONTROL_RATE_LIMITED'], [500, 'CONTROL_INTERNAL_ERROR'], [502, 'SOURCE_PROTOCOL_ERROR'],
    [503, 'CONTROL_UNAVAILABLE'], [504, 'CONTROL_RESULT_UNKNOWN'],
  ])('preserves HTTP %s / %s and never retries', async (status, errorCode) => {
    const fetch = vi.fn().mockResolvedValue(reply({ errorCode, message: 'public error' }, status));
    vi.stubGlobal('fetch', fetch);
    const error = await handle().invoke({}, { idempotencyKey: 'stable' }).catch(e => e);
    expect(error).toBeInstanceOf(ControlError);
    expect(error).toMatchObject({ status, errorCode, retryable: false });
    expect(error instanceof ControlResultUnknownError).toBe(errorCode === 'CONTROL_RESULT_UNKNOWN');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not leak raw network exceptions; recovery does not trigger a second request', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('fixture-key secret URL')).mockResolvedValue(reply(result));
    vi.stubGlobal('fetch', fetch);
    const error = await handle().invoke({}).catch(e => e);
    expect(error).toBeInstanceOf(ControlResultUnknownError);
    expect(error).toMatchObject({ errorCode: 'CONTROL_TRANSPORT_ERROR', status: undefined, retryable: false });
    expect(String(error)).not.toContain('fixture-key');
    expect(JSON.stringify(error)).not.toContain('secret');
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...result, replayed: 1 }, { ...result, status: 'running' }, { ...result, runID: '' },
    { ...result, contractVersion: '' }, { ...result, code: 'another' },
    { ...result, result: undefined }, { code: 200, data: result }, null,
  ])('treats a malformed success as unknown and preserves available run information', async value => {
    const fetch = vi.fn().mockResolvedValue(reply(value));
    vi.stubGlobal('fetch', fetch);
    const error = await handle().invoke({}).catch(e => e);
    expect(error).toBeInstanceOf(ControlResultUnknownError);
    expect(error).toMatchObject({ status: 200, errorCode: 'CONTROL_PROTOCOL_ERROR' });
    if (value && 'runID' in value) expect(error.runID).toBe(value.runID);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves run metadata on unknown gateway errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ errorCode: 'CONTROL_RESULT_UNKNOWN', message: 'unknown',
      runID: 'run-2', contractVersion: 'v2', status: 'unknown', replayed: false }, 504)));
    await expect(handle().invoke({})).rejects.toMatchObject({
      runID: 'run-2', contractVersion: 'v2', runStatus: 'unknown', replayed: false, status: 504,
    });
  });

  it.each([200, 401, 502, 307])('does not retry unreadable HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValue(new Response('not JSON', { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(handle().invoke({})).rejects.toBeInstanceOf(ControlResultUnknownError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('classifies interrupted response reads as unknown while retaining HTTP status', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => Promise.reject(new Error('secret')) });
    vi.stubGlobal('fetch', fetch);
    await expect(handle().invoke({})).rejects.toMatchObject({ status: 200, outcomeUnknown: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['timeoutMs', 'streamId', 'entryId', 'deploymentVersion', 'target', 'version', 'signal', 'transportTimeoutMs', 'retry', 'headers', 'workspaceID'])
  ('rejects top-level %s before networking', async key => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(handle().invoke({}, { [key]: 'forbidden' } as never)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', ' padded ', 'x'.repeat(129), '泵'.repeat(43), '泵'.repeat(42) + 'abc', '😀'.repeat(32) + 'a', 12, null])('rejects invalid keys without a request', async key => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(handle().invoke({}, { idempotencyKey: key } as never)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['x'.repeat(128), '泵'.repeat(42) + 'a', '泵'.repeat(42) + 'ab', '😀'.repeat(32)])
  ('accepts keys within the 128-byte UTF-8 boundary unchanged', async key => {
    const fetch = vi.fn().mockResolvedValue(reply(result));
    vi.stubGlobal('fetch', fetch);
    await handle().invoke({}, { idempotencyKey: key });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).idempotencyKey).toBe(key);
  });

  it.each([undefined, NaN, Infinity, { value: undefined }, { value: () => 1 }, new Date(), [, 1]])
  ('rejects non-JSON inputs before networking', async input => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(handle().invoke(input as never)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid selectors and discovery options before networking', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const code of ['../secret', 'a/b', 'a?b', 'UPPER', 'x'.repeat(129)]) {
      expect(() => client().controls.use({ code })).toThrow(TypeError);
    }
    for (const option of [{ page: 0 }, { size: 201 }, { search: 1 }, { timeoutMs: 5 }]) {
      await expect(client().controls.discover(option as never)).rejects.toBeInstanceOf(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves default config, runtime environment and callbacks at call time; clients stay isolated', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(reply(contract)));
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('TIER0_API_HOST', 'https://runtime.example');
    vi.stubEnv('TIER0_API_KEY', 'runtime-key');
    await controls.use({ code: 'pump.start' }).describe();
    expect(fetch.mock.calls[0][0]).toContain('https://runtime.example/');
    expect(fetch.mock.calls[0][1].headers['X-API-Key']).toBe('runtime-key');
    const saved = controls.use({ code: 'pump.start' });
    configureClient({ apiHost: 'https://configured.example', apiKey: 'configured-key' });
    await saved.describe();
    expect(fetch.mock.calls[1][0]).toContain('https://configured.example/');
    let key = 'callback-key-1';
    const isolated = createClient({ getApiHost: () => 'callback.example/', getApiKey: () => key });
    await isolated.controls.use({ code: 'pump.start' }).describe();
    key = 'callback-key-2';
    await isolated.controls.use({ code: 'pump.start' }).describe();
    expect(fetch.mock.calls[2][1].headers['X-API-Key']).toBe('callback-key-1');
    expect(fetch.mock.calls[3][1].headers['X-API-Key']).toBe('callback-key-2');
    await saved.describe();
    expect(fetch.mock.calls[4][1].headers['X-API-Key']).toBe('configured-key');
  });
});


describe('Control HTTP transport deadline', () => {
  const bounded = (transportTimeoutMs = 100) => createClient({
    apiHost: 'https://cloud.example', apiKey: 'fixture-key', transportTimeoutMs,
  }).controls;

  it.each(['headers', 'body'] as const)('bounds hanging %s, aborts, clears timer and never retries', async phase => {
    vi.useFakeTimers();
    // Deliberately ignore AbortSignal: the SDK must still settle within its budget.
    const pending = () => new Promise<never>(() => {});
    const fetch = vi.fn().mockImplementation(phase === 'headers' ? pending : async () => ({
      status: 200, ok: true, json: pending,
    }));
    vi.stubGlobal('fetch', fetch);
    const settled = bounded().use({ code: 'pump.start' }).invoke({}).catch(error => error);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    const error = await settled;
    expect(error).toBeInstanceOf(ControlResultUnknownError);
    expect(error).toMatchObject({
      errorCode: 'CONTROL_TRANSPORT_TIMEOUT', status: phase === 'body' ? 200 : undefined,
      retryable: false, outcomeUnknown: true,
    });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses a single total deadline across headers and body, not a reset body budget', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 75));
      return { status: 200, ok: true, json: () => new Promise(() => {}) };
    });
    vi.stubGlobal('fetch', fetch);
    const settled = bounded().use({ code: 'pump.start' }).invoke({}).catch(error => error);
    await vi.advanceTimersByTimeAsync(99);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toMatchObject({ errorCode: 'CONTROL_TRANSPORT_TIMEOUT', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['describe', 'discover'] as const)('bounds %s with ControlError and one request', async operation => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const api = bounded();
    const settled = (operation === 'describe' ? api.use({ code: 'pump.start' }).describe() : api.discover()).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    const error = await settled;
    expect(error).toBeInstanceOf(ControlError);
    expect(error).not.toBeInstanceOf(ControlResultUnknownError);
    expect(error).toMatchObject({ errorCode: 'CONTROL_TRANSPORT_TIMEOUT', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defaults to a finite 60-second budget', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const settled = handle().invoke({}).catch(error => error);
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBeInstanceOf(ControlResultUnknownError);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'gateway-error', 'network-error', 'body-error', 'consumed-body'] as const)
  ('clears timer on %s, with no later abort or retry', async outcome => {
    vi.useFakeTimers();
    const consumed = reply(result);
    await consumed.text();
    const fetch = vi.fn().mockImplementation(async () => {
      if (outcome === 'network-error') throw new DOMException('aborted transport', 'AbortError');
      if (outcome === 'gateway-error') return reply({ errorCode: 'CONTROL_FORBIDDEN', message: 'forbidden' }, 403);
      if (outcome === 'body-error') return { status: 200, ok: true, json: async () => { throw new DOMException('aborted body', 'AbortError'); } };
      if (outcome === 'consumed-body') return consumed;
      return reply(result);
    });
    vi.stubGlobal('fetch', fetch);
    const settled = await bounded().use({ code: 'pump.start' }).invoke({}).catch(error => error);
    if (['network-error', 'body-error', 'consumed-body'].includes(outcome)) expect(settled).toBeInstanceOf(ControlResultUnknownError);
    if (outcome === 'gateway-error') expect(settled).toMatchObject({ status: 403, errorCode: 'CONTROL_FORBIDDEN' });
    if (outcome === 'success') expect(settled).toEqual(result);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])('rejects invalid transport budget %s before networking', timeout => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(() => bounded(timeout)).toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
