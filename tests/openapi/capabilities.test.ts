import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilities, CapabilityError, configureClient, createClient } from '../../src/index.js';

const item = {
  code: 'control.invoke.v1', releaseEnabled: true, enabled: false, allowed: true,
  state: 'readiness_unknown', availability: 'unknown', contractVersions: ['openapi/v1', 'tier0-stream/v2', 'control/v1'],
};
const fixture = () => ({
  product: 'cloud', contractVersion: '1.0', apiContractVersions: ['openapi/v1'],
  interpreterContractVersions: ['tier0-stream/v2'], sdkContractVersions: ['control/v1'],
  capabilities: [{ ...item }], deprecations: [],
});
const client = () => createClient({ apiHost: 'https://cloud.example', apiKey: 'fixture-key', transportTimeoutMs: 100 }).capabilities;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); configureClient({}); });

describe('frozen capability discovery contract', () => {
  it('returns direct public JSON, preserves unknown readiness and omits unconfigured productVersion', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(fixture()));
    vi.stubGlobal('fetch', fetch);
    const response = await client().discover();
    expect(response).toEqual(fixture());
    expect(response).not.toHaveProperty('productVersion');
    expect(response.capabilities[0]).toMatchObject({ releaseEnabled: true, allowed: true, enabled: false, availability: 'unknown' });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://cloud.example/openapi/v1/capabilities/discover', {
      method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal), body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key', 'X-API-Key': 'fixture-key' },
    });
  });

  it.each([
    [false, false, 'disabled', 'unavailable'],
    [true, false, 'not_supported', 'unavailable'],
    [true, false, 'unavailable', 'unavailable'],
    [true, false, 'readiness_unknown', 'unknown'],
    [true, true, 'ready', 'available'],
  ])('preserves the separate release/readiness state %s/%s/%s/%s', async (releaseEnabled, enabled, state, availability) => {
    const body = fixture();
    body.capabilities = [{ ...item, releaseEnabled, enabled, state, availability }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await client().discover()).toEqual(body);
  });

  it('accepts every known capability with its exact version labels', async () => {
    const body = fixture();
    body.apiContractVersions.push('openapi/v2');
    body.capabilities = Object.entries({
      'namespace.v2': ['openapi/v2'], 'source.v1': ['openapi/v1'], 'stream.v2': ['tier0-stream/v2'],
      'control.v1': ['openapi/v1', 'control/v1'], 'control.invoke.v1': item.contractVersions,
    }).map(([code, contractVersions]) => ({ ...item, code, contractVersions }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await client().discover()).toEqual(body);
  });

  it('accepts the mixed Cloud API versions while preserving unavailable Control execution', async () => {
    const body = { ...fixture(), apiContractVersions: ['openapi/v1', 'openapi/v2'], capabilities: [
      { code: 'namespace.v2', releaseEnabled: true, allowed: true, enabled: true,
        state: 'ready', availability: 'available', contractVersions: ['openapi/v2'] },
      { ...item, state: 'unavailable', availability: 'unavailable' },
    ] };
    const fetch = vi.fn().mockResolvedValue(reply(body));
    vi.stubGlobal('fetch', fetch);
    expect(await client().discover()).toEqual(body);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { apiContractVersions: ['openapi/v1', 'openapi/v2'], contractVersions: ['openapi/v1'] },
    { apiContractVersions: ['openapi/v1'], contractVersions: ['openapi/v2'] },
  ])('rejects a Namespace v2 API version mismatch without retrying', async versions => {
    const body = { ...fixture(), apiContractVersions: versions.apiContractVersions, capabilities: [
      { code: 'namespace.v2', releaseEnabled: true, allowed: true, enabled: true,
        state: 'ready', availability: 'available', contractVersions: versions.contractVersions },
    ] };
    const fetch = vi.fn().mockResolvedValue(reply(body));
    vi.stubGlobal('fetch', fetch);
    await expect(client().discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_UNSUPPORTED_VERSION', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('projects known fields, skips future capabilities (even unsupported versions) and preserves deprecations', async () => {
    const body = { ...fixture(), productVersion: '2026.10', internal: 'hidden',
      capabilities: [{ ...item, worker: 'hidden' }, { code: 'future.v7', enabled: true, contractVersions: ['future/v7'] }, { code: '__proto__' }],
      deprecations: [{ contract: 'old/v1', replacement: 'openapi/v1', sunsetAt: '2027-01-01T00:00:00Z', secret: true }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await client().discover()).toEqual({ ...fixture(), productVersion: '2026.10',
      deprecations: [{ contract: 'old/v1', replacement: 'openapi/v1', sunsetAt: '2027-01-01T00:00:00Z' }],
    });
  });

  it('accepts filtered empty capabilities and optional deprecation fields', async () => {
    const body = { ...fixture(), capabilities: [], deprecations: [{ contract: 'old/v1' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    expect(await client().discover()).toEqual(body);
  });

  it.each([
    { product: 'enterprise' }, { contractVersion: '2.0' }, { apiContractVersions: ['openapi/v2'] },
    { interpreterContractVersions: ['tier0-stream/v3'] }, { sdkContractVersions: ['0.5.4'] },
    { capabilities: [{ ...item, contractVersions: ['control/v2'] }] },
    { capabilities: [{ ...item, contractVersions: ['openapi/v1', 'tier0-stream/v2', 'control/v2'] }] },
  ])('fails unsupported versions with a typed error and never substitutes enabled', async patch => {
    const fetch = vi.fn().mockResolvedValue(reply({ ...fixture(), ...patch }));
    vi.stubGlobal('fetch', fetch);
    await expect(client().discover()).rejects.toMatchObject({ name: 'CapabilityError', status: 200, errorCode: 'CAPABILITY_UNSUPPORTED_VERSION', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...item, code: 'control.v1', contractVersions: ['openapi/v1', 'control/v1', 'control/v2'] },
    { ...item, contractVersions: [...item.contractVersions, 'control/v2'] },
  ])('preserves additional versions when all required versions remain without inferring readiness', async capability => {
    const body = { ...fixture(), capabilities: [capability] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    const response = await client().discover();
    expect(response).toEqual(body);
    expect(response.capabilities[0]).toMatchObject({ enabled: false, state: 'readiness_unknown', availability: 'unknown' });
  });

  it.each([
    null, [], { code: 200, data: fixture() }, { data: fixture() },
    ...['product', 'contractVersion', 'apiContractVersions', 'interpreterContractVersions', 'sdkContractVersions', 'capabilities', 'deprecations']
      .map(key => ({ ...fixture(), [key]: undefined })),
    { ...fixture(), productVersion: 12 }, { ...fixture(), productVersion: null },
    { ...fixture(), apiContractVersions: [1] }, { ...fixture(), sdkContractVersions: ['control/v1', 'control/v1'] },
    ...[{ enabled: 1 }, { allowed: 'true' }, { releaseEnabled: 1 }, { state: 'future' }, { availability: 'future' },
      { contractVersions: [1] }, { contractVersions: [...item.contractVersions, 2] },
      { contractVersions: [...item.contractVersions, 'control/v2', 'control/v2'] },
      { contractVersions: [...item.contractVersions, null] }, { contractVersions: [...item.contractVersions, ''] },
      { enabled: true }, { state: 'ready', enabled: true, availability: 'unknown' },
      { state: 'ready', enabled: true, availability: 'available', allowed: false }, { releaseEnabled: false },
      { state: 'disabled' }, { state: 'unavailable', availability: 'available' }]
      .map(patch => ({ ...fixture(), capabilities: [{ ...item, ...patch }] })),
    { ...fixture(), capabilities: [item, item] }, { ...fixture(), capabilities: [null] },
    { ...fixture(), capabilities: [{ enabled: true }] },
    { ...fixture(), deprecations: [{ contract: 1 }] }, { ...fixture(), deprecations: [{ contract: 'x', replacement: 1 }] },
    { ...fixture(), deprecations: [{ contract: 'x', sunsetAt: null }] },
  ])('rejects malformed or contradictory discovery JSON', async body => {
    const fetch = vi.fn().mockResolvedValue(reply(body));
    vi.stubGlobal('fetch', fetch);
    await expect(client().discover()).rejects.toMatchObject({ name: 'CapabilityError', errorCode: 'CAPABILITY_PROTOCOL_ERROR', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429, 500, 503])('preserves HTTP %s and unknown string error codes without retries', async status => {
    const fetch = vi.fn().mockResolvedValue(reply({ errorCode: 'FUTURE_BACKEND_CODE', message: 'public message' }, status));
    vi.stubGlobal('fetch', fetch);
    await expect(client().discover()).rejects.toMatchObject({ name: 'CapabilityError', status, errorCode: 'FUTURE_BACKEND_CODE', message: 'public message', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ code: 503, msg: 'opaque' }, { errorCode: 503, message: 'wrong' }, null])('rejects malformed error envelopes', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body, 503)));
    await expect(client().discover()).rejects.toMatchObject({ status: 503, errorCode: 'CAPABILITY_PROTOCOL_ERROR' });
  });

  it('rejects JS workspace/body/options overrides without fetching', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const input of [{ workspaceID: 2 }, {}, undefined, { retry: true }]) {
      await expect((client().discover as (...args: unknown[]) => unknown)(input)).rejects.toBeInstanceOf(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves global configuration, environment, and isolated factory key callbacks on each call', async () => {
    const fetch = vi.fn().mockImplementation(async () => reply(fixture()));
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('TIER0_API_HOST', 'https://runtime.example');
    vi.stubEnv('TIER0_API_KEY', 'env-key');
    await capabilities.discover();
    configureClient({ apiHost: 'https://configured.example', apiKey: 'configured-key' });
    await capabilities.discover();
    let key = 'callback-1';
    let host = 'https://isolated.example';
    const isolated = createClient({ getApiHost: () => host, getApiKey: () => key });
    await isolated.capabilities.discover();
    key = 'callback-2'; host = 'https://rotated.example';
    await isolated.capabilities.discover();
    await capabilities.discover();
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      'https://runtime.example/openapi/v1/capabilities/discover', 'https://configured.example/openapi/v1/capabilities/discover',
      'https://isolated.example/openapi/v1/capabilities/discover', 'https://rotated.example/openapi/v1/capabilities/discover',
      'https://configured.example/openapi/v1/capabilities/discover',
    ]);
    expect(fetch.mock.calls.map(call => call[1].headers['X-API-Key'])).toEqual(['env-key', 'configured-key', 'callback-1', 'callback-2', 'configured-key']);
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
