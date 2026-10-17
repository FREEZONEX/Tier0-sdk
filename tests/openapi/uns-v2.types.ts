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
  dryRun: false, items: [{ id: 'source-1', expectedRevision: 2, desiredState: 'enabled' }],
});
const sourceDelete = client.unsV2.sourceDelete({ dryRun: true, items: [{ id: 'source-1', expectedRevision: 2 }] });
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
void [list, jobs, transaction, sources, deployment, scopedSamples, sourceState, sourceDelete, documentValidation,
  operation, request, exactInt64, exactBusinessNumber, null as DirectoryGetResponse | null];

// @ts-expect-error core-only graph has no Gateway route and is not exposed by the SDK.
client.unsV2.graph({ queries: [] });
// @ts-expect-error identity and workspace binding cannot be supplied through list request DTOs.
client.unsV2.directoryList({ workspaceId: 'other-workspace' });
