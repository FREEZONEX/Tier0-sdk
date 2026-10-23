import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNS_V2_CODEC_SCHEMAS, UNS_V2_CONTRACT_PROVENANCE, UNS_V2_OPERATIONS } from '../../src/uns-v2/generated.js';

type Operation = {
  name: string;
  appAllowed: boolean;
  coreOnly?: boolean;
  permission: string;
  permissionAnyOf: string[];
  minPermission: number;
};
const read = (file: string) => readFileSync(new URL(`../../contracts/uns-v2/${file}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json')) as {
  operations: Operation[];
  schemas: Record<string, { properties?: Record<string, unknown> }>;
};
const contract = JSON.parse(read('contract.json')) as { operations: Operation[] };
const registry = read('registry_generated.go');
const streamRuntime = JSON.parse(read('stream-runtime.schema-overlay.json'));
const operation = (name: string) => manifest.operations.find(item => item.name === name)!;

describe('Backend App UNS access contract without generic record audit', () => {
  it('pins the exact upstream commit and all generator inputs', () => {
    expect(UNS_V2_CONTRACT_PROVENANCE.revision).toBe('6c111671a2172eb14c38f2f6d9ec329f4ee08a3d');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudRevision).toBe(UNS_V2_CONTRACT_PROVENANCE.revision);
    for (const [key, file] of Object.entries({ contract: 'contract.json', cloudSupport: 'cloud-support.json', manifest: 'manifest.json', provenance: 'provenance.json', registry: 'registry_generated.go', streamRuntime: 'stream-runtime.schema-overlay.json' })) {
      expect(UNS_V2_CONTRACT_PROVENANCE.hashes[key as keyof typeof UNS_V2_CONTRACT_PROVENANCE.hashes]).toBe(
        createHash('sha256').update(read(file)).digest('hex')
      );
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.publicOperationCount).toBe(98);
    expect(UNS_V2_CONTRACT_PROVENANCE.manifestOperationCount).toBe(114);
  });

  it('pins current Stream write schemas independently of the retained data baseline', () => {
    expect(UNS_V2_CONTRACT_PROVENANCE.streamRuntimeSchemaRevision).toBe(streamRuntime.revision);
    expect(streamRuntime.revision).toBe('c044bbea98acc3b9d2bcfb6ea597853c47b4f173');
    expect(streamRuntime.sourceManifestSHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(streamRuntime.schemas)).toEqual([
      'RuntimeStreamDefinition', 'CloudStreamScript',
      'CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse',
      'CloudStreamDocument', 'CloudStreamEntry',
    ]);
    expect(streamRuntime.schemas.CloudStreamDocument.properties.messages.readOnly).toBe(true);
    expect(streamRuntime.schemas.CloudStreamEntry.properties.request).toBeDefined();
    expect(streamRuntime.schemas.CloudStreamEntry.properties.control).toBeUndefined();
    expect(UNS_V2_OPERATIONS.streamRuntimeCapabilitiesGet.scope).toBe('stream_request:read');
    for (const name of ['RuntimeStreamDefinition', 'CloudStreamScript']) {
      expect(streamRuntime.schemas[name].properties.sdkVersion.enum).toEqual(['tier0-stream/v3']);
    }
  });

  it('does not expose retired App policy or request execution management contracts', () => {
    const generated = readFileSync(new URL('../../src/uns-v2/generated.ts', import.meta.url), 'utf8');
    for (const retired of ['hostedControl', 'controlProfileVersion', 'cloud-control-app/', 'cloud-hosted-app-control/',
      'CloudControlDiscoverReq', 'CloudControlDescribeReq', 'CloudControlInvokeReq']) {
      expect(generated).not.toContain(retired);
    }
    for (const retired of ['controlDiscover', 'controlDescribe', 'controlInvoke', 'controlAppCreate', 'hostedAppControlPolicyUpdate']) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, retired)).toBe(false);
    }
  });

  it('does not export retired Project member schemas or Project capabilities', () => {
    for (const name of ['PlatformV2ProjectMembersListReq', 'PlatformV2ProjectMembersListResponse']) {
      expect(Object.hasOwn(manifest.schemas, name)).toBe(false);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(false);
    }
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      if (Array.isArray(node.enum)) expect(node.enum).not.toContain('project');
      for (const nested of Object.values(node)) visit(nested);
    };
    visit(manifest.schemas);
  });

  it('retains the frozen upstream inputs while removing the retired request execution aliases', () => {
    for (const name of ['controlDiscover', 'controlDescribe', 'controlInvoke']) {
      expect(manifest.operations.some(item => item.name === name)).toBe(true);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
    }
  });

  it.each([
    ['catalog', ['uns.read', 'uns.write', 'uns.delete']],
    ['jobs', ['uns.read', 'uns.write', 'uns.delete']],
    ['dataAppContext', ['uns.read', 'uns.write', 'uns.delete']],
    ['recordTransactionExecute', ['uns.write', 'uns.delete']],
  ] as const)('%s preserves the upstream resource alternatives without inventing read/manage rights', (name, permissions) => {
    const metadata = operation(name);
    expect(metadata.permissionAnyOf).toEqual(permissions);
    expect(metadata.appAllowed).toBe(true);
    expect(contract.operations.find(item => item.name === name)?.permissionAnyOf).toEqual(permissions);
    const line = registry.split('\n').find(row => row.includes(`Name: "${name}"`));
    expect(line).toContain(`PermissionAnyOf: []string{${permissions.map(permission => `"${permission}"`).join(', ')}}`);
    expect(line).toContain('AppAllowed: true');
    expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
  });

  it('keeps App credentials outside every management operation and preserves Core-only policy boundaries', () => {
    const management = manifest.operations.filter(item => item.minPermission >= 3 || item.permission.includes('manage'));
    expect(management.length).toBeGreaterThan(0);
    for (const item of management) {
      expect(item.appAllowed, item.name).toBe(false);
      expect(item.permissionAnyOf.some(permission => permission.includes('manage')), item.name).toBe(false);
    }
    // Generic workspace SDK methods remain available; their presence grants no App authority.
    expect(operation('collectionCreate').appAllowed).toBe(false);
    expect(Object.hasOwn(UNS_V2_OPERATIONS, 'collectionCreate')).toBe(true);
    for (const name of ['hostedAppControlPolicyGet', 'hostedAppControlPolicyUpdate']) {
      expect(operation(name)).toMatchObject({ appAllowed: false, coreOnly: true, permission: 'workspace.api.manage', minPermission: 3 });
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
    }
    for (const name of ['appDataPolicyGet', 'appDataPolicyUpdate']) {
      expect(operation(name)).toMatchObject({ appAllowed: false, coreOnly: false, permission: 'uns.write', minPermission: 3, scope: 'uns:update' });
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
    }
    for (const name of ['appAccessGet', 'appAccessUpdate']) {
      expect(manifest.operations.some(item => item.name === name)).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
    }
  });

  it('retains create capability and source acquisition without generic record audit', () => {
    for (const name of ['CloudAppCreateCapability']) {
      expect(Object.hasOwn(manifest.schemas, name)).toBe(true);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(true);
    }
    expect(manifest.schemas.CloudAppCreateCapability.properties).toHaveProperty('inputSchema');
    expect(manifest.schemas.CloudAppCreateCapability.properties).toHaveProperty('binding');
    for (const name of ['CloudRecordAuditConfig', 'CloudRecordAuditActor', 'CloudRecordAuditEvent',
      'UnsV2RecordAuditListReq', 'UnsV2RecordAuditListResponse', 'UnsV2RecordAuditAdminListReq', 'UnsV2RecordAuditAdminListResponse']) {
      expect(Object.hasOwn(manifest.schemas, name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name), name).toBe(false);
    }
    for (const name of ['recordAuditList', 'recordAuditAdminList']) {
      expect(manifest.operations.some(item => item.name === name), name).toBe(false);
      expect(contract.operations.some(item => item.name === name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
      expect(registry).not.toContain(`Name: "${name}"`);
    }
    for (const [name, schema] of Object.entries(manifest.schemas)) {
      if (/collection/i.test(name)) expect(schema.properties ?? {}, name).not.toHaveProperty('audit');
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).toContain('app-create-capability/1');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).not.toContain('record-audit/1');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).toContain('source-bindings/1');
  });
});
