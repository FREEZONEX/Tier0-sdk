import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { APP_REQUEST_IDENTITY_CONTRACT as contract } from '../dist/esm/app-identity-contract.generated.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'tier0-cloud-app-test-'));
const appID = '67aa531e-e686-4b32-8e23-907cc267335e';
const collectionId = '27866a11-b4fe-4f02-84f1-f9c824d265d8';
let mode = 'write';
let insertAttempts = 0;
const intents = new Map();
const items = [];
const identityPair = generateKeyPairSync('ed25519');
const identityPublicKeys = JSON.stringify({ keys: [{ ...identityPair.publicKey.export({ format: 'jwk' }), kid: 'fixture-current' }] });
const workspaceID = '9007199254740993';
const controlCode = 'fixture.telemetry';
let controlMode = 'active'; let controlAttempts = 0; let deviceOperations = 0;
const controlIntents = new Map();
const gateway = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  if (req.url.startsWith('/openapi/v1/controls/')) {
    assert.equal(req.headers['x-api-key'], 'fixture-control-key-not-production');
    if (controlMode === 'revoked') { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ errorCode: 'CONTROL_FORBIDDEN', message: 'must-not-expose-private-detail' })); }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/describe')) return res.end(JSON.stringify({ code: controlCode, name: 'Telemetry', description: '', contractVersion: '1.0', inputSchema: {}, outputSchema: {}, sideEffect: 'write', idempotency: 'required', timeoutMs: 5000, status: 'active' }));
    assert.equal(req.url, `/openapi/v1/controls/${controlCode}/invoke`); controlAttempts++;
    if (controlMode === 'unknown') return req.socket.destroy();
    const payload = JSON.parse(body); assert.deepEqual(payload.input, {});
    const replayed = controlIntents.has(payload.idempotencyKey);
    if (!replayed) { controlIntents.set(payload.idempotencyKey, true); deviceOperations++; }
    return res.end(JSON.stringify({ code: controlCode, contractVersion: '1.0', runID: 'fixture-control-run', status: 'completed', replayed, result: { privateSourceDetail: 'must-not-expose-private-detail' } }));
  }
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
  const image = `registry.example.invalid/node@sha256:${'a'.repeat(64)}`;
  execFileSync(process.execPath, [join(root, 'scripts/package-cloud-uns-app.mjs'), archive], {
    env: { ...process.env, TIER0_APP_RUN_IMAGE: image },
  });
  const app = join(dir, 'app'); mkdirSync(app);
  execFileSync('python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, app]);
  assert.ok(readFileSync(join(app, 'artifact.toml'), 'utf8').includes(`image = "${image}"`));
  execFileSync(process.execPath, ['build.mjs'], { cwd: app });
  child = spawn(process.execPath, ['.runtime/server.mjs'], {
    cwd: app, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), TIER0_API_HOST: `http://127.0.0.1:${gateway.address().port}`, TIER0_API_KEY: 'fixture-key-not-production',
      TIER0_CONTROL_API_KEY: 'fixture-control-key-not-production', CLOUD_APP_ID: appID, CLOUD_WORKSPACE_ID: workspaceID,
      CLOUD_APP_IDENTITY_PUBLIC_KEYS: identityPublicKeys, CLOUD_CONTROL_USER_IDS: '9007199254740995', CLOUD_CONTROL_CODE: controlCode },
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
  const devicePath = '/api/device/telemetry';
  function signedRequest(method, raw, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { ver: contract.version, iss: contract.issuer, aud: contract.audience, sub: '9007199254740995',
      workspaceID, appID, method, requestURI: devicePath, bodySHA256: createHash('sha256').update(raw).digest('hex'),
      iat: now, exp: now + 30, jti: randomUUID().replaceAll('-', ''), roles: ['operator'], ...overrides };
    const value = Buffer.from(JSON.stringify({ alg: contract.algorithm, typ: contract.type, kid: 'fixture-current' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    return value + '.' + sign(null, Buffer.from(value), identityPair.privateKey).toString('base64url');
  }
  const invoke = (value, overrides = {}, header) => {
    const raw = JSON.stringify(value);
    return fetch(host + devicePath, { method: 'POST', headers: { 'Content-Type': 'application/json',
      [contract.header]: header ?? signedRequest('POST', raw, overrides) }, body: raw });
  };
  const intent = { intentId: randomUUID() };
  assert.equal((await fetch(host + devicePath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent) })).status, 401);
  assert.equal((await invoke(intent, {}, 'forged')).status, 401);
  assert.equal((await invoke(intent, { workspaceID: '2' })).status, 401);
  assert.equal((await invoke(intent, { appID: '19c578a2-2027-41be-8517-bd8dc999ac2c' })).status, 401);
  assert.equal((await invoke(intent, { sub: '2' })).status, 403);
  assert.equal((await invoke(intent, {}, signedRequest('POST', '{}'))).status, 401);
  for (const field of ['streamId', 'entryId', 'deploymentVersion', 'timeoutMs', 'code', 'userID']) {
    assert.equal((await invoke({ ...intent, [field]: 'untrusted' })).status, 400);
  }
  assert.equal(controlAttempts, 0, 'invalid identity/input must not access the Source');
  const describe = await fetch(host + devicePath, { headers: { [contract.header]: signedRequest('GET', '') } });
  assert.equal(describe.status, 200); assert.equal((await describe.json()).operator, '9007199254740995');
  const first = await invoke(intent); assert.equal(first.status, 200); assert.deepEqual(await first.json(), { status: 'completed', replayed: false });
  const repeated = await invoke(intent); assert.equal(repeated.status, 200); assert.deepEqual(await repeated.json(), { status: 'completed', replayed: true });
  assert.equal(deviceOperations, 1, 'a fresh gateway assertion must preserve the original business intent');
  controlMode = 'revoked'; const revoked = await invoke(intent); assert.equal(revoked.status, 403);
  assert.deepEqual(await revoked.json(), { code: 'CONTROL_FORBIDDEN' }); assert.equal(deviceOperations, 1);
  controlMode = 'unknown'; const beforeUnknown = controlAttempts; const unknownControl = await invoke({ intentId: randomUUID() });
  assert.equal(unknownControl.status, 504); assert.deepEqual(await unknownControl.json(), { code: 'OUTCOME_UNKNOWN' });
  assert.equal(controlAttempts, beforeUnknown + 1, 'uncertain control writes must not retry');
  child.kill('SIGTERM'); await once(child, 'exit');
  child = spawn(process.execPath, ['.runtime/server.mjs'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), TIER0_API_HOST: `http://127.0.0.1:${gateway.address().port}`, TIER0_API_KEY: 'fixture-key-not-production',
      TIER0_CONTROL_API_KEY: '', CLOUD_APP_ID: appID, CLOUD_WORKSPACE_ID: workspaceID, CLOUD_APP_IDENTITY_PUBLIC_KEYS: identityPublicKeys,
      CLOUD_CONTROL_USER_IDS: '9007199254740995', CLOUD_CONTROL_CODE: controlCode } });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${host}/healthz`)).ok) break; } catch { /* Wait for this owned replacement child. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await invoke(intent)).status, 503); assert.equal(controlAttempts, beforeUnknown + 1, 'missing control Key cannot use the data Key');
  console.log('PASS: App server Ed25519 validation, operator allowlist, strict control input, dedicated Key, stable business replay, revocation, redaction, unknown outcome once and no data-Key fallback');
  console.log('PASS: offline package/public SDK import, page, strict input, write/read/replay, read-only, revocation, redaction, unknown outcome without retry');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
