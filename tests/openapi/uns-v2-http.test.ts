import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, UNS_V2_CODEC_SCHEMAS, UNS_V2_CONTRACT_PROVENANCE, UNS_V2_OPERATIONS, UnsV2Error, UnsV2OutcomeUnknownError, UnsV2RawNumber } from '../../src/index.js';
import { CloudTransport } from '../../src/cloud-transport.js';
import { HttpClient } from '../../src/openapi/client.js';
import type { UnsV2Response } from '../../src/uns-v2/generated.js';

const received: Array<{ method?: string; path?: string; body: string; headers: IncomingMessage['headers'] }> = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({ method: req.method, path: req.url, body, headers: req.headers });
  respond(req, res);
});
let apiHost = '';
const send = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiHost = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

const client = (timeout = 2_000, unsV2MaxResponseBytes?: number) => createClient({
  apiHost, apiKey: 'workspace-bound-key', transportTimeoutMs: timeout, unsV2MaxResponseBytes,
});

describe('UNS v2 localhost HTTP fixture', () => {
  it('isolates concurrent per-request clients and snapshots their proof configuration', async () => {
    const start = received.length;
    const proofA = 'gateway.user_A.signature-A';
    const proofB = 'gateway.user_B.signature-B';
    const config = { apiHost, apiKey: 'workspace-bound-key', unsV2AppDataSubject: proofA };
    const first = createClient(config);
    config.unsV2AppDataSubject = proofB;
    const second = createClient(config);
    const pending: ServerResponse[] = [];
    respond = (_req, res) => {
      pending.push(res);
      // Both requests must be in flight before either response is released.
      if (pending.length === 2) {
        for (const response of pending) send(response, { code: 200, msg: '', requestId: 'isolated', data: {} });
      }
    };
    await Promise.all([
      first.unsV2.recordFind({ collectionId: 'user-a' }),
      second.unsV2.recordFind({ collectionId: 'user-b' }),
    ]);
    expect(received.slice(start)).toHaveLength(2);
    for (const row of received.slice(start)) {
      expect(row.headers['x-tier0-app-data-subject']).toBe(row.path?.includes('user-a') ? proofA : proofB);
      expect(row.headers.authorization).toBe('Bearer workspace-bound-key');
      expect(row.headers['x-api-key']).toBe('workspace-bound-key');
    }
    respond = (_req, res) => send(res, { code: 200, msg: '', requestId: 'plain', data: {} });
    await client().unsV2.recordFind({ collectionId: 'plain' });
    expect(received.at(-1)?.headers['x-tier0-app-data-subject']).toBeUndefined();
  });

  it('never sends a Control/capability, legacy or asset proof header, even on post to a v2 path', async () => {
    const start = received.length;
    const config = { apiHost, apiKey: 'workspace-bound-key', unsV2AppDataSubject: 'gateway.user.signature' };
    const api = createClient(config);
    respond = (req, res) => {
      if (req.url === '/openapi/v1/stream-requests/discover') send(res, { total: 0, list: [] });
      else if (req.url === '/openapi/v1/stream-requests/pump.start/invoke') send(res, {
        code: 'pump.start', contractVersion: '1', result: {}, runID: 'fixture-run', status: 'completed', replayed: false,
      });
      else if (req.url === '/openapi/v1/capabilities/discover') send(res, {
        product: 'cloud', contractVersion: '1.0', apiContractVersions: ['openapi/v1'],
        interpreterContractVersions: ['tier0-stream/v3'], sdkContractVersions: ['stream-requests/v1'], capabilities: [], deprecations: [],
      });
      else send(res, {});
    };
    const http = new HttpClient(config);
    const transport = new CloudTransport(() => http, config);
    await Promise.all([
      api.streams.requests.discover(), api.streams.requests.use({ code: 'pump.start' }).invoke({}), api.capabilities.discover(),
      http.post('/openapi/v1/uns/query', {}), http.post('/openapi/v1/assets/files/url', {}),
      transport.post('/openapi/v2/uns/test', {}),
      ...['/openapi/v1/uns/query', '/openapi/v2/assets/test', '/openapi/v2/uns-other/test', '/openapi/v2/uns']
        .map(path => transport.postText(path, '{}')),
    ]);
    expect(received.slice(start)).toHaveLength(10);
    for (const row of received.slice(start)) expect(row.headers['x-tier0-app-data-subject']).toBeUndefined();
  });

  it('rejects the retired runtime probe before any HTTP request', async () => {
    const start = received.length;
    const api = createClient({ apiHost, apiKey: 'workspace-bound-key', unsV2AppDataSubject: 'gateway.user.signature' });
    expect(api.unsV2).not.toHaveProperty('streamRuntimeCapabilitiesGet');
    await expect(api.unsV2.call('streamRuntimeCapabilitiesGet' as never, {} as never)).rejects.toThrow('unknown UNS v2 operation');
    expect(received).toHaveLength(start);
  });

  it('does not expose retired v2 request execution aliases at runtime or through generic dispatch', async () => {
    const api = client().unsV2;
    for (const name of ['controlDiscover', 'controlDescribe', 'controlInvoke']) {
      expect(api).not.toHaveProperty(name);
      expect(UNS_V2_OPERATIONS).not.toHaveProperty(name);
      await expect(api.call(name as never, {} as never)).rejects.toThrow('unknown UNS v2 operation');
    }
  });

  it('rejects invalid proof configurations synchronously without requests or value disclosure', () => {
    const start = received.length;
    const token = 'gateway.user.signature';
    const invalid: unknown[] = [
      '', null, 1, true, {}, [token], `${token},${token}`, `${token} ${token}`,
      ` ${token}`, `${token} `, `${token}\r\n`, `${token}\n`, `${token}\t`, `${token}\u0000`,
      'a.b', 'a.b.c.d', '.b.c', 'a..c', 'a.b.', 'a.b.c=', 'a.b.c+', 'a.b.c/',
      'a.用户.c', 'a.b.\u007f', 'a.b.\u00a0', `a.b.${'x'.repeat(8189)}`,
    ];
    for (const value of invalid) {
      let error: unknown;
      try { createClient({ apiHost, unsV2AppDataSubject: value as string }); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe('Tier0 SDK: unsV2AppDataSubject must be a compact three-segment base64url token of at most 8192 ASCII bytes.');
    }
    expect(received.length).toBe(start);
  });

  it('forwards exactly 8192 ASCII bytes unchanged without parsing claims', async () => {
    const start = received.length;
    const proof = `a.b.${'x'.repeat(8188)}`;
    respond = (_req, res) => send(res, { code: 200, msg: '', requestId: 'max-proof', data: {} });
    await createClient({ apiHost, apiKey: 'workspace-bound-key', unsV2AppDataSubject: proof })
      .unsV2.recordFind({ collectionId: 'orders' });
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].headers['x-tier0-app-data-subject']).toBe(proof);
  });

  it.each(['redirect', 'socket', 'malformed', 'timeout'] as const)
  ('redacts proof-bearing %s failures without redirects or retries', async kind => {
    const start = received.length;
    const proof = 'gateway.private_subject.private_signature';
    respond = (req, res) => {
      if (kind === 'socket') { req.socket.destroy(); return; }
      if (kind === 'redirect') { res.writeHead(307, { Location: '/redirected' }); res.end(proof); return; }
      if (kind === 'timeout') { res.writeHead(200); res.write(proof); return; }
      res.end(proof);
    };
    const error = await createClient({ apiHost, apiKey: 'workspace-bound-key', unsV2AppDataSubject: proof, transportTimeoutMs: 150 })
      .unsV2.recordInsertOne({ collectionId: 'orders', data: {} }).catch(value => value);
    expect(error).toBeInstanceOf(UnsV2OutcomeUnknownError);
    expect(error).toMatchObject({ retryable: false, code: kind === 'socket' ? 'UNS_V2_TRANSPORT_ERROR' :
      kind === 'timeout' ? 'UNS_V2_TRANSPORT_TIMEOUT' : 'UNS_V2_PROTOCOL_ERROR' });
    const diagnostic = `${String(error)}\n${error.stack}\n${JSON.stringify(error)}`;
    for (const sensitive of [proof, 'private_subject', 'private_signature', 'workspace-bound-key']) {
      expect(diagnostic).not.toContain(sensitive);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].headers['x-tier0-app-data-subject']).toBe(proof);
  });

  it('reads the current hosted App context without an App selector or retries', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, { code: 200, msg: '', requestId: 'app-context', data: {
      appId: '14bfc189-8516-4709-a4c9-865a0f1dc345', name: 'Hosted App', revision: 1,
      collections: [], platformPermissions: [],
    } });
    const out = await client().unsV2.dataAppContext({});
    expect(out.data.appId).toBe('14bfc189-8516-4709-a4c9-865a0f1dc345');
    expect(out.data.name).toBe('Hosted App');
    expect(out.data.collections).toEqual([]);
    expect(received.length - start).toBe(1);
    expect(received.at(-1)?.path).toBe('/openapi/v2/uns/app/context');
    expect(received.at(-1)?.body).toBe('{}');
  });

  it('decodes current employee create capability separately from readable fields without adding a selector or binding to the request', async () => {
    const start = received.length;
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"code":200,"msg":"ok","requestId":"create-hint","data":{"appId":"app-1","name":"App","revision":19,"platformPermissions":[],"collections":[{"alias":"orders","collectionId":"orders","permissions":["record:read","record:write"],"recordSchema":{"type":"object","properties":{"orderNo":{"type":"string"}}},"createCapability":{"version":"cloud-app-create-capability/v1","allowed":true,"reason":"allowed","appRevision":19,"collectionRevision":9007199254740993,"binding":"' + 'a'.repeat(64) + '","inputSchema":{"type":"object","additionalProperties":false,"required":["orderNo","amount"],"properties":{"orderNo":{"type":"string"},"amount":{"type":"integer","minimum":0,"enum":[9007199254740993]}}}}}]}}');
    };
    const out = await client().unsV2.dataAppContext({});
    const grant = out.data.collections[0], cap = grant.createCapability;
    expect(grant.recordSchema.properties).not.toHaveProperty('amount');
    expect(cap?.version).toBe('cloud-app-create-capability/v1');
    expect(cap?.allowed).toBe(true);
    expect(cap?.collectionRevision).toEqual(new UnsV2RawNumber('9007199254740993'));
    expect(cap?.inputSchema?.properties?.amount.enum).toEqual([new UnsV2RawNumber('9007199254740993')]);
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].body).toBe('{}');
  });

  it('sends unified index declarations and reads exact business numbers through the 4.0 find route', async () => {
    const start = received.length;
    respond = (req, res) => {
      if (req.url === '/openapi/v2/uns/collections/devices/records:find') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"code":200,"msg":"ok","requestId":"find-4","data":{"items":[{"id":"device-1","collectionId":"devices","revision":1,"createdAt":1,"updatedAt":2,"sourceId":null,"sourceTime":null,"data":{"serial":9007199254740993}}],"pageInfo":{"hasMore":false,"mode":"cursor","nextCursor":null,"nextPage":null,"snapshotScope":"thisRequestOnly"}}}');
      } else send(res, { code: 200, msg: 'ok', requestId: 'collection-4', data: { status: 'completed' } });
    };
    const api = client().unsV2;
    const item = {
      id: 'devices', name: 'Devices', recordSchema: { type: 'object' as const, properties: { serial: { type: 'integer' as const } } },
      indexes: [{ path: 'serial', kind: 'btree' as const, target: 'records' as const, unique: true }],
    };
    await api.collectionCreate({ dryRun: false, idempotencyKey: 'index-intent-4', items: [item] });
    const response = await api.recordFind({ collectionId: 'devices', filter: {}, limit: 10 });
    expect(received.slice(start).map(row => row.path)).toEqual([
      '/openapi/v2/uns/collections/create', '/openapi/v2/uns/collections/devices/records:find',
    ]);
    expect(JSON.parse(received[start].body)).toEqual({ dryRun: false, idempotencyKey: 'index-intent-4', items: [item] });
    expect(received[start].body).not.toContain('uniqueKeys');
    expect(received[start].body).not.toContain('queryIndexes');
    expect(response.data.items).toEqual([{ id: 'device-1', collectionId: 'devices', revision: 1, createdAt: 1, updatedAt: 2, sourceId: null, sourceTime: null, data: { serial: new UnsV2RawNumber('9007199254740993') } }]);
    expect(response.data.pageInfo).toEqual({ hasMore: false, mode: 'cursor', nextCursor: null, nextPage: null, snapshotScope: 'thisRequestOnly' });
  });

  it('keeps one frozen intent and does not retry a 4.0 upsert after an ambiguous response', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, { code: 503, msg: 'unavailable', requestId: 'update-4' }, 503);
    const request = { collectionId: 'devices', filter: { serial: 'A' }, update: { $set: { enabled: true } }, upsert: true, idempotencyKey: 'upsert-intent-4' };
    await expect(client().unsV2.recordUpdateOne(request)).rejects.toBeInstanceOf(UnsV2Error);
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].path).toBe('/openapi/v2/uns/collections/devices/records:updateOne');
    expect(JSON.parse(received[start].body)).toEqual(request);
  });

  it('encodes resource identities once and preserves both Sample append owners', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, { code: 200, msg: 'ok', requestId: 'scoped-4', data: {} });
    const api = client().unsV2;
    await api.recordFind({ collectionId: '设备 #%2F', limit: 1 });
    const request = { dryRun: false, collectionId: 'equipment', recordId: 'device #1', items: [{ time: 1, data: { temperature: 23 } }] };
    await api.sampleAppend(request);
    expect(received.slice(start).map(row => row.path)).toEqual([
      '/openapi/v2/uns/collections/' + encodeURIComponent('设备 #%2F') + '/records:find',
      '/openapi/v2/uns/collections/equipment/records/device%20%231/samples',
    ]);
    expect(JSON.parse(received[start + 1].body)).toEqual(request);
  });

  it('rejects missing, inherited and route-changing path identities before sending a request', async () => {
    const start = received.length;
    const api = client().unsV2;
    for (const value of ['', '.', '..', 'a/b', 'a\\b', 'a\n', 101, null]) {
      await expect(api.recordFind({ collectionId: value as string })).rejects.toThrow('path identity');
    }
    await expect(api.recordFind(Object.create({ collectionId: 'inherited' }))).rejects.toThrow('path identity');
    expect(received.length).toBe(start);
  });

  it('routes public Connect observations while retaining admission coverage and nullable metrics', async () => {
    const start = received.length;
    respond = (req, res) => {
      const common = { window: { from: 1, to: 2 }, checkedAt: 2, coverage: 'durable-admissions' };
      const data = req.url?.includes('/sources/')
        ? { ...common, items: [{ id: '101', revision: 3, acceptedCaptures: 0, committedWrites: 0, failedRuns: 0, lastDataAt: null }] }
        : req.url?.includes('/runs/')
          ? { items: [], nextCursor: '', checkedAt: 2 }
          : { ...common, id: '202', revision: 4, stats: { admitted: 0, completed: 0, failed: 0, unknown: 0, pending: 0, durationSamples: 0, successRate: null, averageDurationMs: null } };
      send(res, { code: 200, msg: 'ok', requestId: 'connect-observations', data });
    };
    const api = client().unsV2;
    const source = await api.sourceObservationsGet({ items: [{ id: '101', expectedRevision: 3 }] });
    expect(source.data.coverage).toBe('durable-admissions');
    expect(source.data.items[0].lastDataAt).toBeNull();
    const stream = await api.streamObservationGet({ id: '202' });
    expect(stream.data.stats.successRate).toBeNull();
    const runs = await api.streamRunsList({ id: '202', size: 10, cursor: 'opaque-cursor' });
    expect(runs.data.items).toEqual([]);
    expect(received.slice(start).map(row => row.path)).toEqual([
      '/openapi/v2/uns/sources/observations/get', '/openapi/v2/uns/streams/observation/get', '/openapi/v2/uns/streams/runs/list',
    ]);
    expect(JSON.parse(received[start + 2].body)).toEqual({ id: '202', size: 10, cursor: 'opaque-cursor' });
    expect(received.slice(start).every(row => row.headers['x-api-key'] === 'workspace-bound-key')).toBe(true);
  });

  it('never retries isolated sample execution or exposes Core-only credentials and ingress routes', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, { code: 503, msg: 'sample runtime unavailable', requestId: 'sample-unavailable' }, 503);
    const api = client().unsV2;
    await expect(api.streamSampleTest({ document: { name: 'sample', model: 'script', script: { sdkVersion: 'tier0-stream/v3', code: '', timeoutMs: 1000 } }, entryId: 'sample', input: { value: 1 } })).rejects.toBeInstanceOf(UnsV2Error);
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].path).toBe('/openapi/v2/uns/streams/sample/test');
    const core = api as unknown as { call(name: string, request: unknown): Promise<unknown> };
    for (const name of ['graph', 'sourceCredentialCreate', 'sourceIngressGet', 'sourceIngressRotate', 'hostedAppControlPolicyGet', 'hostedAppControlPolicyUpdate']) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
      await expect(core.call(name, {})).rejects.toThrow('unknown UNS v2 operation');
    }
    for (const name of ['CloudSourceCredentialCreateReq', 'CloudSourceCredentialCreateResponse', 'CloudSourceIngressGetReq', 'CloudSourceIngressRotateReq']) {
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(false);
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.version).toBe('4.0.0');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudContractRevision).toBe('cloud-source-impact/1+app-create-capability/1+data/3+collection-namespace/1+http-acquisition/2+app-collection/2+app-data/2+hosted-control/1+source-bindings/1+record-notifications/1+record-delete-samples/1+stream-history/1+stream-control-probe-retirement/1');
    expect(UNS_V2_CONTRACT_PROVENANCE.revision).toBe('6c111671a2172eb14c38f2f6d9ec329f4ee08a3d');
    expect(UNS_V2_CONTRACT_PROVENANCE.cloudRevision).toBe(UNS_V2_CONTRACT_PROVENANCE.revision);
    expect(UNS_V2_CONTRACT_PROVENANCE.sourceDerivedContractSHA256).toBe('0e82f1a9f4363bcdc1b8cc916f494aab5fb5f368a8d232850a299b5dbc165aa5');
    expect(UNS_V2_CONTRACT_PROVENANCE.publicOperationCount).toBe(97);
    expect(UNS_V2_CONTRACT_PROVENANCE.manifestOperationCount).toBe(113);
    expect(received.slice(start)).toHaveLength(1);
  });

  it.each(['appDataPolicyGet', 'appDataPolicyUpdate', 'collectionCreate'] as const)('preserves server App-management rejection for public %s without retry', async name => {
    const start = received.length;
    const app = createClient({ apiHost, apiKey: 'runtime-app-key' }).unsV2;
    respond = (_req, res) => send(res, {
      code: 403, msg: 'App credentials cannot manage grants', requestId: 'app-management-denied', data: null,
      error: { code: 'FORBIDDEN', retryable: false, details: [],
        retryAdvice: { recommendedAction: 'doNotRetry', canRetrySameRequest: false, keepIdempotencyKey: false } },
    }, 403);
    const pending = name === 'appDataPolicyGet'
      ? app.appDataPolicyGet({ appId: 'owned-app' })
      : name === 'appDataPolicyUpdate'
        ? app.appDataPolicyUpdate({ appId: 'owned-app', expectedRevision: 1, status: 'disabled', collections: [], idempotencyKey: 'deny-grant', dryRun: false })
        : app.collectionCreate({ items: [{ id: 'denied-collection', name: 'Denied', recordSchema: { type: 'object', properties: {} } }], dryRun: false, idempotencyKey: 'deny-create' });
    await expect(pending).rejects.toMatchObject({ name: 'UnsV2Error', status: 403, code: 'FORBIDDEN', retryable: false });
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].headers.authorization).toBe('Bearer runtime-app-key');
  });

  it('preserves summary and immutable full history projections without a restore request', async () => {
    const start = received.length;
    // Explicit historical v2 snapshots must remain unchanged after the v3 upgrade.
    const summary = { name: 'history', sdkVersion: 'tier0-stream/v2', timeoutMs: 5000, scriptConfigured: true };
    const document = {
      name: 'frozen history', model: 'program',
      script: { sdkVersion: 'tier0-stream/v2', code: '\n  module.exports = api => {};\n', timeoutMs: 5000 },
      sources: [{ alias: 'device', sourceId: '1001', configRevision: 2 }],
      entries: [{ id: 'request-1', kind: 'request' }],
    };
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'history-projections',
      data: {
        list: [summary, document, {}].map((item, index) => ({
          id: String(2001 + index), versionId: String(2001 + index), streamId: '202',
          release: index + 1, status: 'inactive', digest: `frozen-${index}`, createdAt: 1700000000000,
          document: item,
        })),
        total: 3, page: 1, size: 20,
      },
    });
    const response = await client().unsV2.streamProgramVersionsList({ id: '202', page: 1, size: 20 });
    expect(response.data.list.map(row => row.document)).toEqual([summary, document, {}]);
    expect(response.data.list[0].document).not.toHaveProperty('script');
    expect(received.slice(start)).toHaveLength(1);
    expect(received.at(-1)?.path).toBe('/openapi/v2/uns/streams/program/versions/list');
    expect(JSON.parse(received.at(-1)!.body)).toEqual({ id: '202', page: 1, size: 20 });
  });

  it.each(['recordAuditList', 'recordAuditAdminList'])('rejects removed %s before encoding or any network request', async name => {
    const start = received.length;
    const api = createClient({ apiHost, apiKey: 'workspace-bound-key', unsV2AppDataSubject: 'gateway.employee.signature' }).unsV2;
    expect(Object.hasOwn(api, name)).toBe(false);
    expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
    const core = api as unknown as { call(name: string, request: unknown): Promise<unknown> };
    // Circular input proves rejection happens before request encoding as well as fetch.
    const circular: Record<string, unknown> = { collectionId: 'orders', recordId: 'order-1' };
    circular.self = circular;
    for (const request of [{ collectionId: 'orders', recordId: 'order-1' }, circular]) {
      await expect(core.call(name, request)).rejects.toThrow('unknown UNS v2 operation');
    }
    expect(received.slice(start)).toHaveLength(0);
  });

  it('preserves explicit Source impact review and history without automatic confirmation or mutation retries', async () => {
    const start = received.length;
    respond = (req, res) => {
      if (req.url === '/openapi/v2/uns/sources/impact') {
        return send(res, { code: 200, msg: 'ok', requestId: 'impact', data: {
          impactRevision: 'reviewed-token', sourceID: '101', sourceRevision: 2, action: 'disable', complete: 1,
          counts: { draft: 1, activeRelease: 1, historicalRelease: 0 }, restrictedCount: 0, references: [], nextOffset: 0, expiresAt: 2_000_000_000_000,
        } });
      }
      if (req.url === '/openapi/v2/uns/sources/history') {
        return send(res, { code: 200, msg: 'ok', requestId: 'history', data: {
          sourceID: '101', currentRevision: 2, deleted: 2, total: 0, missingRevisionCount: 0, nextBeforeRevision: 0, revisions: [],
        } });
      }
      return send(res, { code: 409, msg: 'SOURCE_IMPACT_CHANGED', requestId: 'conflict' }, 409);
    };
    const api = client().unsV2;
    const review = await api.sourceImpact({ id: '101', expectedRevision: 2, action: 'disable', size: 20 });
    expect(review.data.impactRevision).toBe('reviewed-token');
    expect(received.length - start).toBe(1);
    expect(received[start].path).toBe('/openapi/v2/uns/sources/impact');
    const history = await api.sourceHistory({ id: '101', size: 20 });
    expect(history.data.sourceID).toBe('101');
    await expect(api.sourceStateUpdate({ dryRun: false, items: [{
      id: '101', expectedRevision: 2, desiredState: 'disabled', confirmedImpactRevision: review.data.impactRevision,
    }] })).rejects.toBeInstanceOf(UnsV2Error);
    expect(received.length - start).toBe(3);
    expect(JSON.parse(received[start + 2].body).items[0].confirmedImpactRevision).toBe('reviewed-token');
    expect(received[start + 2].body).not.toContain('workspace');
    expect(received[start + 2].body).not.toContain('tenant');
  });

  it('rejects inherited, unknown and non-string operation names before encoding or fetch', async () => {
    const start = received.length;
    const core = client().unsV2 as unknown as { call(name: unknown, request: unknown): Promise<unknown> };
    for (const name of ['constructor', '__proto__', 'toString', 'ordinaryUnknown', 'records', 'samples', 'recordCreate', 'recordDelete', { toString: () => 'records' }]) {
      await expect(core.call(name, {})).rejects.toThrow('unknown UNS v2 operation');
    }
    expect(received.length).toBe(start);
  });

  it('uses only the frozen operation path and preserves omission, null and workspace authentication', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'req-list', data: { items: [], pageInfo: { hasMore: true, nextCursor: 'opaque-next', snapshotScope: 'thisRequestOnly' } },
    });
    const response = await client().unsV2.recordFind({ collectionId: 'orders', limit: 20, cursor: 'opaque' });
    const result = response.data;
    expect(result.pageInfo.nextCursor).toBe('opaque-next');
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start]).toMatchObject({
      method: 'POST', path: '/openapi/v2/uns/collections/orders/records:find',
      body: '{"collectionId":"orders","limit":20,"cursor":"opaque"}',
      headers: {
        authorization: 'Bearer workspace-bound-key',
        'x-api-key': 'workspace-bound-key',
        'content-type': 'application/json',
      },
    });
  });

  it('preserves numeric and prototype-shaped business fields over HTTP', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"code":200,"msg":"ok","requestId":"req-business","data":{"items":[{"id":"measurement-1","collectionId":"measurements","revision":1,"createdAt":1,"updatedAt":1,"sourceId":null,"sourceTime":null,"data":{"numeric":"123","unit":"bar","nested":{"numeric":false},"nullable":null,"int64Max":9223372036854775807,"int64Min":-9223372036854775808,"decimal":1.0000000000000001,"exponent":9.007199254740993e15,"__proto__":{"polluted":true},"constructor":"business","prototype":"field"}}],"pageInfo":{"hasMore":false,"nextCursor":null,"snapshotScope":"thisRequestOnly"}}}');
    };
    const response = await client().unsV2.recordFind({ collectionId: 'measurements', limit: 1 });
    const item = response.data.items[0].data;
    expect(item).toEqual({
      ...JSON.parse('{"numeric":"123","unit":"bar","nested":{"numeric":false},"nullable":null,"__proto__":{"polluted":true},"constructor":"business","prototype":"field"}'),
      int64Max: new UnsV2RawNumber('9223372036854775807'),
      int64Min: new UnsV2RawNumber('-9223372036854775808'),
      decimal: new UnsV2RawNumber('1.0000000000000001'),
      exponent: new UnsV2RawNumber('9.007199254740993e15'),
    });
    expect(item && Object.prototype.hasOwnProperty.call(item, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('preserves explicit null and never adds identity or binding fields', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'created', requestId: 'req-create',
      data: { status: 'committed', replayed: false, results: [] },
    });
    await client().unsV2.directoryCreate({ dryRun: false, items: [{ name: 'root', parentId: null }] });
    expect(JSON.parse(received[start].body)).toEqual({ dryRun: false, items: [{ name: 'root', parentId: null }] });
    expect(received[start].body).not.toContain('workspace');
    expect(received[start].body).not.toContain('tenant');
    expect(received[start].body).not.toContain('deployment');
    expect(received.length - start).toBe(1);
  });

  it('uses the generated Cloud Source route and typed pagination envelope', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'req-sources',
      data: {
        complete: true, hasMore: false, page: 1, size: 20, snapshotScope: 'thisRequestOnly',
        total: 0, truncated: false, list: [],
      },
    });
    const response = await client().unsV2.sourceList({ page: 1, size: 20, archived: false });
    expect(response.data).toMatchObject({ complete: true, total: 0, list: [] });
    expect(received[start]).toMatchObject({
      method: 'POST', path: '/openapi/v2/uns/sources/list', body: '{"page":1,"size":20,"archived":false}',
    });
  });

  it('uses collection-scoped Sample find with record and time bounds', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'req-samples',
      data: { items: [], pageInfo: { hasMore: false, nextCursor: null } },
    });
    const response = await client().unsV2.sampleFind({
      collectionId: 'measurements', recordIds: ['machine-1', 'machine-2'],
      from: 1000, to: 2000, page: { mode: 'cursor', size: 20 },
    });
    expect(response.data.pageInfo.hasMore).toBe(false);
    expect(received[start]).toMatchObject({
      path: '/openapi/v2/uns/collections/measurements/samples:find',
      body: '{"collectionId":"measurements","recordIds":["machine-1","machine-2"],"from":1000,"to":2000,"page":{"mode":"cursor","size":20}}',
    });
    expect(received.length - start).toBe(1);
  });

  it('reads Sample resources consistently from find and latest while keeping business numbers exact', async () => {
    const start = received.length;
    const sampleJSON = '{"id":"sample-1","collectionId":"measurements","recordId":"machine-1","time":1000,"receivedAt":1001,"quality":"good","sourceId":null,"data":{"counter":9007199254740993,"temperature":23.5}}';
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const data = req.url?.endsWith('samples:latest')
        ? '{"series":[{"recordId":"machine-1","sample":' + sampleJSON + '}]}'
        : '{"items":[' + sampleJSON + '],"pageInfo":{"mode":"cursor","hasMore":false,"nextCursor":null,"nextPage":null,"snapshotScope":"thisRequestOnly"}}';
      res.end('{"code":200,"msg":"ok","requestId":"sample-resources-3","data":' + data + '}');
    };
    const api = client().unsV2;
    const found = await api.sampleFind({ collectionId: 'measurements', recordIds: ['machine-1'], from: 1000, to: 1002 });
    const latest = await api.sampleLatestValues({ collectionId: 'measurements', recordIds: ['machine-1'] });
    const sample = found.data.items[0];
    expect(sample.id).toBe('sample-1');
    expect(sample.time).toBe(1000);
    expect(sample.data.counter).toEqual(new UnsV2RawNumber('9007199254740993'));
    expect(latest.data.series[0].sample).toEqual(sample);
    expect(Object.hasOwn(sample, '_meta')).toBe(false);
    expect(received.slice(start).map(row => row.path)).toEqual([
      '/openapi/v2/uns/collections/measurements/samples:find',
      '/openapi/v2/uns/collections/measurements/samples:latest',
    ]);
  });

  it('uses the single-record write response without inventing batch counters', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'insert-one-3',
      data: { insertedId: 'order-1', status: 'committed', replayed: true },
    });
    const response = await client().unsV2.recordInsertOne({
      collectionId: 'orders', id: 'order-1', data: { total: 10 }, idempotencyKey: 'insert-intent-3',
    });
    expect(response.data).toEqual({ insertedId: 'order-1', status: 'committed', replayed: true });
    expect(Object.hasOwn(response.data, 'insertedCount')).toBe(false);
    expect(received.slice(start)).toHaveLength(1);
    expect(JSON.parse(received[start].body).data).toEqual({ total: 10 });
  });

  it('preserves lease tokens and explicit restore intent on their frozen data/3 routes', async () => {
    const start = received.length;
    respond = (req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'lease-2',
      data: req.url?.endsWith(':lock')
        ? { locks: [{ id: 'order-1', token: 'opaque-lease', expiresAt: 2000, fence: 1, record: { id: 'order-1', collectionId: 'orders', data: { total: 10 }, revision: 1, createdAt: 1, updatedAt: 1, sourceId: null, sourceTime: null } }] }
        : req.url?.endsWith(':unlock') ? { unlockedCount: 1 }
        : { restoredCount: 1, restoredIds: ['order-1'], status: 'committed', replayed: false },
    });
    const api = client().unsV2;
    const lease = await api.recordLock({ collectionId: 'orders', ids: ['order-1'], ttlMs: 1000 });
    const token = lease.data.locks[0].token;
    expect(token).toBe('opaque-lease');
    expect(lease.data.locks[0].record.data).toEqual({ total: 10 });
    await api.recordUnlock({ collectionId: 'orders', locks: [{ id: 'order-1', token }] });
    const restored = await api.recordRestore({ collectionId: 'orders', ids: ['order-1'], idempotencyKey: 'restore-intent-1' });
    expect(restored.data.restoredIds).toEqual(['order-1']);
    expect(received.slice(start).map(row => row.path)).toEqual([
      '/openapi/v2/uns/collections/orders/records:lock',
      '/openapi/v2/uns/collections/orders/records:unlock',
      '/openapi/v2/uns/collections/orders/records:restore',
    ]);
    expect(JSON.parse(received[start + 1].body)).toEqual({ collectionId: 'orders', locks: [{ id: 'order-1', token: 'opaque-lease' }] });
    expect(JSON.parse(received[start + 2].body).idempotencyKey).toBe('restore-intent-1');
  });

  it('returns a lease conflict without automatically reacquiring or resending the write', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 409, msg: 'locked', requestId: 'lease-conflict', data: null,
      error: { code: 'LOCK_CONFLICT', retryable: false, details: [],
        retryAdvice: { recommendedAction: 'doNotRetry', canRetrySameRequest: false, keepIdempotencyKey: true } },
    }, 409);
    await expect(client().unsV2.recordInsertOne({
      collectionId: 'orders', id: 'order-1', data: { total: 10 },
      idempotencyKey: 'write-intent', assertLocks: [{ collectionId: 'stock', id: 'part-1', token: 'lease' }],
    })).rejects.toMatchObject({ name: 'UnsV2Error', status: 409, code: 'LOCK_CONFLICT', requestId: 'lease-conflict', retryable: false });
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].path).toBe('/openapi/v2/uns/collections/orders/records');
    expect(JSON.parse(received[start].body).assertLocks).toEqual([{ collectionId: 'stock', id: 'part-1', token: 'lease' }]);
  });

  it('exposes Source state update and keeps the mutation single-shot', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'updated', requestId: 'req-source-state',
      data: { status: 'committed', replayed: false, results: [] },
    });
    await client().unsV2.sourceStateUpdate({
      dryRun: false, idempotencyKey: 'source-state-1',
      items: [{ id: 'source-1', expectedRevision: 2, desiredState: 'enabled' }],
    });
    expect(received[start]).toMatchObject({
      path: '/openapi/v2/uns/sources/state/update',
      body: '{"dryRun":false,"idempotencyKey":"source-state-1","items":[{"id":"source-1","expectedRevision":2,"desiredState":"enabled"}]}',
    });
    expect(received.length - start).toBe(1);
  });

  it('preserves Resource4 references in Stream document validation', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'valid', requestId: 'req-document-validate', data: { valid: true, issues: [] },
    });
    await client().unsV2.streamDocumentValidate({ document: {
      name: 'collector', model: 'collection',
      script: { sdkVersion: 'tier0-stream/v3', code: 'module.exports = api => api;', timeoutMs: 1_000 },
      sources: [{ alias: 'plant', sourceId: 'source-1', configRevision: 2, resources: ['line/1', 'line/2'] }],
    } });
    expect(JSON.parse(received[start].body)).toMatchObject({
      document: { sources: [{ alias: 'plant', sourceId: 'source-1', configRevision: 2, resources: ['line/1', 'line/2'] }] },
    });
    expect(received[start].path).toBe('/openapi/v2/uns/streams/documents/validate');
  });

  it('treats an ambiguous Stream deployment response as outcome unknown without retrying', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 500, msg: 'not canonical', requestId: 'req-deploy', data: null,
    });
    await expect(client().unsV2.streamProgramDeploy({
      id: 'stream-1', dryRun: false, expectedRevision: 3, expectedSourceRevision: 7, idempotencyKey: 'deploy-1',
    })).rejects.toMatchObject({
      name: 'UnsV2OutcomeUnknownError', status: 200, operation: 'streamProgramDeploy',
      code: 'UNS_V2_PROTOCOL_ERROR', outcomeUnknown: true,
    });
    expect(received.length - start).toBe(1);
  });

  it('preserves transaction retry advice without automatically retrying', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 409, msg: 'status first', requestId: 'req-conflict', data: null,
      error: {
        code: 'TRANSACTION_OUTCOME_UNKNOWN', retryable: false, rolledBack: false, details: [],
        retryAdvice: {
          recommendedAction: 'queryOriginalTransactionStatusDoNotReplaceKey',
          canRetrySameRequest: false,
          keepIdempotencyKey: true,
        },
      },
    }, 409);
    const error = await client().unsV2.metaBatchExecute({
      idempotencyKey: 'intent-1', items: [{ opId: 'root', action: 'meta.create', kind: 'directory', id: 'root', data: {} }],
    }).catch(value => value);
    expect(error).toBeInstanceOf(UnsV2Error);
    expect(error).not.toBeInstanceOf(UnsV2OutcomeUnknownError);
    expect(error).toMatchObject({
      status: 409, operation: 'metaBatchExecute', code: 'TRANSACTION_OUTCOME_UNKNOWN', retryable: false,
      rolledBack: false,
      retryAdvice: { recommendedAction: 'queryOriginalTransactionStatusDoNotReplaceKey', canRetrySameRequest: false, keepIdempotencyKey: true },
    });
    expect(received.length - start).toBe(1);
  });

  it('requires canonical HTTP 200 and envelope code 200 for success', async () => {
    for (const testCase of [
      { status: 200, code: 403 },
      { status: 201, code: 200 },
      { status: 500, code: 200 },
    ]) {
      respond = (_req, res) => send(res, {
        code: testCase.code, msg: 'not canonical', requestId: 'req-mismatch', data: { results: [] },
      }, testCase.status);
      await expect(client().unsV2.recordFind({ collectionId: 'orders' })).rejects.toMatchObject({
        name: 'UnsV2Error', status: testCase.status, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
      });
    }
  });

  it('requires a non-success envelope code to match its HTTP status', async () => {
    respond = (_req, res) => send(res, {
      code: 403, msg: 'mismatched', requestId: 'req-mismatch', data: null,
      error: {
        code: 'FORBIDDEN', retryable: false, details: [],
        retryAdvice: { recommendedAction: 'doNotRetry', canRetrySameRequest: false, keepIdempotencyKey: false },
      },
    }, 500);
    await expect(client().unsV2.recordFind({ collectionId: 'orders' })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 500, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
  });

  it('treats a non-canonical mutation success envelope as outcome unknown', async () => {
    respond = (_req, res) => send(res, {
      code: 500, msg: 'not canonical', requestId: 'req-mutation-mismatch', data: null,
    });
    await expect(client().unsV2.recordDeleteOne({
      dryRun: false, collectionId: 'orders', filter: { _id: 'order-1' },
    })).rejects.toMatchObject({
      name: 'UnsV2OutcomeUnknownError', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', outcomeUnknown: true,
    });
  });

  it('rejects a request above the 16 MiB contract limit before fetch', async () => {
    const start = received.length;
    await expect(client().unsV2.recordInsertOne({
      dryRun: false,
      collectionId: 'orders',
      data: { payload: 'x'.repeat((16 << 20) + 1) },
    })).rejects.toThrow('UNS v2 request body exceeds the 16777216-byte contract limit');
    expect(received.length).toBe(start);
  });

  it('bounds one large response chunk by bytes without trusting framing metadata', async () => {
    let closed = false;
    respond = (_req, res) => {
      res.once('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
      res.end('x'.repeat(513));
    };
    await expect(client(2_000, 512).unsV2.recordFind({ collectionId: 'orders' })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
    await expect.poll(() => closed).toBe(true);
  });

  it('accepts a valid response exactly at the configured byte limit', async () => {
    const prefix = '{"code":200,"msg":"ok","requestId":"req-limit","data":{"items":[],"pageInfo":{"hasMore":false},"padding":"';
    const suffix = '"}}';
    const body = `${prefix}${'x'.repeat(512 - prefix.length - suffix.length)}${suffix}`;
    expect(new TextEncoder().encode(body)).toHaveLength(512);
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) });
      res.end(body);
    };
    await expect(client(2_000, 512).unsV2.recordFind({ collectionId: 'orders' })).resolves.toMatchObject({
      code: 200, requestId: 'req-limit', data: { items: [], pageInfo: { hasMore: false } },
    });
  });

  it('bounds a multi-chunk response and cancels before later chunks', async () => {
    let closed = false;
    let lateWrite: ReturnType<typeof setTimeout> | undefined;
    respond = (_req, res) => {
      res.once('close', () => { closed = true; if (lateWrite) clearTimeout(lateWrite); });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
      res.write('x'.repeat(300));
      res.write('y'.repeat(300));
      lateWrite = setTimeout(() => res.end('z'), 1_000);
    };
    await expect(client(2_000, 512).unsV2.recordFind({ collectionId: 'orders' })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
    await expect.poll(() => closed).toBe(true);
  });

  it('rejects an oversized declared response before reading its body', async () => {
    let closed = false;
    respond = (_req, res) => {
      res.once('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '513' });
      res.write('x');
    };
    await expect(client(2_000, 512).unsV2.recordFind({ collectionId: 'orders' })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
    await expect.poll(() => closed).toBe(true);
  });

  it('does not follow redirects or resend mutations', async () => {
    const start = received.length;
    respond = (_req, res) => { res.writeHead(307, { Location: '/redirected' }); res.end('{}'); };
    await expect(client().unsV2.recordInsertOne({
      dryRun: false, collectionId: 'orders', data: { status: 'new' },
    })).rejects.toMatchObject({
      name: 'UnsV2OutcomeUnknownError', status: 307, operation: 'recordInsertOne',
      code: 'UNS_V2_PROTOCOL_ERROR', retryable: false, outcomeUnknown: true,
    });
    expect(received.length - start).toBe(1);
  });

  it('does not retry a mutation when the socket closes after consuming the request', async () => {
    const start = received.length;
    respond = req => req.socket.destroy();
    await expect(client().unsV2.sampleAppend({
      dryRun: false, collectionId: 'telemetry', recordId: 'machine-1', items: [{ time: 1, data: { value: 3 } }],
    })).rejects.toMatchObject({ name: 'UnsV2OutcomeUnknownError', code: 'UNS_V2_TRANSPORT_ERROR' });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(received.length - start).toBe(1);
  });

  it('bounds the complete mutation exchange and never resends a stalled response body', async () => {
    const start = received.length;
    let closed = false;
    respond = (_req, res) => {
      res.once('close', () => { closed = true; });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"code":200,"msg":"partial"');
    };
    const error = await client(100).unsV2.recordDeleteOne({
      dryRun: false, collectionId: 'orders', filter: { _id: 'order-1' },
    }).catch(value => value);
    expect(error).toMatchObject({
      name: 'UnsV2OutcomeUnknownError', operation: 'recordDeleteOne',
      code: 'UNS_V2_TRANSPORT_TIMEOUT', status: 200, retryable: false, outcomeUnknown: true,
    });
    await expect.poll(() => closed).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(received.length - start).toBe(1);
  });
});


describe('Record notifications over the existing isolated HTTP transport', () => {
  it('exposes a readonly operation and preserves cursor plus exact integer notification identity', async () => {
    const start = received.length;
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"code":200,"msg":"ok","requestId":"changes","data":{"items":[{"eventId":"stable-event","collectionId":"orders","recordId":"9007199254740993","change":"record","occurredAt":9007199254740993}],"nextCursor":"rc1.sealed.fixture","retentionMs":3600000}}');
    };
    const result = await client().unsV2.recordChangesPoll({ collectionId: 'orders', cursor: 'rc1.old.fixture', limit: 20, waitMs: 0 });
    expect(UNS_V2_OPERATIONS.recordChangesPoll.mutation).toBe(false);
    expect(result.data.nextCursor).toBe('rc1.sealed.fixture');
    expect(String(result.data.items[0].occurredAt)).toBe('9007199254740993');
    expect(result.data.items[0].recordId).toBe('9007199254740993');
    expect(received.slice(start)).toHaveLength(1);
    expect(received.at(-1)?.path).toBe('/openapi/v2/uns/records/changes');
    expect(JSON.parse(received.at(-1)!.body)).toEqual({ collectionId: 'orders', cursor: 'rc1.old.fixture', limit: 20, waitMs: 0 });
  });
  it.each([[409, 'CURSOR_EXPIRED'], [403, 'FORBIDDEN'], [503, 'TEMPORARILY_UNAVAILABLE']])('preserves %s/%s without automatic reconnect or write replay', async (status, code) => {
    const start = received.length;
    respond = (_req, res) => send(res, { code: status, msg: 'safe failure', requestId: 'changes', data: null,
      error: { code, retryable: false, details: [], retryAdvice: { recommendedAction: 'restoreAuthorizationBeforeRetry', canRetrySameRequest: false, keepIdempotencyKey: true } } }, status);
    const error = await client().unsV2.recordChangesPoll({ collectionId: 'orders', cursor: 'rc1.old' }).catch(value => value);
    expect(error).toBeInstanceOf(UnsV2Error);
    expect(error).not.toBeInstanceOf(UnsV2OutcomeUnknownError);
    expect(error).toMatchObject({ status, code, operation: 'recordChangesPoll' });
    expect(received.slice(start)).toHaveLength(1);
  });
});
