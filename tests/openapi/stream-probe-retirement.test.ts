import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { client, createClient, createUnsV2Client, unsV2, UNS_V2_CODEC_SCHEMAS, UNS_V2_OPERATIONS, systemApi } from '../../src/index.js';
import { client as cloudClient } from '../../src/cloud.js';

const root = new URL('../../', import.meta.url);
const operation = 'streamRuntimeCapabilitiesGet';
const schemas = ['CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse'];
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const parse = (path: string) => JSON.parse(read(path));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-app-stream-probe-'));
  cpSync(new URL('contracts/uns-v2', root), join(dir, 'contracts/uns-v2'), { recursive: true });
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src/uns-v2'), { recursive: true });
  for (const script of ['generate-uns-v2.mjs', 'sync-stream-runtime-contract.mjs']) {
    cpSync(new URL(`scripts/${script}`, root), join(dir, 'scripts', script));
  }
  return dir;
}

function files(directory: string): string[] {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe('App Stream probe retirement', () => {
  it('removes the probe from frozen contracts, runtime overlay and public codec exports', () => {
    for (const path of ['contract.json', 'manifest.json', 'cloud-support.json', 'registry_generated.go', 'stream-runtime.schema-overlay.json']) {
      const content = read(`contracts/uns-v2/${path}`);
      for (const token of [operation, ...schemas, '/uns/streams/runtime/capabilities/get']) expect(content, path).not.toContain(token);
    }
    expect(Object.hasOwn(UNS_V2_OPERATIONS, operation)).toBe(false);
    for (const name of schemas) expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(false);
  });

  it('rejects old names before HTTP across isolated and global clients while retaining App interactions', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP'));
    try {
      for (const api of [unsV2, client.unsV2, cloudClient.unsV2, createUnsV2Client(), createClient().unsV2]) {
        expect(operation in api).toBe(false);
        await expect(api.call(operation as never, {} as never)).rejects.toThrow('unknown UNS v2 operation');
        for (const name of ['streamDocumentCreate', 'streamDocumentUpdate', 'streamDocumentValidate', 'streamProgramDeploy',
          'streamProgramRollback', 'streamProgramVersionsList', 'streamRunsList', 'streamDocumentDisable', 'streamProgramDelete'] as const) {
          expect(api[name], name).toBeTypeOf('function');
        }
      }
      expect(client.streams.requests.use({ code: 'orders.approve' }).invoke).toBeTypeOf('function');
      expect(client.streams.messages.use({ topic: 'orders/created' }).subscribe).toBeTypeOf('function');
      expect(client.streams.messages.use({ topic: 'orders/accepted' }).publish).toBeTypeOf('function');
      expect(systemApi.openapiv1info).toBeTypeOf('function');
      expect(client.capabilities.discover).toBeTypeOf('function');
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it.each(['contract.json', 'manifest.json', 'cloud-support.json'])('rejects a restored probe in %s at codegen', file => {
    const dir = fixture();
    try {
      const path = join(dir, 'contracts/uns-v2', file);
      const input = JSON.parse(readFileSync(path, 'utf8'));
      input.operations.push({ name: operation });
      writeFileSync(path, JSON.stringify(input));
      const result = spawnSync(process.execPath, [join(dir, 'scripts/generate-uns-v2.mjs')], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('retired Stream readiness probe must not be restored');
      expect(existsSync(join(dir, 'src/uns-v2/generated.ts'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['schemas', 'operationMetadata'])('rejects a restored probe in overlay %s', field => {
    const dir = fixture();
    try {
      const path = join(dir, 'contracts/uns-v2/stream-runtime.schema-overlay.json');
      const overlay = JSON.parse(readFileSync(path, 'utf8'));
      overlay[field][field === 'schemas' ? schemas[0] : operation] = {};
      writeFileSync(path, JSON.stringify(overlay));
      const result = spawnSync(process.execPath, [join(dir, 'scripts/generate-uns-v2.mjs')], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(field === 'schemas' ? 'must not replace unrelated data schemas' : 'must not restore operation authority metadata');
      expect(existsSync(join(dir, 'src/uns-v2/generated.ts'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([false, true])('regenerates v3 overlay without the probe when upstream still exposes it: %s', legacy => {
    const dir = fixture();
    try {
      const backend = join(dir, 'backend');
      const overlay = parse('contracts/uns-v2/stream-runtime.schema-overlay.json');
      mkdirSync(join(backend, 'share/unscontract'), { recursive: true });
      const upstream = { schemas: { ...overlay.schemas }, operations: legacy ? [{ name: operation }] : [] };
      if (legacy) for (const name of schemas) upstream.schemas[name] = { type: 'object' };
      writeFileSync(join(backend, 'share/unscontract/manifest.json'), JSON.stringify(upstream));
      const git = (args: string[]) => execFileSync('git', ['-C', backend, ...args], { stdio: 'pipe' });
      git(['init', '--quiet']);
      git(['add', '.']);
      git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=SDK fixture',
        '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Pinned fixture']);
      execFileSync(process.execPath, [join(dir, 'scripts/sync-stream-runtime-contract.mjs'), backend, 'HEAD']);
      const regenerated = JSON.parse(readFileSync(join(dir, 'contracts/uns-v2/stream-runtime.schema-overlay.json'), 'utf8'));
      expect(regenerated.schemas).toEqual(overlay.schemas);
      expect(regenerated.operationMetadata).toEqual({});
      execFileSync(process.execPath, [join(dir, 'scripts/generate-uns-v2.mjs')]);
      expect(readFileSync(join(dir, 'src/uns-v2/generated.ts'), 'utf8')).not.toContain(operation);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps shipped source, Skills and examples free of retired probe callers', () => {
    for (const path of [...files('src'), ...files('skills'), ...files('examples/app-streams')]) {
      expect(read(path), path).not.toMatch(/streamRuntimeCapabilitiesGet|CloudStreamRuntimeCapabilitiesGet(?:Req|Response)|\/uns\/streams\/runtime\/capabilities\/get|stream\.runtime\.capabilities\s*\(/);
    }
    expect(read('skills/tier0-sdk/tier0-sdk-system/references/info.md')).toContain('mqttBroker');
  });
});
