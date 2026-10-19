import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, UNS_V2_CODEC_SCHEMAS, UNS_V2_CONTRACT_PROVENANCE, UNS_V2_OPERATIONS, UnsV2Error, UnsV2OutcomeUnknownError, UnsV2RawNumber } from '../../src/index.js';

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
    await expect(api.streamSampleTest({ document: { name: 'sample', model: 'script', script: { sdkVersion: 'tier0-stream/v2', code: '', timeoutMs: 1000 } }, entryId: 'sample', input: { value: 1 } })).rejects.toBeInstanceOf(UnsV2Error);
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start].path).toBe('/openapi/v2/uns/streams/sample/test');
    const core = api as unknown as { call(name: string, request: unknown): Promise<unknown> };
    for (const name of ['graph', 'sourceCredentialCreate', 'sourceIngressGet', 'sourceIngressRotate']) {
      expect(Object.hasOwn(UNS_V2_OPERATIONS, name)).toBe(false);
      await expect(core.call(name, {})).rejects.toThrow('unknown UNS v2 operation');
    }
    for (const name of ['CloudSourceCredentialCreateReq', 'CloudSourceCredentialCreateResponse', 'CloudSourceIngressGetReq', 'CloudSourceIngressRotateReq']) {
      expect(Object.hasOwn(UNS_V2_CODEC_SCHEMAS, name)).toBe(false);
    }
    expect(UNS_V2_CONTRACT_PROVENANCE.publicOperationCount).toBe(80);
    expect(UNS_V2_CONTRACT_PROVENANCE.manifestOperationCount).toBe(84);
    expect(received.slice(start)).toHaveLength(1);
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
    for (const name of ['constructor', '__proto__', 'toString', 'ordinaryUnknown', { toString: () => 'records' }]) {
      await expect(core.call(name, {})).rejects.toThrow('unknown UNS v2 operation');
    }
    expect(received.length).toBe(start);
  });

  it('uses only the frozen operation path and preserves omission, null and workspace authentication', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'req-list', data: { results: [{
        queryId: 'orders', resultMode: 'all', items: [],
        pageInfo: { hasMore: true, nextCursor: 'opaque-next', snapshotScope: 'thisRequestOnly' },
      }] },
    });
    const response = await client().unsV2.records({ queries: [{
      queryId: 'orders', collectionId: 'orders', pipeline: [],
      page: { mode: 'cursor', size: 20 },
    }] });
    const result = response.data.results[0];
    expect(result.resultMode === 'all' && result.pageInfo.nextCursor).toBe('opaque-next');
    expect(received.slice(start)).toHaveLength(1);
    expect(received[start]).toMatchObject({
      method: 'POST', path: '/openapi/v2/uns/records/query',
      body: '{"queries":[{"queryId":"orders","collectionId":"orders","pipeline":[],"page":{"mode":"cursor","size":20}}]}',
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
      res.end('{"code":200,"msg":"ok","requestId":"req-business","data":{"results":[{"queryId":"q","resultMode":"all","items":[{"numeric":"123","unit":"bar","nested":{"numeric":false},"nullable":null,"int64Max":9223372036854775807,"int64Min":-9223372036854775808,"decimal":1.0000000000000001,"exponent":9.007199254740993e15,"__proto__":{"polluted":true},"constructor":"business","prototype":"field"}],"pageInfo":{"hasMore":false,"nextCursor":null,"snapshotScope":"thisRequestOnly"}}]}}');
    };
    const response = await client().unsV2.records({ queries: [{
      queryId: 'q', collectionId: 'measurements', pipeline: [], page: { mode: 'cursor', size: 1 },
    }] });
    const item = response.data.results[0].resultMode === 'all' ? response.data.results[0].items[0] : undefined;
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

  it('uses record-scoped Sample queries from the v3.17 contract', async () => {
    const start = received.length;
    respond = (_req, res) => send(res, {
      code: 200, msg: 'ok', requestId: 'req-samples', data: { results: [{
        queryId: 'sample', resultMode: 'all', items: [],
        pageInfo: { hasMore: false, nextCursor: null, snapshotScope: 'thisRequestOnly' },
      }] },
    });
    await client().unsV2.samples({ queries: [{
      queryId: 'sample', collectionId: 'measurements', recordId: 'machine-1', pipeline: [], resultMode: 'all',
    }] });
    expect(received[start]).toMatchObject({
      path: '/openapi/v2/uns/samples/query',
      body: '{"queries":[{"queryId":"sample","collectionId":"measurements","recordId":"machine-1","pipeline":[],"resultMode":"all"}]}',
    });
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
      script: { sdkVersion: 'tier0-stream/v2', code: 'module.exports = api => api;', timeoutMs: 1_000 },
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
      await expect(client().unsV2.records({ queries: [] })).rejects.toMatchObject({
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
    await expect(client().unsV2.records({ queries: [] })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 500, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
  });

  it('treats a non-canonical mutation success envelope as outcome unknown', async () => {
    respond = (_req, res) => send(res, {
      code: 500, msg: 'not canonical', requestId: 'req-mutation-mismatch', data: null,
    });
    await expect(client().unsV2.recordDelete({
      dryRun: false, collectionId: 'orders', items: [{ id: 'order-1' }],
    })).rejects.toMatchObject({
      name: 'UnsV2OutcomeUnknownError', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', outcomeUnknown: true,
    });
  });

  it('rejects a request above the 16 MiB contract limit before fetch', async () => {
    const start = received.length;
    await expect(client().unsV2.recordCreate({
      dryRun: false,
      collectionId: 'orders',
      items: [{ data: { payload: 'x'.repeat((16 << 20) + 1) } }],
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
    await expect(client(2_000, 512).unsV2.records({ queries: [] })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
    await expect.poll(() => closed).toBe(true);
  });

  it('accepts a valid response exactly at the configured byte limit', async () => {
    const prefix = '{"code":200,"msg":"ok","requestId":"req-limit","data":{"results":[],"padding":"';
    const suffix = '"}}';
    const body = `${prefix}${'x'.repeat(512 - prefix.length - suffix.length)}${suffix}`;
    expect(new TextEncoder().encode(body)).toHaveLength(512);
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(body.length) });
      res.end(body);
    };
    await expect(client(2_000, 512).unsV2.records({ queries: [] })).resolves.toMatchObject({
      code: 200, requestId: 'req-limit', data: { results: [] },
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
    await expect(client(2_000, 512).unsV2.records({ queries: [] })).rejects.toMatchObject({
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
    await expect(client(2_000, 512).unsV2.records({ queries: [] })).rejects.toMatchObject({
      name: 'UnsV2Error', status: 200, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false,
    });
    await expect.poll(() => closed).toBe(true);
  });

  it('does not follow redirects or resend mutations', async () => {
    const start = received.length;
    respond = (_req, res) => { res.writeHead(307, { Location: '/redirected' }); res.end('{}'); };
    await expect(client().unsV2.recordCreate({
      dryRun: false, collectionId: 'orders', items: [{ data: { status: 'new' } }],
    })).rejects.toMatchObject({
      name: 'UnsV2OutcomeUnknownError', status: 307, operation: 'recordCreate',
      code: 'UNS_V2_PROTOCOL_ERROR', retryable: false, outcomeUnknown: true,
    });
    expect(received.length - start).toBe(1);
  });

  it('does not retry a mutation when the socket closes after consuming the request', async () => {
    const start = received.length;
    respond = req => req.socket.destroy();
    await expect(client().unsV2.sampleAppend({
      dryRun: false, collectionId: 'telemetry', items: [{ recordId: 'machine-1', time: 1, data: { value: 3 } }],
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
    const error = await client(100).unsV2.recordDelete({
      dryRun: false, collectionId: 'orders', items: [{ id: 'order-1' }],
    }).catch(value => value);
    expect(error).toMatchObject({
      name: 'UnsV2OutcomeUnknownError', operation: 'recordDelete',
      code: 'UNS_V2_TRANSPORT_TIMEOUT', status: 200, retryable: false, outcomeUnknown: true,
    });
    await expect.poll(() => closed).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(received.length - start).toBe(1);
  });
});
