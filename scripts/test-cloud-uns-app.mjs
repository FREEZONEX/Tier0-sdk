import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'tier0-cloud-app-test-'));
const appID = '67aa531e-e686-4b32-8e23-907cc267335e';
const collectionId = '27866a11-b4fe-4f02-84f1-f9c824d265d8';
let mode = 'write';
let insertAttempts = 0;
const intents = new Map();
const items = [];
const gateway = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  assert.equal(req.headers['x-api-key'], 'fixture-key-not-production');
  const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (mode === 'revoked') return reply(403, {
    code: 403, msg: 'must-not-expose-private-detail', requestId: 'fixture-revoked',
    error: { code: 'FORBIDDEN', retryable: false },
  });
  if (req.url === '/openapi/v2/uns/app/context') return reply(200, {
    code: 200, requestId: 'fixture-context', msg: 'success', data: {
      appId: appID, name: 'SDK App fixture', revision: 1, platformPermissions: [],
      collections: [{ alias: 'orders', collectionId, permissions: mode === 'read' ? ['record:read'] : ['record:read', 'record:write'], recordSchema: { type: 'object' } }],
    },
  });
  if (req.url === `/openapi/v2/uns/collections/${collectionId}/records:find`) return reply(200, {
    code: 200, requestId: 'fixture-find', msg: 'success', data: { items, pageInfo: { hasMore: false } },
  });
  if (req.url === `/openapi/v2/uns/collections/${collectionId}/records`) {
    insertAttempts++;
    if (mode === 'unknown') return req.socket.destroy();
    const input = JSON.parse(body);
    const replayed = intents.has(input.idempotencyKey);
    if (!replayed) {
      intents.set(input.idempotencyKey, true);
      items.push({ id: input.id, revision: 1, data: input.data });
    }
    return reply(200, { code: 200, msg: 'success', requestId: 'fixture-insert', data: { status: 'committed', insertedId: input.id, replayed } });
  }
  reply(404, { code: 404 });
});
let child;
try {
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const archive = join(dir, 'app.zip');
  execFileSync(process.execPath, [join(root, 'scripts/package-cloud-uns-app.mjs'), archive]);
  const app = join(dir, 'app'); mkdirSync(app);
  execFileSync('python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, app]);
  execFileSync(process.execPath, ['build.mjs'], { cwd: app });
  child = spawn(process.execPath, ['.runtime/server.mjs'], {
    cwd: app, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), TIER0_API_HOST: `http://127.0.0.1:${gateway.address().port}`, TIER0_API_KEY: 'fixture-key-not-production' },
  });
  const host = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(`${host}/healthz`)).ok; } catch { /* Wait for this owned child only. */ }
    if (ready) break;
    if (child.exitCode !== null) throw new Error('App process exited before readiness');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'offline packaged App should start without MQTT or npm install');
  const html = await (await fetch(host)).text();
  assert.ok(html.includes('order-form'));
  assert.ok(!html.includes('fixture-key-not-production'));
  const input = { orderNo: 'acceptance-001', amount: 100, idempotencyKey: 'intent-acceptance-001' };
  const post = async (body) => fetch(`${host}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ ...input, collectionId: 'forged' })).status, 400);
  assert.equal(insertAttempts, 0);
  assert.equal((await post(input)).status, 200);
  assert.equal((await (await post(input)).json()).replayed, true);
  const list = await (await fetch(`${host}/api/orders`)).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].data.orderNo, input.orderNo);
  mode = 'read';
  assert.equal((await (await fetch(`${host}/api/orders`)).json()).canWrite, false);
  assert.equal((await post(input)).status, 403);
  assert.equal(insertAttempts, 2, 'read-only grant must prevent a downstream mutation');
  mode = 'revoked';
  const denied = await fetch(`${host}/api/orders`);
  assert.equal(denied.status, 403);
  const error = await denied.text();
  assert.ok(!error.includes('must-not-expose-private-detail'));
  assert.ok(!error.includes('fixture-key-not-production'));
  mode = 'unknown';
  const unknown = await post({ ...input, orderNo: 'acceptance-unknown', idempotencyKey: 'intent-unknown-001' });
  assert.equal(unknown.status, 504);
  assert.equal((await unknown.json()).code, 'OUTCOME_UNKNOWN');
  assert.equal(insertAttempts, 3, 'SDK and App must not retry an uncertain mutation');
  console.log('PASS: offline package/public SDK import, page, strict input, write/read/replay, read-only, revocation, redaction, unknown outcome without retry');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
