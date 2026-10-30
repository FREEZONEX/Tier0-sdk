import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilities, CapabilityError, configureClient, createClient } from '../../src/index.js';
const item = { code: 'namespace.v2', state: 'readiness_unknown', reasonCode: 'READINESS_NOT_ASSESSED', contractVersions: ['openapi/v2'] };
const fixture = () => ({ product: 'cloud', contractVersion: '2.0', apiContractVersions: ['openapi/v2'], sdkContractVersions: ['stream-requests/v1'], capabilities: [{ ...item }], deprecations: [] });
const client = () => createClient({ apiHost: 'https://cloud.example', apiKey: 'fixture-key', transportTimeoutMs: 100 }).capabilities;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); configureClient({}); });

describe('capability discovery contract 2.0', () => {
  it('uses the authenticated v2 endpoint and preserves unassessed readiness', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(fixture())); vi.stubGlobal('fetch', fetch);
    expect(await client().discover()).toEqual(fixture());
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cloud.example/openapi/v2/capabilities/discover', {
      method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal), body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key', 'X-API-Key': 'fixture-key' },
    });
  });
  it.each(['disabled', 'not_supported', 'unavailable', 'readiness_unknown', 'ready'])('preserves %s with its reason instead of deriving another boolean', async state => {
    const body = { ...fixture(), capabilities: [{ ...item, state, reasonCode: 'PUBLIC_REASON' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await client().discover()).toEqual(body);
  });
  it('does not expose retired duplicate flags or unknown private extensions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...fixture(), capabilities: [{ ...item,
      enabled: false, allowed: true, releaseEnabled: true, availability: 'unknown', internal: 'hidden' }] })));
    expect(await client().discover()).toEqual(fixture());
  });
  it('ignores optional interaction domains without blocking core discovery', async () => {
    const body = { ...fixture(), sdkContractVersions: ['stream-requests/future'], capabilities: [item, { code: 'future.requests', contractVersions: ['future'] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await client().discover()).toEqual({ ...body, capabilities: [item] });
  });
  it.each([{ contractVersion: '1.0' }, { contractVersion: '3.0' }, { product: 'unknown' }, { apiContractVersions: ['openapi/v1'] },
    { capabilities: [{ ...item, contractVersions: ['openapi/v3'] }] }])('rejects incompatible contracts without a legacy fallback: %j', async patch => {
    const fetch = vi.fn().mockResolvedValue(reply({ ...fixture(), ...patch })); vi.stubGlobal('fetch', fetch);
    await expect(client().discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_UNSUPPORTED_VERSION', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], { code: 200, data: fixture() },
    ...['product', 'contractVersion', 'apiContractVersions', 'sdkContractVersions', 'capabilities', 'deprecations'].map(key => ({ ...fixture(), [key]: undefined })),
    ...[{ reasonCode: undefined }, { reasonCode: '' }, { reasonCode: 1 }, { state: 'future' }, { contractVersions: [1] }].map(patch => ({ ...fixture(), capabilities: [{ ...item, ...patch }] })),
    { ...fixture(), capabilities: [item, item] }, { ...fixture(), capabilities: [null] }])('rejects malformed public responses: %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    await expect(client().discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_PROTOCOL_ERROR' });
  });
  it.each([401, 403, 429, 500, 503])('preserves HTTP %s without escalating or retrying', async status => {
    const fetch = vi.fn().mockResolvedValue(reply({ errorCode: 'PUBLIC_REASON', message: 'public message' }, status)); vi.stubGlobal('fetch', fetch);
    await expect(client().discover()).rejects.toMatchObject({ status, errorCode: 'PUBLIC_REASON', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects workspace and request overrides before sending', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect((client().discover as (...args: unknown[]) => unknown)({workspaceID: 2})).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('resolves the current global identity on each call', async () => {
    const fetch = vi.fn().mockImplementation(async () => reply(fixture())); vi.stubGlobal('fetch', fetch);
    configureClient({ apiHost: 'https://first.example', apiKey: 'first-key' }); await capabilities.discover();
    configureClient({ apiHost: 'https://second.example', apiKey: 'second-key' }); await capabilities.discover();
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['https://first.example/openapi/v2/capabilities/discover', 'https://second.example/openapi/v2/capabilities/discover']);
  });
});

describe('capability bounded shared transport', () => {
  it.each(['headers', 'body', 'error-body'])('bounds stalled %s, aborts and clears its timer', async phase => {
    vi.useFakeTimers();
    const pending = () => new Promise<never>(() => {});
    const fetch = vi.fn().mockImplementation(phase === 'headers' ? pending : async () => ({ status: phase === 'body' ? 200 : 503, json: pending }));
    vi.stubGlobal('fetch', fetch);
    const settled = client().discover().catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await settled).toMatchObject({ name: 'CapabilityError', errorCode: 'CAPABILITY_TRANSPORT_TIMEOUT', retryable: false,
      status: phase === 'headers' ? undefined : phase === 'body' ? 200 : 503 });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'gateway', 'network', 'body'])('clears the timer on %s and redacts transport exceptions', async outcome => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => {
      if (outcome === 'network') throw new Error('fixture-key secret-url');
      if (outcome === 'body') return { status: 200, json: async () => { throw new Error('secret-key'); } };
      return reply(outcome === 'success' ? fixture() : { errorCode: 'CAPABILITY_UNAVAILABLE', message: 'public' }, outcome === 'success' ? 200 : 503);
    });
    vi.stubGlobal('fetch', fetch);
    const result = await client().discover().catch(error => error);
    if (outcome === 'network' || outcome === 'body') {
      expect(result).toBeInstanceOf(CapabilityError);
      expect(result.errorCode).toBe(outcome === 'network' ? 'CAPABILITY_TRANSPORT_ERROR' : 'CAPABILITY_PROTOCOL_ERROR');
      expect(String(result)).not.toMatch(/secret|fixture-key/);
    }
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});


describe('App request capability contracts', () => {
  it.each(['stream.requests.v1', 'stream.requests.invoke.v1'])('requires the v2 transport and request protocol for %s', async code => {
    const body = { ...fixture(), capabilities: [{ ...item, code, contractVersions: ['openapi/v2', 'stream-requests/v1'] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    expect((await client().discover()).capabilities[0].code).toBe(code);
    body.capabilities[0].contractVersions = ['openapi/v1', 'stream-requests/v1'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(client().discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_UNSUPPORTED_VERSION' });
  });
});
