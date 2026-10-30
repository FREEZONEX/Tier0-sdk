import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createClient, createUnsV2Client, unsV2, UNS_V2_CODEC_SCHEMAS, UNS_V2_OPERATIONS, systemApi, capabilities } from '../../src/index.js';
import { unsV2 as cloudUnsV2 } from '../../src/cloud.js';

const retiredOperation = 'streamRuntimeCapabilitiesGet';
const retiredSchemas = ['CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse'];
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

function files(directory: string): string[] {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe('Stream Control readiness probe retirement', () => {
  it('removes the operation and dedicated DTOs from every generator input and output', () => {
    for (const path of ['contracts/uns-v2/contract.json', 'contracts/uns-v2/manifest.json',
      'contracts/uns-v2/cloud-support.json', 'contracts/uns-v2/registry_generated.go', 'src/uns-v2/generated.ts']) {
      const content = read(path);
      for (const name of [retiredOperation, ...retiredSchemas, '/uns/streams/runtime/capabilities/get']) {
        expect(content, `${path}: ${name}`).not.toContain(name);
      }
    }
    expect(Object.hasOwn(UNS_V2_OPERATIONS, retiredOperation)).toBe(false);
    for (const name of retiredSchemas) expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(false);
  });

  it('has no method or compatibility alias and rejects generic dispatch before HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP'));
    try {
      for (const api of [unsV2, cloudUnsV2, createUnsV2Client(), createClient({ apiHost: 'https://example.invalid' }).unsV2]) {
        expect(retiredOperation in api).toBe(false);
        expect('runtime' in api).toBe(false);
        await expect(api.call(retiredOperation as never, {} as never)).rejects.toThrow('unknown UNS v2 operation');
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('preserves real native Stream lifecycle methods on both public entry points', () => {
    for (const api of [unsV2, cloudUnsV2]) {
      for (const name of ['streamDocumentCreate', 'streamDocumentGet', 'streamDocumentUpdate', 'streamDocumentValidate',
        'streamProgramDeploy', 'streamProgramRollback', 'streamProgramVersionsList', 'streamProgramList',
        'streamDocumentDisable', 'streamProgramDelete', 'streamObservationGet', 'streamRunsList', 'streamSampleTest'] as const) {
        expect(api[name], name).toBeTypeOf('function');
        expect(UNS_V2_OPERATIONS[name].path, name).toMatch(/^\/openapi\/v2\/uns\//);
      }
    }
    expect(systemApi.openapiV2Info).toBeTypeOf('function');
    expect(capabilities.discover).toBeTypeOf('function');
  });

  it('keeps executable source and documentation examples free of this specific probe', () => {
    const paths = [...files('src'), ...files('skills'),
      ...readdirSync(root).filter(name => /^readme(?:\.|$)/i.test(name))];
    const probe = /streamRuntimeCapabilitiesGet|CloudStreamRuntimeCapabilitiesGet(?:Req|Response)|\/uns\/streams\/runtime\/capabilities\/get|stream\.runtime\.capabilities/;
    for (const path of paths) {
      if (!existsSync(new URL(path, root))) continue;
      const content = read(path);
      if (path.startsWith('src/')) expect(content, path).not.toMatch(probe);
      else {
        // Retirement prose may name the old API; runnable examples must not use it.
        expect(content, path).not.toMatch(/CloudStreamRuntimeCapabilitiesGet(?:Req|Response)|\/uns\/streams\/runtime\/capabilities\/get/);
        for (const block of content.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
          expect(block[1], path).not.toMatch(probe);
        }
      }
    }
    // General service capabilities and Broker information remain valid guidance.
    expect(read('skills/tier0-sdk/tier0-sdk-system/references/info.md')).toContain('capabilities');
    expect(read('skills/tier0-sdk/tier0-sdk-system/references/info.md')).toContain('mqttBroker');
  });
});
