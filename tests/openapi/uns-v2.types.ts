import {
  createClient,
  type IndexSpec,
  type RuntimeStreamDefinition,
  type CloudAppCreateCapability,
  UnsV2RawNumber,
  type PlatformV2UsersListReq,
  type UnsV2JSONValue,
  type UnsV2OperationName,
  type UnsV2Request,
  type UnsV2Response,
} from '../../src/index.js';

const client = createClient({ apiHost: 'https://example.invalid', apiKey: 'workspace-bound' });
// @ts-expect-error The retired readiness probe has no public method.
client.unsV2.streamRuntimeCapabilitiesGet({});
// @ts-expect-error Generic dispatch cannot restore the retired probe.
client.unsV2.call('streamRuntimeCapabilitiesGet', {});
// @ts-expect-error The retired probe is not a public operation.
const retiredStreamProbe: UnsV2OperationName = 'streamRuntimeCapabilitiesGet';
// @ts-expect-error The retired probe has no request mapping.
type RetiredStreamProbeRequest = UnsV2Request<'streamRuntimeCapabilitiesGet'>;
// @ts-expect-error The retired probe has no response mapping.
type RetiredStreamProbeResponse = UnsV2Response<'streamRuntimeCapabilitiesGet'>;
// @ts-expect-error The retired request DTO is not exported.
import type { CloudStreamRuntimeCapabilitiesGetReq } from '../../src/index.js';
// @ts-expect-error The retired response DTO is not exported.
import type { CloudStreamRuntimeCapabilitiesGetResponse } from '../../src/index.js';
// @ts-expect-error The Cloud entry cannot export the retired DTO either.
import type { CloudStreamRuntimeCapabilitiesGetResponse as RetiredCloudProbe } from '../../src/cloud.js';
void [retiredStreamProbe, null as RetiredStreamProbeRequest | RetiredStreamProbeResponse | null];
// Native runtime DTO from the pinned source; hosted Cloud documents retain their own shape.
const nativeDefinition: RuntimeStreamDefinition = {
  name: 'native-http', script: '', sdkVersion: 'tier0-stream/v3',
  sourceBindings: [{ sourceId: '101', configRevision: new UnsV2RawNumber('9007199254740993'), acquisition: {} }],
};
const retiredNativeVersion: RuntimeStreamDefinition = {
  ...nativeDefinition,
  // @ts-expect-error Current Stream writes require v3; v2 exists only in frozen history.
  sdkVersion: 'tier0-stream/v2',
};
void retiredNativeVersion;
const invalidBinding: NonNullable<RuntimeStreamDefinition['sourceBindings']>[number] = {
  sourceId: '101', acquisition: {},
  // @ts-expect-error Native binding revision must be an exact integer, not a string.
  configRevision: '2',
};
// @ts-expect-error Each native binding requires protocol acquisition parameters.
const missingAcquisition: NonNullable<RuntimeStreamDefinition['sourceBindings']>[number] = { sourceId: '101', configRevision: 2 };
void [nativeDefinition, invalidBinding, missingAcquisition];
const ownAppContext = client.unsV2.dataAppContext({});
const createHint: CloudAppCreateCapability = { version: 'cloud-app-create-capability/v1', allowed: true, reason: 'allowed',
  appRevision: 19, collectionRevision: new UnsV2RawNumber('9007199254740993'), binding: 'a'.repeat(64),
  inputSchema: { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'integer' } } } };
const currentCreateHint = ownAppContext.then(response => {
  const capability: CloudAppCreateCapability | undefined = response.data.collections[0].createCapability;
  return capability?.inputSchema;
});
// @ts-expect-error An unknown capability version cannot be assumed compatible.
const unknownCreateHint: CloudAppCreateCapability = { ...createHint, version: 'cloud-app-create-capability/v2' };
// @ts-expect-error A binding is not a create credential or a business field.
client.unsV2.recordInsertOne({ collectionId: 'orders', data: {}, binding: createHint.binding });
void [createHint, currentCreateHint, unknownCreateHint];
void ownAppContext;
const list = client.unsV2.recordFind({ collectionId: 'orders', limit: 20, cursor: 'opaque' });
const jobs = client.unsV2.jobs({ queries: [{ queryId: 'job', jobIds: ['job-1'] }] });
const transaction = client.unsV2.recordTransactionExecute({ items: [] });
const sources = client.unsV2.sourceList({ page: 1, size: 20, archived: false });
const deployment = client.unsV2.streamProgramDeploy({
  id: 'stream-1', dryRun: false, expectedRevision: 3, expectedSourceRevision: 7, idempotencyKey: 'deploy-1',
});
const scopedSamples = client.unsV2.sampleFind({ collectionId: 'measurements', recordIds: ['machine-1'], from: 0, to: 1000, page: { mode: 'cursor', size: 20 } });
const sourceState = client.unsV2.sourceStateUpdate({
  dryRun: false, items: [{ id: '101', expectedRevision: 2, desiredState: 'enabled', confirmedImpactRevision: 'reviewed-confirmation' }],
});
const sourceDelete = client.unsV2.sourceDelete({ dryRun: true, items: [{ id: '101', expectedRevision: 2, confirmedImpactRevision: 'reviewed-confirmation' }] });
const sourceImpact = client.unsV2.sourceImpact({ id: '101', expectedRevision: 2, action: 'disable', size: 20 });
const sourceHistory = client.unsV2.sourceHistory({ id: '101', size: 20 });
const observations = client.unsV2.sourceObservationsGet({ items: [{ id: '101', expectedRevision: 2 }] });
const streamObservation = client.unsV2.streamObservationGet({ id: '202' });
const runs = client.unsV2.streamRunsList({ id: '202', size: 20, cursor: 'opaque' });
const documentValidation = client.unsV2.streamDocumentValidate({ document: {
  name: 'collector', model: 'collection',
  script: { sdkVersion: 'tier0-stream/v3', code: 'module.exports = api => api;', timeoutMs: 1_000 },
  sources: [{ alias: 'plant', sourceId: 'source-1', configRevision: 2, resources: ['line/1'] }],
} });
const operation: UnsV2OperationName = 'recordInsertOne';
const singleIndex: IndexSpec = { path: 'serial', unique: true };
const compositeIndex: IndexSpec = { paths: ['plant', 'serial'], kind: 'btree', target: 'records', unique: true };
// @ts-expect-error IndexSpec requires one path declaration.
const missingIndexPath: IndexSpec = { unique: true };
// @ts-expect-error Single and composite declarations are mutually exclusive.
const ambiguousIndexPath: IndexSpec = { path: 'serial', paths: ['serial'] };
void [singleIndex, compositeIndex, missingIndexPath, ambiguousIndexPath];
const request: UnsV2Request<'directoryGet'> = { id: 'directory-1' };
type DirectoryGetResponse = UnsV2Response<'directoryGet'>;
const exactInt64: PlatformV2UsersListReq = { page: 9_223_372_036_854_775_807n };
const exactBusinessNumber: UnsV2JSONValue = new UnsV2RawNumber('1.0000000000000001');
void [list, jobs, transaction, sources, deployment, scopedSamples, sourceState, sourceDelete, sourceImpact, sourceHistory, documentValidation,
  observations, streamObservation, runs, operation, request, exactInt64, exactBusinessNumber, null as DirectoryGetResponse | null];

// @ts-expect-error core-only graph has no Gateway route and is not exposed by the SDK.
client.unsV2.graph({ queries: [] });
// @ts-expect-error Credential creation is Core-only and has no public Gateway route.
client.unsV2.sourceCredentialCreate({});
// @ts-expect-error Ingress discovery is Core-only and has no public Gateway route.
client.unsV2.sourceIngressGet({ id: '101' });
// @ts-expect-error Ingress rotation is Core-only and has no public Gateway route.
client.unsV2.sourceIngressRotate({ id: '101' });
// @ts-expect-error identity and workspace binding cannot be supplied through list request DTOs.
client.unsV2.directoryList({ workspaceId: 'other-workspace' });
// @ts-expect-error Source mutations must carry an explicitly reviewed confirmation.
client.unsV2.sourceDelete({ dryRun: false, items: [{ id: '101', expectedRevision: 2 }] });

const lease = client.unsV2.recordLock({ collectionId: 'orders', ids: ['order-1'], ttlMs: 30000 });
const unlock = client.unsV2.recordUnlock({ collectionId: 'orders', locks: [{ id: 'order-1', token: 'lease' }] });
const restore = client.unsV2.recordRestore({ collectionId: 'orders', ids: ['order-1'], idempotencyKey: 'restore-1' });
void [lease, unlock, restore];
// @ts-expect-error Generic record audit is removed from the public SDK.
client.unsV2.recordAuditList({ collectionId: 'orders', recordId: 'order-1' });
// @ts-expect-error Generic admin record audit is removed from the public SDK.
client.unsV2.recordAuditAdminList({ collectionId: 'orders', recordId: 'order-1' });
// @ts-expect-error Removed audit operations cannot be selected through the generic contract.
const removedAuditOperation: UnsV2OperationName = 'recordAuditList';
// @ts-expect-error Removed admin audit operations have no request DTO.
type RemovedAdminAuditRequest = UnsV2Request<'recordAuditAdminList'>;
const auditCollection: UnsV2Request<'collectionUpdate'> = { dryRun: true,
  items: [{ id: 'orders', expectedRevision: 1,
    // @ts-expect-error Collection audit configuration has been removed.
    audit: { enabled: true, historyRead: true } }] };
void [removedAuditOperation, auditCollection, null as RemovedAdminAuditRequest | null];
// @ts-expect-error Retired Cloud batch-query route must not silently map to another contract.
client.unsV2.records({ queries: [] });
// @ts-expect-error Retired recordCreate is replaced by explicit recordInsertOne/Many operations.
client.unsV2.recordCreate({ collectionId: 'orders', items: [] });

const resourceShape = list.then(response => {
  const id: string = response.data.items[0].id;
  const business: Record<string, UnsV2JSONValue> = response.data.items[0].data;
  // @ts-expect-error Query-language aliases are not ordinary resource response fields.
  response.data.items[0]._meta;
  return { id, business };
});
const insertedShape = client.unsV2.recordInsertOne({ collectionId: 'orders', data: { total: 10 } }).then(response => {
  const id: string = response.data.insertedId;
  // @ts-expect-error insertOne returns one ID; counters belong to batch writes.
  response.data.insertedCount;
  return id;
});
void [resourceShape, insertedShape];

// History is opaque JSON; callers narrow legacy fields before displaying them.
client.unsV2.streamProgramVersionsList({ id: 'stream-1', page: 1, size: 20 }).then(response => {
  for (const row of response.data.list) {
    const versionID: string = row.versionId;
    const script = row.document.script;
    if (script && typeof script === 'object' && !Array.isArray(script) && 'code' in script && typeof script.code === 'string') {
      const code: string = script.code;
      void code;
    }
    const configured = row.document.scriptConfigured;
    if (typeof configured === 'boolean') {
      const flag: boolean = configured;
      void flag;
    }
    // @ts-expect-error Historical JSON cannot promise a current script DTO.
    const currentScript: import('../../src/uns-v2/generated.js').CloudStreamScript = row.document.script;
    void [versionID, currentScript];
  }
});

// Notifications expose identifiers only; business fields use the existing scoped query.
const notifications = client.unsV2.recordChangesPoll({ collectionId: 'orders', limit: 20, waitMs: 1000 });
notifications.then(result => {
  const cursor: string = result.data.nextCursor;
  const recordID: string | undefined = result.data.items[0]?.recordId;
  void cursor; void recordID;
  // @ts-expect-error notifications never export an unfiltered historical document
  void result.data.items[0]?.data;
});
// @ts-expect-error the authenticated workspace cannot be overridden in the body
void client.unsV2.recordChangesPoll({ collectionId: 'orders', workspaceId: 'other' });

// Retired Cloud Project DTOs must not remain public type exports.
// @ts-expect-error Project membership was removed from the Cloud contract.
import type { PlatformV2ProjectMembersListReq } from '../../src/index.js';
// @ts-expect-error Project membership was removed from the Cloud contract.
import type { PlatformV2ProjectMembersListResponse } from '../../src/index.js';

import { appsApi } from '../../src/openapi/api.js';
const appMembersBody: Parameters<typeof appsApi.openapiV1Appslistaccessmembers>[0] = {
  appId: 'owned-app', roleKeys: ['operator'], grantedAtStart: 1782864000000, page: 1, size: 20,
};
const invalidAppMembersBody: Parameters<typeof appsApi.openapiV1Appslistaccessmembers>[0] = {
  appId: 'owned-app',
  // @ts-expect-error App access members has no Project path/body selector.
  projectName: 'legacy-project',
};
void appMembersBody;
void invalidAppMembersBody;

// @ts-expect-error Retired execution DTOs are not management contracts.
type RetiredControlInvoke = import('../../src/uns-v2/generated.js').CloudControlInvokeReq;
const messageDeclarations: import('../../src/uns-v2/generated.js').CloudStreamDocument['messages'] = [{ topic: 'orders/accepted', access: 'publish' }];
const requestMetadata: import('../../src/uns-v2/generated.js').CloudStreamEntry['request'] = undefined;
void [messageDeclarations, requestMetadata];

// Historical documents preserve retired metadata without becoming current writes.
const oldHistory: import('../../src/uns-v2/generated.js').CloudHistoricalStreamDocument = {
  script: { sdkVersion: 'tier0-stream/v2', code: 'original source', timeoutMs: 1000 },
  entries: [{ id: 'old', kind: 'request', control: { code: 'legacy.read' } }],
};
const historyRows: import('../../src/uns-v2/generated.js').UnsV2StreamProgramVersionsListResponse['data']['list'] = [
  { id: '1', streamId: '101', versionId: '1', release: 1, status: 'inactive', digest: 'old', createdAt: 1, document: oldHistory },
  { id: '2', streamId: '101', versionId: '2', release: 2, status: 'active', digest: 'new', createdAt: 2,
    document: { name: 'new', model: 'program', script: { sdkVersion: 'tier0-stream/v3', code: 'new source', timeoutMs: 1000 } } },
];
void historyRows;
// @ts-expect-error Opaque history is not a current validated write document.
client.unsV2.streamDocumentValidate({ document: oldHistory });
const oldCloudWrite: import('../../src/uns-v2/generated.js').CloudStreamScript = {
  // @ts-expect-error Current Cloud writes also require v3; history did not widen them.
  sdkVersion: 'tier0-stream/v2', code: 'old source', timeoutMs: 1000,
};
void oldCloudWrite;

const compiledConsumer: import('../../src/uns-v2/generated.js').CloudStreamEntry = {
  id: 'consumer', kind: 'business-message', topic: 'orders/created',
};
const compiledTopic: string | undefined = compiledConsumer.topic;
void compiledTopic;
// @ts-expect-error Canonical compiled consumer metadata uses singular topic.
compiledConsumer.topics;
