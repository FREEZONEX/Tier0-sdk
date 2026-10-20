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
const dataUsers = ['9007199254740995', '9007199254740996'];
let dataRequests = 0;
let leakRows = false;
let invalidPolicy = false;
function signedRequest(method, raw, overrides = {}, requestURI = '/api/device/telemetry') {
    const now = Math.floor(Date.now() / 1000);
    const payload = { ver: contract.version, iss: contract.issuer, aud: contract.audience, sub: '9007199254740995',
      workspaceID, appID, method, requestURI, bodySHA256: createHash('sha256').update(raw).digest('hex'),
      iat: now, exp: now + 30, jti: randomUUID().replaceAll('-', ''), roles: ['operator'], ...overrides };
    const value = Buffer.from(JSON.stringify({ alg: contract.algorithm, typ: contract.type, kid: 'fixture-current' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    return value + '.' + sign(null, Buffer.from(value), identityPair.privateKey).toString('base64url');
  }
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
  dataRequests++;
  assert.equal(req.headers['x-api-key'], 'fixture-key-not-production');
  const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (mode === 'revoked') return reply(403, {
    code: 403, msg: 'must-not-expose-private-detail', requestId: 'fixture-revoked',
    error: { code: 'FORBIDDEN', retryable: false },
  });
  if (req.url === '/openapi/v2/uns/app/context') return reply(200, {
    code: 200, requestId: 'fixture-context', msg: 'success', data: {
      appId: appID, name: 'SDK App fixture', revision: 1, platformPermissions: [],
      collections: [{ alias: 'orders', collectionId, permissions: mode === 'read' ? ['record:read'] : ['record:read', 'record:write'], recordSchema: invalidPolicy ? { type: 'object' } : { type: 'object', properties: { ownerUserId: { type: 'string' } }, required: ['ownerUserId'] } }],
    },
  });
  if (req.url === `/openapi/v2/uns/collections/${collectionId}/records:find`) {
    const input = JSON.parse(body);
    assert.deepEqual(Object.keys(input.filter), ['ownerUserId']);
    const userID = input.filter.ownerUserId.$eq;
    assert.ok(dataUsers.includes(userID));
    assert.deepEqual(input.projection, { orderNo: 1, amount: 1, status: 1, ownerUserId: 1 });
    return reply(200, { code: 200, requestId: 'fixture-find', msg: 'success', data: {
      items: leakRows ? items : items.filter((item) => item.data.ownerUserId === userID), pageInfo: { hasMore: false },
    } });
  }
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
      CLOUD_APP_IDENTITY_PUBLIC_KEYS: identityPublicKeys, CLOUD_DATA_USER_IDS: dataUsers.join(','), CLOUD_CONTROL_USER_IDS: '9007199254740995', CLOUD_CONTROL_CODE: controlCode },
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
  const dataPath = '/api/orders';
  const dataRequest = (method, value, userID = dataUsers[0], options = {}) => {
    const raw = value === undefined ? '' : JSON.stringify(value);
    const uri = options.uri || dataPath;
    const headers = { 'Content-Type': 'application/json' };
    if (options.assertion !== null) headers[contract.header] = options.assertion || signedRequest(method, raw, { sub: userID, ...options.claims }, uri);
    return fetch(host + uri, { method, headers, ...(value === undefined ? {} : { body: raw }) });
  };
  const post = (value, userID, options) => dataRequest('POST', value, userID, options);
  const listFor = (userID = dataUsers[0]) => dataRequest('GET', undefined, userID);
  assert.equal((await dataRequest('GET', undefined, dataUsers[0], { assertion: null })).status, 401);
  assert.equal((await post(input, dataUsers[0], { assertion: 'forged' })).status, 401);
  assert.equal((await post(input, dataUsers[0], { claims: { workspaceID: '2' } })).status, 401);
  assert.equal((await post(input, dataUsers[0], { claims: { appID: '19c578a2-2027-41be-8517-bd8dc999ac2c' } })).status, 401);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await post(input, dataUsers[0], { claims: { iat: now - 90, exp: now - 60 } })).status, 401);
  assert.equal((await post(input, '2')).status, 403);
  assert.equal((await post(input, dataUsers[0], { assertion: signedRequest('POST', '{}', {}, dataPath) })).status, 401);
  assert.equal(dataRequests, 0, 'unverified or ungranted employees cannot reach the data Key');
  assert.equal((await dataRequest('GET', undefined, dataUsers[0], { uri: '/api/orders?ownerUserId=2' })).status, 400);
  for (const field of ['collectionId', 'ownerUserId', 'userID', 'status', 'filter']) {
    assert.equal((await post({ ...input, [field]: 'forged' })).status, 400);
  }
  assert.equal(insertAttempts, 0);
  assert.equal((await post(input)).status, 200);
  assert.equal((await (await post(input)).json()).replayed, true);
  assert.equal((await (await post(input, dataUsers[1])).json()).replayed, false);
  assert.equal(items.length, 2, 'equal user input and intent in different employees must create independent records');
  assert.notEqual(items[0].id, items[1].id);
  assert.deepEqual(items.map((item) => item.data.ownerUserId), dataUsers);
  const list = await (await listFor()).json();
  const otherList = await (await listFor(dataUsers[1])).json();
  assert.equal(list.operator, dataUsers[0]); assert.equal(otherList.operator, dataUsers[1]);
  assert.equal(list.items.length, 1); assert.equal(otherList.items.length, 1);
  assert.notEqual(list.items[0].id, otherList.items[0].id);
  assert.equal(list.items[0].data.orderNo, input.orderNo);
  assert.ok(!JSON.stringify(list.items).includes('ownerUserId'), 'internal owner fields are not projected to browser rows');
  leakRows = true;
  const leaked = await listFor(); assert.equal(leaked.status, 503);
  assert.deepEqual(await leaked.json(), { code: 'APP_DATA_POLICY_UNAVAILABLE' });
  leakRows = false; invalidPolicy = true;
  assert.equal((await listFor()).status, 503);
  invalidPolicy = false;
  const beforeReadOnly = insertAttempts;
  mode = 'read';
  assert.equal((await (await listFor()).json()).canWrite, false);
  assert.equal((await post(input)).status, 403);
  assert.equal(insertAttempts, beforeReadOnly, 'read-only grant must prevent a downstream mutation');
  mode = 'revoked';
  const denied = await listFor();
  assert.equal(denied.status, 403);
  const error = await denied.text();
  assert.ok(!error.includes('must-not-expose-private-detail'));
  assert.ok(!error.includes('fixture-key-not-production'));
  mode = 'unknown';
  const beforeUnknownData = insertAttempts;
  const unknown = await post({ ...input, orderNo: 'acceptance-unknown', idempotencyKey: 'intent-unknown-001' });
  assert.equal(unknown.status, 504);
  assert.equal((await unknown.json()).code, 'OUTCOME_UNKNOWN');
  assert.equal(insertAttempts, beforeUnknownData + 1, 'SDK and App must not retry an uncertain mutation');
  const devicePath = '/api/device/telemetry';

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
  assert.equal((await listFor()).status, 503, 'missing employee policy cannot fall back to a shared anonymous data Key');
  console.log('PASS: verified employee data identity, exact request binding, mandatory owner filter, protected fields, per-user record/intent identities, cross-user isolation and fail-closed policy');
  console.log('PASS: App server Ed25519 validation, operator allowlist, strict control input, dedicated Key, stable business replay, revocation, redaction, unknown outcome once and no data-Key fallback');
  console.log('PASS: offline package/public SDK import, page, strict input, write/read/replay, read-only, revocation, redaction, unknown outcome without retry');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
