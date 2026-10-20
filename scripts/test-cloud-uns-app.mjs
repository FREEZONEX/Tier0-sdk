import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
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
const supervisorID = '9007199254740997';
let dataRequests = 0;
let leakRows = false;
let invalidPolicy = false;
let appDataMode = 'legacy';
let hideOwner = false;
const proofs = new Map(dataUsers.map((userID, index) => [userID, `fixture.employee_${index}.signature`]));
proofs.set(supervisorID, 'fixture.supervisor.signature');
let hiddenDisplayFields = new Set();
let wrongContextApp = false;
let patchAttempts = 0;
let lastPatchRevision;
let overReturnFields = false;
let readablePrivateNote = false;
let injectedReadField;
const patchReceipts = new Map();
const readableFields = () => ['orderNo', 'amount', 'status'].filter((field) => !hiddenDisplayFields.has(field));
const dataExchanges = [];
let pendingContexts;
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
    assert.equal(req.headers['x-tier0-app-data-subject'], undefined, 'Control never receives a data proof');
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
  const proof = req.headers['x-tier0-app-data-subject'];
  const proofUser = [...proofs].find(([, value]) => value === proof)?.[0];
  dataExchanges.push({ path: req.url, body: JSON.parse(body), proof });
  if (appDataMode === 'core') {
    if (!proofUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 401, msg: 'private rejected proof', requestId: 'fixture-proof-rejected', data: null,
        error: { code: 'APP_DATA_SUBJECT_INVALID', retryable: false, details: [],
          retryAdvice: { recommendedAction: 'doNotRetry', canRetrySameRequest: false, keepIdempotencyKey: false } } }));
    }
  }
  else assert.equal(proof, undefined, 'legacy never forwards an inbound data proof');
  assert.equal(req.headers['x-api-key'], 'fixture-key-not-production');
  const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const failure = (status, code) => reply(status, { code: status, msg: 'private fixture policy detail', requestId: 'fixture-policy', data: null,
    error: { code, retryable: false, details: [], retryAdvice: { recommendedAction: 'doNotRetry', canRetrySameRequest: false, keepIdempotencyKey: true } } });
  if (mode === 'revoked') return reply(403, {
    code: 403, msg: 'must-not-expose-private-detail', requestId: 'fixture-revoked',
    error: { code: 'FORBIDDEN', retryable: false },
  });
  if (req.url === '/openapi/v2/uns/app/context') {
    if (pendingContexts) {
      const pending = pendingContexts;
      await new Promise((resolve) => { pending.push(resolve); if (pending.length === 2) { pendingContexts = undefined; pending.forEach((release) => release()); } });
    }
    return reply(200, {
    code: 200, requestId: 'fixture-context', msg: 'success', data: {
      appId: wrongContextApp ? 'another-app' : appID, name: 'SDK App fixture', revision: 1, platformPermissions: [],
      collections: [{ alias: 'orders', collectionId, permissions: mode === 'read' ? ['record:read'] : ['record:read', 'record:write'], recordSchema: invalidPolicy ? { type: 'object' } : {
        type: 'object', properties: { ...Object.fromEntries(readableFields().map((field) => [field, field === 'amount' ? { type: 'integer' } : { type: 'string', ...(field === 'status' ? { enum: ['draft'] } : {}) }])),
          ...(readablePrivateNote ? { privateNote: { type: 'string' } } : {}),
          ...(!hideOwner && proofUser !== supervisorID ? { ownerUserId: { type: 'string' } } : {}) },
        ...(!hideOwner && proofUser !== supervisorID ? { required: ['ownerUserId'] } : {}),
      } }],
    },
    });
  }
  if (req.url === `/openapi/v2/uns/collections/${collectionId}/records:find`) {
    const input = JSON.parse(body);
    if (appDataMode === 'core') {
      if (input.filter) assert.deepEqual(Object.keys(input.filter), ['_id'], 'only the target ID narrows Core detail lookup');
      else assert.equal(Object.hasOwn(input, 'filter'), false, 'Core list gets no App-side owner filter');
    }
    else assert.deepEqual(Object.keys(input.filter), ['ownerUserId']);
    const userID = appDataMode === 'core' ? proofUser : input.filter.ownerUserId.$eq;
    assert.ok([...dataUsers, supervisorID].includes(userID));
    if (appDataMode === 'core') assert.equal(Object.hasOwn(input, 'projection'), false, 'Core list/detail must exercise server field filtering without client projection');
    else assert.deepEqual(input.projection, { orderNo: 1, amount: 1, status: 1, ownerUserId: 1 });
    const visible = leakRows || (appDataMode === 'core' && proofUser === supervisorID) ? items : items.filter((item) => item.data.ownerUserId === userID);
    const selected = input.filter?._id ? visible.filter((item) => item.id === input.filter._id.$eq) : visible;
    return reply(200, { code: 200, requestId: 'fixture-find', msg: 'success', data: {
      items: selected.map((item) => {
        const coreFields = new Set([...readableFields(), ...(!hideOwner && proofUser !== supervisorID ? ['ownerUserId'] : []), ...(readablePrivateNote ? ['privateNote'] : [])]);
        const entries = Object.entries(item.data).filter(([field]) => appDataMode === 'core'
          ? overReturnFields || coreFields.has(field) : input.projection[field]);
        if (injectedReadField) entries.push([injectedReadField, 'fixture-hidden-value']);
        return { ...item, data: Object.fromEntries(entries) };
      }), pageInfo: { hasMore: false },
    } });
  }
  if (req.url === `/openapi/v2/uns/collections/${collectionId}/records:updateOne`) {
    patchAttempts++;
    const input = JSON.parse(body);
    assert.deepEqual(Object.keys(input).sort(), ['collectionId', 'dryRun', 'expectedRevision', 'filter', 'idempotencyKey', 'update', 'upsert'].sort());
    assert.equal(input.upsert, false); assert.equal(input.dryRun, false);
    assert.deepEqual(Object.keys(input.filter), ['_id']); assert.deepEqual(Object.keys(input.update), ['$set']);
    assert.ok(input.idempotencyKey.startsWith('app-order-patch-v1:'));
    if (mode === 'patch-unknown') return req.socket.destroy();
    if (mode === 'patch-redirect') { res.writeHead(307, { Location: '/redirected' }); return res.end('{}'); }
    // This models policy/receipts for local wiring tests only; it is not evidence
    // of real Core rule enforcement or a persistent business audit.
    const previous = patchReceipts.get(input.idempotencyKey);
    if (previous) {
      if (previous.body !== body) return failure(409, 'IDEMPOTENCY_CONFLICT');
      return reply(200, { ...previous.result, data: { ...previous.result.data, replayed: true } });
    }
    const row = items.find((item) => item.id === input.filter._id.$eq && (proofUser === supervisorID || item.data.ownerUserId === proofUser));
    if (!row) return reply(200, { code: 200, msg: 'ok', requestId: 'fixture-update', data: { status: 'committed', matchedCount: 0, modifiedCount: 0, replayed: false } });
    lastPatchRevision = body.match(/"expectedRevision":(\d+)/)[1];
    const expected = BigInt(lastPatchRevision);
    if (expected !== BigInt(row.revision)) return failure(409, 'REVISION_CONFLICT');
    const changes = input.update.$set;
    if (Object.hasOwn(changes, 'amount') && (proofUser === supervisorID || row.data.status !== 'draft')) return failure(403, 'FIELD_FORBIDDEN');
    if (Object.hasOwn(changes, 'status')) {
      const allowed = proofUser === supervisorID ? row.data.status === 'submitted' && ['approved', 'rejected'].includes(changes.status)
        : row.data.status === 'draft' && changes.status === 'submitted';
      if (!allowed) return failure(403, 'TRANSITION_FORBIDDEN');
    }
    Object.assign(row.data, changes); row.revision++;
    const result = { code: 200, msg: 'ok', requestId: 'fixture-update', data: { status: 'committed', matchedCount: 1, modifiedCount: 1, replayed: false } };
    patchReceipts.set(input.idempotencyKey, { body, result });
    return reply(200, result);
  }
  if (req.url === `/openapi/v2/uns/collections/${collectionId}/records`) {
    insertAttempts++;
    if (mode === 'unknown') return req.socket.destroy();
    const input = JSON.parse(body);
    if (appDataMode === 'core') {
      assert.deepEqual(Object.keys(input.data).sort(), ['amount', 'orderNo']);
      assert.ok(input.idempotencyKey.startsWith('app-order-intent-core-v1:'));
      assert.equal(input.id, 'app-order:' + createHash('sha256')
        .update(JSON.stringify([appID, workspaceID, proofUser, input.data.orderNo])).digest('hex'), 'order identity is unchanged across receipt domains');
    }
    const receipt = `${appDataMode}:${input.idempotencyKey}`;
    const replayed = intents.has(receipt);
    if (!replayed) {
      intents.set(receipt, true);
      // Fixture models stamping only to verify App wiring. This is NOT Core acceptance.
      items.push({ id: input.id, revision: 1, data: appDataMode === 'core' ? { ...input.data, ownerUserId: proofUser, status: 'draft' } : input.data });
    }
    return reply(200, { code: 200, msg: 'success', requestId: 'fixture-insert', data: { status: 'committed', insertedId: input.id, replayed } });
  }
  reply(404, { code: 404 });
});
let child;
let childOutput = '';
function captureChild() {
  child.stdout.on('data', (value) => { childOutput += value; });
  child.stderr.on('data', (value) => { childOutput += value; });
}
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
      CLOUD_APP_DATA_MODE: undefined, CLOUD_APP_CORE_WRITE_ENABLED: undefined,
      TIER0_CONTROL_API_KEY: 'fixture-control-key-not-production', CLOUD_APP_ID: appID, CLOUD_WORKSPACE_ID: workspaceID,
      CLOUD_APP_IDENTITY_PUBLIC_KEYS: identityPublicKeys, CLOUD_DATA_USER_IDS: dataUsers.join(','), CLOUD_CONTROL_USER_IDS: '9007199254740995', CLOUD_CONTROL_CODE: controlCode },
  });
  captureChild();
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
  const intentModule = await fetch(`${host}/order-intent.mjs`);
  assert.equal(intentModule.status, 200);
  assert.ok((await intentModule.text()).includes('NEW_DATA_INTENT_REQUIRED'), 'offline package serves the browser migration helper');
  const input = { orderNo: 'acceptance-001', amount: 100, idempotencyKey: 'intent-acceptance-001' };
  const dataPath = '/api/orders';
  const dataRequest = (method, value, userID = dataUsers[0], options = {}) => {
    const raw = value === undefined ? '' : JSON.stringify(value);
    const uri = options.uri || dataPath;
    const headers = { 'Content-Type': 'application/json' };
    if (appDataMode === 'core' && options.proof !== null) headers['X-Tier0-App-Data-Subject'] = options.proof ?? proofs.get(userID);
    if (options.assertion !== null) headers[contract.header] = options.assertion || signedRequest(method, raw, { sub: userID, ...options.claims }, uri);
    return fetch(host + uri, { method, headers, ...(value === undefined ? {} : { body: raw }) });
  };
  const post = (value, userID, options) => dataRequest('POST', value, userID, options);
  const listFor = (userID = dataUsers[0]) => dataRequest('GET', undefined, userID);
  const detailFor = (id, userID = dataUsers[0], options = {}) => dataRequest('GET', undefined, userID, { uri: `${dataPath}/${encodeURIComponent(id)}`, ...options });
  const patchBody = (changes, expectedRevision = '1') => ({ changes, expectedRevision, receiptDomain: 'core-order-patch/v1', idempotencyKey: `core-patch-v1-${randomUUID()}` });
  const patchFor = (id, value, userID = dataUsers[0], options = {}) => dataRequest('PATCH', value, userID, { uri: `${dataPath}/${encodeURIComponent(id)}`, ...options });
  assert.equal((await detailFor('legacy-id')).status, 404);
  assert.equal((await patchFor('legacy-id', patchBody({ amount: 1 }))).status, 404);
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
      CLOUD_APP_DATA_MODE: 'legacy', CLOUD_APP_CORE_WRITE_ENABLED: 'false',
      TIER0_CONTROL_API_KEY: '', CLOUD_APP_ID: appID, CLOUD_WORKSPACE_ID: workspaceID, CLOUD_APP_IDENTITY_PUBLIC_KEYS: identityPublicKeys,
      CLOUD_CONTROL_USER_IDS: '9007199254740995', CLOUD_CONTROL_CODE: controlCode } });
  captureChild();
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${host}/healthz`)).ok) break; } catch { /* Wait for this owned replacement child. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await invoke(intent)).status, 503); assert.equal(controlAttempts, beforeUnknown + 1, 'missing control Key cannot use the data Key');
  assert.equal((await listFor()).status, 503, 'missing employee policy cannot fall back to a shared anonymous data Key');
  async function startCore(writeEnabled = false) {
    child.kill('SIGTERM'); await once(child, 'exit');
    appDataMode = 'core'; mode = 'write'; controlMode = 'active';
    child = spawn(process.execPath, ['.runtime/server.mjs'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, PORT: String(port), TIER0_API_HOST: `http://127.0.0.1:${gateway.address().port}`,
      TIER0_API_KEY: 'fixture-key-not-production', TIER0_CONTROL_API_KEY: 'fixture-control-key-not-production',
      CLOUD_APP_ID: appID, CLOUD_WORKSPACE_ID: workspaceID, CLOUD_APP_IDENTITY_PUBLIC_KEYS: identityPublicKeys,
      CLOUD_DATA_USER_IDS: 'not-a-core-policy', CLOUD_CONTROL_USER_IDS: dataUsers[0], CLOUD_CONTROL_CODE: controlCode,
      CLOUD_APP_DATA_MODE: 'core', CLOUD_APP_CORE_WRITE_ENABLED: writeEnabled ? 'true' : undefined,
    } });
    captureChild();
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { ready = (await fetch(`${host}/healthz`)).ok; } catch { /* Owned local process only. */ }
      if (ready) break;
      assert.equal(child.exitCode, null);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready);
  }
  // Existing stored rows carry a private field; successful unprojected reads
  // below require the simulated Core (not the App view) to remove that field.
  items[0].data.privateNote = 'fixture-private-note-do-not-expose';
  await startCore();
  const coreStart = dataRequests;
  assert.equal((await dataRequest('GET', undefined, dataUsers[0], { proof: null })).status, 401);
  for (const proof of ['bad', 'a.b.c,a.b.c', 'a.b.c a.b.c']) {
    const response = await dataRequest('GET', undefined, dataUsers[0], { proof });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { code: 'APP_DATA_SUBJECT_INVALID' });
  }
  assert.equal((await dataRequest('GET', undefined, dataUsers[0], { assertion: 'forged', proof: 'bad' })).status, 401);
  // Node's fetch joins duplicate fields; send raw duplicate header lines as well.
  const duplicate = await new Promise((resolve, reject) => {
    const request = httpRequest(host + dataPath, { method: 'GET', headers: [
      'Host', new URL(host).host,
      contract.header, signedRequest('GET', '', {}, dataPath),
      'X-Tier0-App-Data-Subject', proofs.get(dataUsers[0]), 'x-tier0-app-data-subject', proofs.get(dataUsers[0]),
    ] }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end();
  });
  assert.equal(duplicate, 401);
  assert.equal(dataRequests, coreStart, 'invalid identity/proof never reaches Core, with no legacy fallback');
  const rejectedProofStart = dataRequests;
  const rejectedProof = await dataRequest('GET', undefined, dataUsers[0], { proof: 'fixture.rejected.signature' });
  assert.equal(rejectedProof.status, 401);
  assert.deepEqual(await rejectedProof.json(), { code: 'APP_DATA_SUBJECT_INVALID' });
  assert.equal(dataRequests, rejectedProofStart + 1, 'Core proof rejection is single-shot with no fallback');
  const readOnly = await (await listFor()).json();
  assert.equal(readOnly.dataMode, 'core'); assert.equal(readOnly.receiptDomain, 'core-app-data/v1');
  assert.equal(readOnly.canWrite, false);
  const beforeCoreWrite = insertAttempts;
  assert.equal((await post(input)).status, 403);
  assert.equal(insertAttempts, beforeCoreWrite, 'Core defaults to read-only');
  const ownID = items[0].id;
  const foreignID = items[1].id;
  const beforeReadonlyPatch = dataRequests;
  const readonlyPatch = await patchFor(ownID, patchBody({ amount: 101 }));
  assert.equal(readonlyPatch.status, 403); assert.deepEqual(await readonlyPatch.json(), { code: 'APP_DATA_READ_ONLY' });
  assert.equal(dataRequests, beforeReadonlyPatch, 'read-only PATCH never reaches Core');
  assert.equal((await detailFor(ownID)).status, 200);
  assert.equal((await detailFor(foreignID)).status, 404);
  assert.deepEqual(await (await detailFor('missing-record')).json(), { code: 'NOT_FOUND' });
  const detailAuthStart = dataRequests;
  assert.equal((await detailFor(ownID, dataUsers[0], { proof: null })).status, 401);
  assert.equal((await detailFor(ownID, dataUsers[0], { claims: { workspaceID: '2' } })).status, 401);
  assert.equal((await detailFor(ownID, dataUsers[0], { claims: { appID: '19c578a2-2027-41be-8517-bd8dc999ac2c' } })).status, 401);
  assert.equal(dataRequests, detailAuthStart);
  wrongContextApp = true;
  assert.equal((await detailFor(ownID)).status, 403, 'appcontext must match the verified App');
  wrongContextApp = false;
  const concurrentStart = dataExchanges.length;
  pendingContexts = [];
  const concurrent = await Promise.all(dataUsers.map(async (userID) => (await listFor(userID)).json()));
  for (let i = 0; i < dataUsers.length; i++) {
    assert.equal(concurrent[i].operator, dataUsers[i]); assert.equal(concurrent[i].items.length, 1);
  }
  const exchanges = dataExchanges.slice(concurrentStart);
  assert.equal(exchanges.length, 4);
  for (const proof of dataUsers.map((userID) => proofs.get(userID))) {
    assert.equal(exchanges.filter((exchange) => exchange.proof === proof).length, 2, 'context and find share only their request proof');
  }
  const supervisorList = await (await listFor(supervisorID)).json();
  assert.equal(supervisorList.items.length, items.length, 'Core all-scope supervisor is not blocked by App owner equality or static employee list');
  assert.ok(!JSON.stringify(supervisorList).includes('fixture-private-note-do-not-expose'));
  const privateDetail = await (await detailFor(ownID, supervisorID)).json();
  assert.equal(Object.hasOwn(privateDetail.item.data, 'privateNote'), false);
  readablePrivateNote = true;
  const allowedNonDisplay = await detailFor(ownID, supervisorID);
  assert.equal(allowedNonDisplay.status, 200, 'a readable non-display field is allowed in the raw Core result');
  assert.equal(Object.hasOwn((await allowedNonDisplay.json()).item.data, 'privateNote'), false, 'App view selects only its display fields after validating raw keys');
  assert.equal((await listFor(supervisorID)).status, 200);
  readablePrivateNote = false;
  hideOwner = true;
  assert.equal((await listFor()).status, 200, 'Core does not require a readable owner field');
  hideOwner = false;
  for (const field of ['amount', 'status', 'orderNo']) {
    hiddenDisplayFields = new Set([field]);
    const hidden = await (await detailFor(ownID, supervisorID)).json();
    assert.equal(Object.hasOwn(hidden.item.data, field), false, 'hidden field is not fabricated in the response');
    const hiddenList = await (await listFor(supervisorID)).json();
    assert.ok(hiddenList.items.every((item) => !Object.hasOwn(item.data, field)));
  }
  overReturnFields = true;
  for (const read of [() => detailFor(ownID, supervisorID), () => listFor(supervisorID)]) {
    const extraFields = await read();
    assert.equal(extraFields.status, 503, 'hidden keys in raw Core data are a policy violation, not silently filtered by App display');
    assert.deepEqual(await extraFields.json(), { code: 'APP_DATA_POLICY_UNAVAILABLE' });
  }
  overReturnFields = false;
  hiddenDisplayFields = new Set();
  for (const field of ['privateNote', 'amount', 'ownerUserId', 'constructor', 'toString', '__proto__']) {
    hiddenDisplayFields = new Set(field === 'amount' ? ['amount'] : []);
    injectedReadField = field;
    for (const read of [() => detailFor(ownID, supervisorID), () => listFor(supervisorID)]) {
      const violation = await read(); assert.equal(violation.status, 503);
      assert.deepEqual(await violation.json(), { code: 'APP_DATA_POLICY_UNAVAILABLE' }, 'Object.hasOwn rejects undeclared and inherited property names without leaking their values');
    }
  }
  injectedReadField = undefined;
  hiddenDisplayFields = new Set(['orderNo', 'amount', 'status']);
  const noFieldsStart = dataRequests;
  const noFields = await detailFor(ownID, supervisorID);
  assert.equal(noFields.status, 200); assert.deepEqual((await noFields.json()).item.data, {});
  assert.equal(dataRequests, noFieldsStart + 2, 'unprojected Core lookup may return a row with no readable business fields');
  hiddenDisplayFields = new Set();
  invalidPolicy = true;
  const missingSchema = await listFor(); assert.equal(missingSchema.status, 503);
  assert.deepEqual(await missingSchema.json(), { code: 'APP_DATA_POLICY_UNAVAILABLE' }, 'a raw field absent from context schema is never accepted');
  invalidPolicy = false;
  const coreControl = await fetch(host + devicePath, { headers: {
    [contract.header]: signedRequest('GET', ''), 'X-Tier0-App-Data-Subject': proofs.get(dataUsers[0]),
  } });
  assert.equal(coreControl.status, 200, 'Control remains independent of Core data delegation');
  const coreControlReplay = await fetch(host + devicePath, { method: 'POST', headers: {
    'Content-Type': 'application/json', [contract.header]: signedRequest('POST', JSON.stringify(intent)),
    'X-Tier0-App-Data-Subject': proofs.get(dataUsers[0]),
  }, body: JSON.stringify(intent) });
  assert.equal(coreControlReplay.status, 200);
  assert.deepEqual(await coreControlReplay.json(), { status: 'completed', replayed: true }, 'data-mode migration preserves the separate Control receipt');
  await startCore(true);
  assert.equal((await (await listFor()).json()).canWrite, true);
  const newIntent = { orderNo: 'core-new-order', amount: 200, receiptDomain: 'core-app-data/v1', idempotencyKey: `core-v1-${randomUUID()}` };
  const beforeIntentGate = dataRequests;
  for (const old of [input, { ...newIntent, idempotencyKey: input.idempotencyKey }, { ...newIntent, receiptDomain: 'legacy-app-data/v5' }]) {
    const response = await post(old); assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { code: 'NEW_DATA_INTENT_REQUIRED' });
  }
  assert.equal(dataRequests, beforeIntentGate, 'old intents are rejected before context or mutation');
  for (const field of ['ownerUserId', 'status', 'filter', 'collectionId']) {
    assert.equal((await post({ ...newIntent, [field]: 'forged' })).status, 400);
  }
  const beforeNew = dataExchanges.length;
  assert.deepEqual(await (await post(newIntent)).json(), { status: 'committed', replayed: false });
  assert.deepEqual(await (await post(newIntent)).json(), { status: 'committed', replayed: true });
  assert.equal(dataExchanges.length - beforeNew, 4);
  assert.ok(dataExchanges.slice(beforeNew).every((exchange) => exchange.proof === proofs.get(dataUsers[0])));
  const stamped = items.find((item) => item.data.orderNo === newIntent.orderNo);
  assert.equal(stamped.data.ownerUserId, dataUsers[0]); assert.equal(stamped.data.status, 'draft');
  const concurrentWriteStart = dataExchanges.length;
  pendingContexts = [];
  await Promise.all(dataUsers.map(async (userID, index) => {
    const response = await post({ ...newIntent, orderNo: `core-concurrent-${index}`, idempotencyKey: `core-v1-${randomUUID()}` }, userID);
    assert.equal(response.status, 200);
  }));
  const writes = dataExchanges.slice(concurrentWriteStart);
  assert.equal(writes.length, 4);
  for (const proof of dataUsers.map((userID) => proofs.get(userID))) assert.equal(writes.filter((exchange) => exchange.proof === proof).length, 2);
  assert.deepEqual(items.filter((item) => item.data.orderNo.startsWith('core-concurrent-')).map((item) => item.data.ownerUserId).sort(), [...dataUsers].sort());
  const invalidPatchStart = dataRequests;
  const basePatch = patchBody({ amount: 101 });
  for (const field of ['workspaceId', 'workspaceID', 'collectionId', 'ownerUserId', 'userID', 'filter', 'update', 'upsert', 'returnDocument', 'bindings', 'role']) {
    assert.equal((await patchFor(ownID, { ...basePatch, [field]: 'untrusted' })).status, 400);
  }
  for (const changes of [{}, [], null, { ownerUserId: '2' }, { $set: { amount: 1 } }, { 'amount.x': 1 },
    { amount: -1 }, { amount: 1.5 }, { amount: '1' }, { status: {} }, { status: 'a\n' }, JSON.parse('{"__proto__":{"amount":1}}')]) {
    assert.equal((await patchFor(ownID, { ...basePatch, changes })).status, 400);
  }
  for (const expectedRevision of [undefined, 1, '0', '-1', '1.5', '01', '9223372036854775808']) {
    assert.equal((await patchFor(ownID, { ...basePatch, expectedRevision })).status, 400);
  }
  for (const extra of [{ receiptDomain: 'core-app-data/v1' }, { idempotencyKey: newIntent.idempotencyKey }, { idempotencyKey: input.idempotencyKey }]) {
    assert.equal((await patchFor(ownID, { ...basePatch, ...extra })).status, 409);
  }
  assert.equal((await patchFor(ownID, basePatch, dataUsers[0], { proof: null })).status, 401);
  assert.equal((await patchFor(ownID, basePatch, dataUsers[0], { assertion: signedRequest('PATCH', '{}', {}, `${dataPath}/${encodeURIComponent(ownID)}`) })).status, 401);
  for (const uri of [`${dataPath}/${encodeURIComponent(ownID)}?ownerUserId=2`, `${dataPath}/a%2Fb`, `${dataPath}/a/b`]) {
    assert.equal((await patchFor(ownID, basePatch, dataUsers[0], { uri })).status, 400);
  }
  assert.equal(dataRequests, invalidPatchStart, 'malformed PATCH cannot reach a workspace, collection or operator selected by body');
  const beforeForeign = JSON.stringify(items);
  assert.equal((await patchFor(foreignID, basePatch)).status, 404);
  assert.equal((await patchFor('missing-record', basePatch)).status, 404);
  assert.equal(JSON.stringify(items), beforeForeign);
  const mutationStart = dataExchanges.length;
  const edited = await patchFor(ownID, basePatch); assert.equal(edited.status, 200);
  assert.deepEqual(await edited.json(), { status: 'committed', replayed: false, matchedCount: '1', modifiedCount: '1', requestId: 'fixture-update' });
  assert.equal(items[0].data.amount, 101); assert.equal(items[0].revision, 2);
  assert.equal(dataExchanges.length - mutationStart, 2, 'PATCH does context + update only, never a read/merge');
  assert.ok(dataExchanges.slice(mutationStart).every((exchange) => exchange.proof === proofs.get(dataUsers[0])));
  assert.equal((await (await patchFor(ownID, basePatch)).json()).replayed, true);
  const conflict = await patchFor(ownID, { ...basePatch, changes: { amount: 102 } });
  assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(items[0].revision, 2);
  assert.equal((await patchFor(ownID, patchBody({ amount: 102 }, '1'))).status, 409);
  assert.equal((await patchFor(ownID, patchBody({ amount: 102 }, '9007199254740993'))).status, 409);
  assert.equal(lastPatchRevision, '9007199254740993', 'revision is not rounded at the SDK boundary');
  assert.equal((await patchFor(ownID, patchBody({ amount: 102 }, '9223372036854775807'))).status, 409);
  assert.equal(lastPatchRevision, '9223372036854775807');
  assert.equal((await patchFor(ownID, patchBody({ status: 'approved' }, '2'))).status, 403, 'employee cannot skip the Core transition rule');
  assert.equal((await patchFor(ownID, patchBody({ status: 'submitted' }, '2'))).status, 200);
  assert.equal(items[0].data.status, 'submitted');
  const beforeSupervisorAmount = JSON.stringify(items[0]);
  const forbiddenAmount = await patchFor(ownID, patchBody({ amount: 999 }, '3'), supervisorID);
  assert.equal(forbiddenAmount.status, 403); assert.deepEqual(await forbiddenAmount.json(), { code: 'FIELD_FORBIDDEN' });
  assert.equal(JSON.stringify(items[0]), beforeSupervisorAmount);
  hiddenDisplayFields = new Set(['amount']);
  const approve = patchBody({ status: 'approved' }, '3');
  const beforeApprove = dataExchanges.length;
  assert.equal((await patchFor(ownID, approve, supervisorID)).status, 200, 'Core authorizes supervisor approval with amount/owner hidden');
  assert.deepEqual(dataExchanges.at(-1).body.update, { $set: { status: 'approved' } });
  assert.equal(dataExchanges.length - beforeApprove, 2);
  assert.equal(items[0].data.amount, 101); assert.equal(items[0].data.status, 'approved');
  assert.equal((await (await patchFor(ownID, approve, supervisorID)).json()).replayed, true);
  assert.equal((await patchFor(ownID, patchBody({ status: 'draft' }, '4'), supervisorID)).status, 403);
  assert.equal((await patchFor(ownID, patchBody({ amount: 1 }, '4'))).status, 403);
  hiddenDisplayFields = new Set();
  const isolatedPatchStart = dataExchanges.length;
  pendingContexts = [];
  await Promise.all(dataUsers.map(async (userID, index) => {
    const row = items.find((item) => item.data.orderNo === `core-concurrent-${index}`);
    assert.equal((await patchFor(row.id, patchBody({ amount: 300 + index }), userID)).status, 200);
  }));
  const isolatedPatches = dataExchanges.slice(isolatedPatchStart);
  assert.equal(isolatedPatches.length, 4);
  for (const userID of dataUsers) assert.equal(isolatedPatches.filter((exchange) => exchange.proof === proofs.get(userID)).length, 2);
  for (const patchMode of ['patch-unknown', 'patch-redirect']) {
    mode = patchMode;
    const beforeUncertainPatch = patchAttempts;
    const uncertain = await patchFor(ownID, patchBody({ status: 'rejected' }, '4'), supervisorID);
    assert.equal(uncertain.status, 504); assert.deepEqual(await uncertain.json(), { code: 'OUTCOME_UNKNOWN' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(patchAttempts, beforeUncertainPatch + 1, 'uncertain PATCH is never retried or redirected');
  }
  mode = 'revoked';
  const beforeRevoked = dataExchanges.length;
  assert.equal((await listFor()).status, 403);
  assert.equal(dataExchanges.length - beforeRevoked, 1, 'Core refusal does not trigger legacy retry');
  mode = 'unknown';
  const beforeCoreUnknown = insertAttempts;
  const coreUnknown = await post({ ...newIntent, orderNo: 'core-unknown', idempotencyKey: `core-v1-${randomUUID()}` });
  assert.equal(coreUnknown.status, 504); assert.deepEqual(await coreUnknown.json(), { code: 'OUTCOME_UNKNOWN' });
  assert.equal(insertAttempts, beforeCoreUnknown + 1);
  const beforeInvalidConfig = dataRequests;
  const invalidIdentity = spawn(process.execPath, ['.runtime/server.mjs'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, PORT: '0', CLOUD_APP_DATA_MODE: 'core', CLOUD_APP_CORE_WRITE_ENABLED: undefined,
    CLOUD_APP_ID: '', CLOUD_WORKSPACE_ID: '', CLOUD_APP_IDENTITY_PUBLIC_KEYS: '', CLOUD_DATA_USER_IDS: '',
    CLOUD_CONTROL_USER_IDS: '', CLOUD_CONTROL_CODE: '',
  } });
  let configOutput = '';
  invalidIdentity.stderr.on('data', (value) => { configOutput += value; });
  const timer = setTimeout(() => invalidIdentity.kill('SIGTERM'), 3000);
  const [invalidExit] = await once(invalidIdentity, 'exit'); clearTimeout(timer);
  assert.equal(invalidExit, 1, 'Core cannot start without a pinned verifier even with no employee allowlist');
  assert.ok(configOutput.includes('APP_IDENTITY_CONFIGURATION_INVALID'));
  assert.equal(dataRequests, beforeInvalidConfig);
  for (const proof of proofs.values()) {
    assert.ok(!childOutput.includes(proof));
    assert.ok(!JSON.stringify([...intents, ...items, ...patchReceipts]).includes(proof), 'proofs never enter records or receipts');
    assert.ok(!JSON.stringify(concurrent).includes(proof), 'proofs never enter browser responses');
  }
  console.log('PASS: Core request-scoped proof wiring, identity-first rejection, duplicate/missing proof, no owner filter, default read-only, explicit new-intent gate, service-stamp payload, isolated Control and no fallback/retry (local fixture, NOT Core acceptance)');
  console.log('PASS: Core-only detail/PATCH, no client projection, raw-key schema validation, hidden-field violations rejected, supervisor target access, bounded changes, exact revision, distinct intents, conflict/replay and no read/merge (local fixture, NOT real policy/audit acceptance)');
  console.log('PASS: legacy verified employee data identity, exact request binding, mandatory owner filter, protected fields, per-user record/intent identities, cross-user isolation and fail-closed policy');
  console.log('PASS: App server Ed25519 validation, operator allowlist, strict control input, dedicated Key, stable business replay, revocation, redaction, unknown outcome once and no data-Key fallback');
  console.log('PASS: offline package/public SDK import, page, strict input, write/read/replay, read-only, revocation, redaction, unknown outcome without retry');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
