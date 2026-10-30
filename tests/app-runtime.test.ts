import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, createClient } from '../src/client.js';
import * as sdk from '../src/index.js';
import { getAppRuntime, installAppRuntime } from '../src/runtime.js';

const contract = {
  code: 'pump.start', name: 'Start', description: '', contractVersion: 'v1',
  inputSchema: {}, outputSchema: {}, sideEffect: 'write', idempotency: 'required', timeoutMs: 1000, status: 'active',
};
const installed: (() => void)[] = [];
afterEach(() => { while (installed.length) installed.pop()!(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('App runtime injection', () => {
  it('automatically supplies requests without host or credentials, including an already-created client', async () => {
    vi.stubGlobal('window', {});
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const isolated = createClient();
    const request = vi.fn(async () => Response.json(contract));
    installed.push(installAppRuntime({ appId: 'trusted-app-id', request }));
    expect(await client.streams.requests.use({ code: 'pump.start' }).describe()).toEqual(contract);
    expect(await isolated.streams.requests.use({ code: 'pump.start' }).describe()).toEqual(contract);
    expect(request).toHaveBeenCalledWith('/openapi/v2/stream-requests/pump.start/describe', {}, { signal: expect.any(AbortSignal) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed for a browser missing its trusted runtime', async () => {
    vi.stubGlobal('window', {}); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createClient({ apiHost: 'https://example', apiKey: 'server-secret' }).streams.requests.use({ code: 'pump.start' }).describe())
      .rejects.toMatchObject({ errorCode: 'STREAM_REQUEST_TRANSPORT_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds an unresponsive bridge without retrying invocation', async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => new Promise<Response>(() => {}));
    installed.push(installAppRuntime({ appId: 'trusted-app-id', request }));
    const result = createClient({ transportTimeoutMs: 10 }).streams.requests.use({ code: 'pump.start' }).invoke({}).catch(error => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatchObject({ errorCode: 'STREAM_REQUEST_TRANSPORT_TIMEOUT', outcomeUnknown: true, retryable: false });
    expect(request).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not expose retired control exports or runtime aliases', () => {
    expect(Object.keys(sdk).filter(key => /control/i.test(key))).toEqual([]);
    expect(Object.keys(client)).toEqual(['streams', 'capabilities', 'unsV2', 'dispose']);
    expect(getAppRuntime()).toBeUndefined();
  });

  it('does not resurrect a previous App identity on runtime removal', () => {
    const first = { appId: 'first-app', request: async () => Response.json({}) };
    const second = { appId: 'second-app', request: async () => Response.json({}) };
    const removeFirst = installAppRuntime(first);
    const removeSecond = installAppRuntime(second);
    removeFirst();
    expect(getAppRuntime()).toBe(second);
    removeSecond();
    expect(getAppRuntime()).toBeUndefined();
  });
});
