import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/index.js';
import { assertCurrentSourceStreamRequest } from '../../src/uns-v2/single-model.js';

const source = { name: 'HTTP', protocol: 'http-api', config: { endpoint: 'https://device.example', options: {} } };
const stream = { name: 'Program', model: 'integration', script: { code: 'module.exports = () => {};', timeoutMs: 1000 } };
const client = () => createClient({ apiHost: 'https://gateway.example', apiKey: 'fixture' }).unsV2;
const vectors = JSON.parse(readFileSync(new URL('../../contracts/stream-common/selector-vectors.json', import.meta.url), 'utf8')) as {
  id: string; position: 'source-config' | 'stream-script' | 'stream-program'; value: Record<string, unknown>; expected: string;
}[];
afterEach(() => vi.unstubAllGlobals());

describe('single Source/Stream model requests', () => {
  it.each(vectors)('consumes common selector vector $id without rewriting input', vector => {
    const request = vector.position === 'source-config'
      ? { document: { ...source, config: vector.value } }
      : vector.position === 'stream-script' ? { document: { ...stream, script: vector.value } } : { program: vector.value };
    const snapshot = structuredClone(request);
    const check = () => assertCurrentSourceStreamRequest(vector.position === 'source-config' ? 'sourceDocumentCreate' : 'streamDocumentCreate', request);
    if (vector.expected === 'selector-rejected') expect(check).toThrow('model selectors');
    else expect(check).not.toThrow();
    expect(request).toEqual(snapshot);
  });
  it.each([
    { document: { ...source, config: { ...source.config, configVersion: 1 } } },
    { document: { ...source, config: { ...source.config, configVersion: 2 } } },
    { items: [{ document: { ...source, config: { ...source.config, configVersion: 3 } } }] },
  ])('rejects legacy Source callers before dispatch without rewriting them', async body => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const snapshot = structuredClone(body);
    await expect(client().call('sourceDocumentCreate', { dryRun: true, ...body } as never)).rejects.toThrow('model selectors');
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(snapshot);
  });

  it.each(['sdkVersion', 'supportedVersions'])('rejects Stream selector %s in script and program shorthand', async selector => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const body of [
      { document: { ...stream, script: { ...stream.script, [selector]: 'legacy' } } },
      { program: { name: 'Program', script: '', [selector]: 'legacy' } },
    ]) {
      await expect(client().call('streamDocumentCreate', { dryRun: true, ...body } as never)).rejects.toThrow('model selectors');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks Source patches and atomic batch items before network dispatch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(client().call('sourceDocumentUpdate', {
      dryRun: true, items: [{ id: '12', expectedRevision: 3, patch: { config: { ...source.config, configVersion: 2 } } }],
    } as never)).rejects.toThrow('model selectors');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves business inputs, immutable release identity and exact configuration revisions', () => {
    const request = {
      document: stream, input: { sdkVersion: 'business', configVersion: 3, supportedVersions: ['business'] },
      release: 7, idempotencyKey: 'original-call',
      program: { name: 'Program', sourceBindings: [{ sourceId: '12', configRevision: 9007199254740993n }] },
    };
    const snapshot = structuredClone(request);
    assertCurrentSourceStreamRequest('streamSampleTest', request);
    expect(request).toEqual(snapshot);
    expect(() => assertCurrentSourceStreamRequest('recordInsertOne', { data: request.input })).not.toThrow();
  });

  it('discovers current capabilities without selecting or exposing an interpreter generation', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      product: 'cloud', contractVersion: '1.0', apiContractVersions: ['openapi/v1'], sdkContractVersions: ['control/v1'],
      interpreterContractVersions: ['historical-selector'], capabilities: [], deprecations: [],
    })));
    vi.stubGlobal('fetch', fetch);
    const result = await createClient({ apiHost: 'https://gateway.example', apiKey: 'fixture' }).capabilities.discover();
    expect(result).not.toHaveProperty('interpreterContractVersions');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
