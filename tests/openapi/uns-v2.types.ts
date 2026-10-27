import {
  createClient,
  type IndexSpec,
  type RuntimeStreamDefinition,
  type CloudAppCreateCapability,
  type CloudSourceConfig,
  UnsV2RawNumber,
  type UnsV2Int64,
  type UnsV2JSONValue,
  type UnsV2OperationName,
  type UnsV2Request,
  type UnsV2Response,
} from '../../src/index.js';

const client = createClient({ apiHost: 'https://example.invalid', apiKey: 'workspace-bound' });
const sapConfig: CloudSourceConfig = {
  configVersion: 3, sourceType: 'sap-odata', endpoint: 'https://sap.example.invalid/service/', options: {},
  auth: { kind: 'vendorBasic', credentialRef: 'opaque-ref' },
};
const genericConfig: CloudSourceConfig = { configVersion: 2, endpoint: 'https://generic.example.invalid/', options: {} };
// @ts-expect-error SAP v3 requires its opaque vendorBasic auth reference.
const anonymousSAP: CloudSourceConfig = { configVersion: 3, sourceType: 'sap-odata', endpoint: 'https://sap.example.invalid/', options: {} };
// @ts-expect-error v3 does not inherit the v2 bearer credential kind.
const invalidSAP: CloudSourceConfig = {
  configVersion: 3, sourceType: 'sap-odata', endpoint: 'https://sap.example.invalid/', options: {},
  auth: { kind: 'bearer', credentialRef: 'opaque-ref' },
};
const unsupportedVendor: CloudSourceConfig = {
  configVersion: 3, endpoint: 'https://vendor.example.invalid/', options: {}, auth: { kind: 'vendorBasic', credentialRef: 'opaque-ref' },
  // @ts-expect-error Only SAP is published in the frozen v3 Source schema.
  sourceType: 'teamcenter',
};
client.unsV2.sourceDiscover({ id: '101', expectedRevision: 2 });
// @ts-expect-error Discovery requires an explicit current revision.
client.unsV2.sourceDiscover({ id: '101' });
// @ts-expect-error Discovery has no caller-selected target URL.
client.unsV2.sourceDiscover({ id: '101', expectedRevision: 2, endpoint: 'https://other.example.invalid/' });
client.unsV2.sourceDocumentCreate({ dryRun: true, document: { name: 'SAP', protocol: 'http', config: sapConfig } });
void [sapConfig, genericConfig, anonymousSAP, invalidSAP, unsupportedVendor];
// Native runtime DTO from the pinned source; hosted Cloud documents retain their own shape.
const nativeDefinition: RuntimeStreamDefinition = {
  name: 'native-http', script: '', sdkVersion: 'tier0-stream/v2',
  sourceBindings: [{ sourceId: '101', configRevision: new UnsV2RawNumber('9007199254740993'), acquisition: {} }],
};
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
const sources = client.unsV2.sourceDocumentList({ page: 1, size: 20 });
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
  script: { sdkVersion: 'tier0-stream/v2', code: 'module.exports = api => api;', timeoutMs: 1_000 },
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
const request: UnsV2Request<'metadataFind'> = { kind: 'directory', filter: { _id: 'directory-1' } };
type DirectoryGetResponse = UnsV2Response<'metadataFind'>;
const exactInt64: UnsV2Int64 = 9_223_372_036_854_775_807n;
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
// v5 only requires impact confirmation when the server reports an impact.
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
const metadataInput: UnsV2Request<'metadataInsertOne'> = { kind: 'collection', data: { name: 'orders', recordSchema: { type: 'object' } } };
void [removedAuditOperation, metadataInput, null as RemovedAdminAuditRequest | null];
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

// A version row may contain the view-only summary or the frozen manage projection.
client.unsV2.streamProgramVersionsList({ id: 'stream-1', page: 1, size: 20 }).then(response => {
  for (const row of response.data.list) {
    const versionID: string = row.versionId;
    if ('script' in row.document) {
      const code: string = row.document.script.code;
      void code;
    } else {
      const configured: boolean | undefined = row.document.scriptConfigured;
      // @ts-expect-error A summary does not expose the historical script.
      void row.document.script;
      void configured;
    }
    void versionID;
  }
});

// Notifications expose identifiers only; business fields use the existing scoped query.
async function subscribe() {
  for await (const frame of client.unsV2.recordSubscribe({ collectionIds: ['orders'], cursor: 'opaque' })) {
    if (frame.event === 'change') {
      const id: string = frame.data.recordId;
      // @ts-expect-error Notifications never contain business documents.
      void frame.data.data;
      void id;
    }
  }
}
void subscribe;
// @ts-expect-error Internal poll knobs are not public SSE query fields.
client.unsV2.recordSubscribe({ limit: 20 });
// @ts-expect-error SSE does not use the generic JSON POST dispatch.
client.unsV2.call('recordSubscribe', {});
// @ts-expect-error Retired long polling is not a v5 operation.
client.unsV2.recordChangesPoll({ collectionId: 'orders' });
// @ts-expect-error Native source documents replace the old Source create route.
client.unsV2.sourceCreate({});
// @ts-expect-error Native source documents replace the old Source get route.
client.unsV2.sourceGet({ id: '101' });
// @ts-expect-error Native stream documents replace the old program create route.
client.unsV2.streamProgramCreate({});

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

// @ts-expect-error v5 Source creation needs either document or items.
client.unsV2.sourceDocumentCreate({ dryRun: true });
// @ts-expect-error v5 Stream creation needs either document or program.
client.unsV2.streamDocumentCreate({ dryRun: true });
const nativeSource: UnsV2Request<'sourceDocumentCreate'> = { dryRun: true, document: { name: 'HTTP', protocol: 'http', config: { configVersion: 2, endpoint: 'https://example.invalid', options: {} } } };
// @ts-expect-error Single document and batch items are mutually exclusive.
client.unsV2.sourceDocumentCreate({ ...nativeSource, items: [{ document: nativeSource.document }] });
void nativeSource;
