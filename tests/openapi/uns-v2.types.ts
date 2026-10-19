import {
  createClient,
  UnsV2RawNumber,
  type PlatformV2UsersListReq,
  type UnsV2JSONValue,
  type UnsV2OperationName,
  type UnsV2Request,
  type UnsV2Response,
} from '../../src/index.js';

const client = createClient({ apiHost: 'https://example.invalid', apiKey: 'workspace-bound' });
const list = client.unsV2.records({ queries: [{
  queryId: 'records', collectionId: 'orders', pipeline: [], page: { mode: 'cursor', cursor: 'opaque' },
}] });
const jobs = client.unsV2.jobs({ queries: [{ queryId: 'job', jobIds: ['job-1'] }] });
const transaction = client.unsV2.recordTransactionExecute({ items: [] });
const sources = client.unsV2.sourceList({ page: 1, size: 20, archived: false });
const deployment = client.unsV2.streamProgramDeploy({
  id: 'stream-1', dryRun: false, expectedRevision: 3, expectedSourceRevision: 7, idempotencyKey: 'deploy-1',
});
const scopedSamples = client.unsV2.samples({ queries: [{
  queryId: 'samples', collectionId: 'measurements', recordId: 'machine-1', pipeline: [], resultMode: 'all',
}] });
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
const operation: UnsV2OperationName = 'recordCreate';
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
