import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, UnsV2Error, UnsV2OutcomeUnknownError, UnsV2RawNumber } from '../src/index.js';
import { appendTelemetry, readTelemetry, updateRecord } from '../examples/uns-v5-data.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/uns-v5-data.json', import.meta.url), 'utf8'));
const received = [];
let fault;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  received.push({ method: req.method, path: req.url, body, headers: req.headers });
  const fixture = Object.values(fixtures).find(row => row.path === req.url);
  res.writeHead(fault ? 409 : fixture ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(fault || fixture?.response || '{}');
});
let client;
beforeAll(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  client = createClient({ apiHost: `http://127.0.0.1:${server.address().port}`,
    apiKey: 'fixture-data-key', unsV2AppDataSubject: 'fixture.employee.signature', transportTimeoutMs: 1000 }).unsV2;
});
beforeEach(() => { received.length = 0; fault = undefined; });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
const target = { collectionId: 'measurements', recordId: 'meter-1' };
const write = () => updateRecord(client, { collectionId: target.collectionId, id: target.recordId,
  expectedRevision: new UnsV2RawNumber('9007199254740993'), changes: { counter: new UnsV2RawNumber('9007199254740993') },
  idempotencyKey: 'record-intent-1' });
function exchanges(names) {
  expect(received.map(row => ({ method: row.method, path: row.path, body: row.body }))).toEqual(names.map(name => ({
    method: 'POST', path: fixtures[name].path,
    body: typeof fixtures[name].body === 'string' ? fixtures[name].body : JSON.stringify(fixtures[name].body),
  })));
  for (const row of received) {
    expect(row.headers.authorization).toBe('Bearer fixture-data-key');
    expect(row.headers['x-tier0-app-data-subject']).toBe('fixture.employee.signature');
    expect(row.path).not.toMatch(/streams|invoke|records\/list|samples\/history/);
  }
}

describe('v5 native Record/Sample consumer with golden HTTP fixtures', () => {
  it('reads records, bounded sample history and true latest samples without substituting record data', async () => {
    const result = await readTelemetry(client, { collectionId: 'measurements', recordIds: ['meter-1', 'meter-missing'],
      from: 1792540800000, to: 1792540860000, cursor: 'opaque.history' });
    exchanges(['recordGet', 'sampleFind', 'sampleLatestValues']);
    expect(result.records.missing).toEqual(['meter-missing']);
    expect(result.records.items[0].data.counter).toEqual(new UnsV2RawNumber('9007199254740993'));
    expect(result.history.items[0].data.pressure).toEqual(new UnsV2RawNumber('1.0000000000000001'));
    expect(result.history.pageInfo.nextCursor).toBe('opaque.next');
    expect(result.latest[1]).toEqual({ recordId: 'meter-missing', sample: null });
  });

  it('appends a native sample with exact business decimals and retains accepted as pending', async () => {
    const result = await appendTelemetry(client, { ...target, time: 1792540800000,
      data: { pressure: new UnsV2RawNumber('1.0000000000000001') }, idempotencyKey: 'sample-intent-1' });
    exchanges(['sampleAppend']);
    expect(result.data).toEqual({ status: 'accepted', jobId: 'sample-job-1', replayed: false });
    expect(result).not.toHaveProperty('ack');
  });

  it('updates a record with its exact revision and consumes the returned native document', async () => {
    const result = await write();
    exchanges(['recordUpdateOne']);
    expect(result.data.value.id).toBe('meter-1');
    expect(result.data.value.revision).toEqual(new UnsV2RawNumber('9007199254740993'));
    expect(result.data.value.data.counter).toEqual(new UnsV2RawNumber('9007199254740993'));
  });

  it.each(['notStarted', 'rolledBack', 'committed', 'unknown'])('preserves v5 execution=%s without a read, retry or new intent', async execution => {
    fault = JSON.stringify({ code: 409, msg: 'write failed', requestId: 'v5-conflict', data: { modifiedCount: 1 },
      error: { code: 'VERSION_CONFLICT', reason: 'revision changed', execution, details: [{ path: 'expectedRevision' }], retry: { safe: false } } });
    const error = await write().catch(value => value);
    expect(error).toBeInstanceOf(UnsV2Error);
    expect(error instanceof UnsV2OutcomeUnknownError).toBe(execution === 'unknown');
    expect(error).toMatchObject({ code: 'VERSION_CONFLICT', execution, retry: { safe: false }, retryable: false, requestId: 'v5-conflict', data: { modifiedCount: 1 } });
    exchanges(['recordUpdateOne']);
  });
});
