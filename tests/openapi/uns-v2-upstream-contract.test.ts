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
const operation = (name: string) => manifest.operations.find(item => item.name === name)!;

describe('Backend App UNS access contract without generic record audit', () => {
  it('pins the exact upstream commit and all generator inputs', () => {
    expect(UNS_V2_CONTRACT_PROVENANCE.revision).toBe('ed4ab593a142457278727e650f1fb795734d9907');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudRevision).toBe(UNS_V2_CONTRACT_PROVENANCE.revision);
    expect(UNS_V2_CONTRACT_PROVENANCE.resolvedCloudContract).toBe(true);
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).toContain('+source-vendor/2');
    for (const [key, file] of Object.entries({ contract: 'contract.json', cloudSupport: 'cloud-support.json', manifest: 'manifest.json', provenance: 'provenance.json', registry: 'registry_generated.go' })) {
      expect(UNS_V2_CONTRACT_PROVENANCE.hashes[key as keyof typeof UNS_V2_CONTRACT_PROVENANCE.hashes]).toBe(
        createHash('sha256').update(read(file)).digest('hex')
      );
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.publicOperationCount).toBe(86);
    expect(UNS_V2_CONTRACT_PROVENANCE.manifestOperationCount).toBe(97);
  });

  it('exports exactly public v5 routes and rejects retired operations at the generation boundary', () => {
    expect(Object.keys(UNS_V2_OPERATIONS)).toEqual(manifest.operations.filter(item => !item.coreOnly).map(item => item.name));
    for (const name of ['sourceCreate', 'sourceGet', 'sourceList', 'sourceUpdate', 'streamProgramCreate', 'streamProgramGet',
      'streamProgramInvoke', 'directoryCreate', 'collectionCreate', 'metaBatchExecute', 'recordChangesPoll', 'recordInsertMany']) {
      expect(manifest.operations.some(item => item.name === name), name).toBe(false);
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(false);
    }
    for (const name of ['sourceDocumentCreate', 'sourceDocumentGet', 'streamDocumentCreate', 'metadataInsertOne', 'recordGet',
      'recordQueryBatch', 'recordUpdateOne', 'recordBulkWrite', 'sampleAppend', 'sampleFind', 'sampleLatestValues', 'recordSubscribe']) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(true);
    }
  });

  it('retires only the public readiness probe and retains real Stream operations', () => {
    const retired = 'streamRuntimeCapabilitiesGet';
    expect(Object.hasOwn(UNS_V2_OPERATIONS, retired)).toBe(false);
    expect(manifest.operations.some(item => item.name === retired)).toBe(false);
    expect(contract.operations.some(item => item.name === retired)).toBe(false);
    expect(registry).not.toContain(`Name: "${retired}"`);
    for (const schema of ['CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse']) {
      expect(Object.hasOwn(manifest.schemas, schema)).toBe(false);
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, schema)).toBe(false);
    }
    for (const name of ['streamDocumentCreate', 'streamDocumentUpdate', 'streamDocumentValidate',
      'streamProgramDeploy', 'streamProgramRollback', 'streamProgramVersionsList', 'streamRunsList',
      'streamObservationGet', 'streamSampleTest']) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name), name).toBe(true);
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

  it.each([
    ['catalog', ['uns.read', 'uns.write', 'uns.delete']],
    ['jobs', ['uns.read', 'uns.write', 'uns.delete']],
    ['dataAppContext', ['uns.read', 'uns.write', 'uns.delete']],
    ['recordTransactionExecute', ['uns.write', 'uns.delete']],
  ] as const)('%s preserves the upstream resource alternatives without inventing read/manage rights', (name, permissions) => {
    const metadata = operation(name);
    expect(metadata.permissionAnyOf).toEqual(permissions);
    expect(metadata.appAllowed).toBe(name !== 'jobs');
    expect(contract.operations.find(item => item.name === name)?.permissionAnyOf).toEqual(permissions);
    const line = registry.split('\n').find(row => row.includes(`Name: "${name}"`));
    expect(line).toContain(`PermissionAnyOf: []string{${permissions.map(permission => `"${permission}"`).join(', ')}}`);
    expect(line).toContain(`AppAllowed: ${name !== 'jobs'}`);
    expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
  });

  it('keeps App credentials outside every management operation and preserves Core-only policy boundaries', () => {
    const management = manifest.operations.filter(item => (item.minPermission >= 3 || item.permission.includes('manage')) && !item.name.startsWith('appCollections'));
    expect(management.length).toBeGreaterThan(0);
    for (const item of management) {
      expect(item.appAllowed, item.name).toBe(false);
      expect(item.permissionAnyOf.some(permission => permission.includes('manage')), item.name).toBe(false);
    }
    // Generic workspace SDK methods remain available; their presence grants no App authority.
    expect(operation('metadataInsertOne').appAllowed).toBe(false);
    expect(Object.hasOwn(UNS_V2_OPERATIONS, 'metadataInsertOne')).toBe(true);
    for (const name of ['hostedAppControlPolicyGet', 'hostedAppControlPolicyUpdate']) {
      expect(operation(name)).toMatchObject({ appAllowed: false, permission: 'stream.requests.manage', minPermission: 3 });
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(true);
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

  it.each([
    ['controlDiscover', 'read', ['stream.requests.read', 'stream.requests.manage']],
    ['controlDescribe', 'read', ['stream.requests.read', 'stream.requests.manage']],
    ['controlInvoke', 'invoke', []],
    ['hostedAppControlPolicyGet', 'manage', []],
    ['hostedAppControlPolicyUpdate', 'manage', []],
    ['controlGrantGet', 'manage', []],
    ['controlGrantSet', 'manage', []],
    ['appStreamAccessList', 'manage', []],
  ] as const)('%s uses unified Stream request permissions', (name, action, alternatives) => {
    const permission = `stream.requests.${action}`;
    const scope = `stream.requests:${action}`;
    expect(operation(name)).toMatchObject({ permission, scope, permissionAnyOf: alternatives });
    expect(contract.operations.find(item => item.name === name)).toMatchObject({ permission, scope, permissionAnyOf: alternatives });
    expect(UNS_V2_OPERATIONS[name].scope).toBe(scope);
    const row = registry.split('\n').find(line => line.includes(`Name: "${name}"`));
    expect(row).toContain(`Permission: "${permission}"`);
    expect(row).toContain(`Scope: "${scope}"`);
  });

  it('limits request grants to App/user subjects and removes retired Control permission enums', () => {
    for (const name of ['CloudControlGrantGetReq', 'CloudControlGrantSetReq', 'CloudControlGrantInfo', 'CloudControlGrantMutation']) {
      expect(manifest.schemas[name].properties).toHaveProperty('principalKind', { type: 'string', enum: ['app', 'user'] });
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name), name).toBe(true);
    }
    const serialized = JSON.stringify({ operations: manifest.operations, schemas: manifest.schemas });
    for (const permission of ['control.read', 'control.execute', 'control.write', 'control.manage']) {
      expect(serialized).not.toContain(`"${permission}"`);
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
