import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createClient } from '@tier0/sdk/cloud';
import { createHash } from 'node:crypto';
import { createCloudAppRequestVerifier, APP_REQUEST_IDENTITY_HEADER } from '@tier0/sdk/cloud/server';

// Explicit deployment migration: legacy preserves v5 receipts and App-side filtering.
// Core never falls back to legacy. Enable writes only after reconciling old receipts
// and provisioning cloud-app-data-rule/v1: ownerField=ownerUserId, stateField=status,
// initialState=draft, own rows, writeFields=[orderNo,amount], and readFields including
// orderNo, amount, status AND ownerUserId. Schema alone does not grant field access.
const dataMode = process.env.CLOUD_APP_DATA_MODE ?? 'legacy';
const coreWrite = process.env.CLOUD_APP_CORE_WRITE_ENABLED ?? 'false';
if (!['legacy', 'core'].includes(dataMode) || !['true', 'false'].includes(coreWrite) ||
    (dataMode !== 'core' && coreWrite === 'true')) throw new Error('APP_DATA_CONFIGURATION_INVALID');
const receiptDomain = dataMode === 'core' ? 'core-app-data/v1' : 'legacy-app-data/v5';
const coreWritesEnabled = dataMode === 'core' && coreWrite === 'true';
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/order-intent.mjs', ['order-intent.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function ordersContext(client, permission, subject) {
  const response = await client.unsV2.dataAppContext({});
  const grant = response.data.collections.find((item) => item.alias === 'orders');
  if (response.data.appId !== subject.appID || !grant || !grant.permissions.includes(permission)) throw Object.assign(new Error(), { status: 403, code: 'FORBIDDEN' });
  if (grant.recordSchema?.properties?.ownerUserId?.type !== 'string' ||
      !grant.recordSchema.required?.includes('ownerUserId')) {
    throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_POLICY_UNAVAILABLE' });
  }
  return { response, grant };
}

function orderInput(req, raw) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some((key) => !['orderNo', 'amount', 'idempotencyKey', ...(dataMode === 'core' ? ['receiptDomain'] : [])].includes(key)) ||
      typeof value.orderNo !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.orderNo) ||
      !Number.isSafeInteger(value.amount) || value.amount < 0 ||
      typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.idempotencyKey)) {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  // Old browsers/intents cannot enter a new receipt domain by changing a hash or
  // silently minting a random key. Core UI requires an explicit new-intent action.
  if (dataMode === 'core' && (value.receiptDomain !== receiptDomain ||
      !/^core-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.idempotencyKey))) {
    throw Object.assign(new Error(), { status: 409, code: 'NEW_DATA_INTENT_REQUIRED' });
  }
  return value;
}

// Identity and user grants are pinned by the App operator, never browser input.
const identityFields = ['CLOUD_APP_ID', 'CLOUD_WORKSPACE_ID', 'CLOUD_APP_IDENTITY_PUBLIC_KEYS'];
let verifyIdentity;
if (identityFields.some((key) => process.env[key])) {
  if (identityFields.some((key) => !process.env[key])) throw new Error('APP_IDENTITY_CONFIGURATION_INVALID');
  verifyIdentity = createCloudAppRequestVerifier({ appID: process.env.CLOUD_APP_ID,
    workspaceID: process.env.CLOUD_WORKSPACE_ID, publicKeys: process.env.CLOUD_APP_IDENTITY_PUBLIC_KEYS });
}
function userGrant(name) {
  if (!process.env[name]) return undefined;
  const users = process.env[name].split(',');
  if (!verifyIdentity || !users.length || users.some((id) => !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) ||
      new Set(users).size !== users.length) throw new Error('APP_IDENTITY_CONFIGURATION_INVALID');
  return new Set(users);
}
const dataUsers = userGrant('CLOUD_DATA_USER_IDS');
if (dataMode === 'core' && !dataUsers) throw new Error('APP_DATA_CONFIGURATION_INVALID');
let controlAuthority;
if (process.env.CLOUD_CONTROL_USER_IDS || process.env.CLOUD_CONTROL_CODE) {
  const users = userGrant('CLOUD_CONTROL_USER_IDS');
  if (!users || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(process.env.CLOUD_CONTROL_CODE || '')) {
    throw new Error('CONTROL_CONFIGURATION_INVALID');
  }
  controlAuthority = { users, code: process.env.CLOUD_CONTROL_CODE, verify: verifyIdentity };
}
async function orderSubject(req) {
  if (!dataUsers) throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_UNAVAILABLE' });
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 65536) throw Object.assign(new Error(), { status: 413, code: 'INVALID_INPUT' });
    parts.push(part);
  }
  const raw = Buffer.concat(parts);
  let subject;
  try {
    subject = verifyIdentity({ assertion: req.headers[APP_REQUEST_IDENTITY_HEADER.toLowerCase()],
      method: req.method, requestURI: req.url, body: raw });
  } catch { throw Object.assign(new Error(), { status: 401, code: 'APP_IDENTITY_INVALID' }); }
  if (!dataUsers.has(subject.userID)) throw Object.assign(new Error(), { status: 403, code: 'APP_DATA_FORBIDDEN' });
  if (req.url !== '/api/orders' || (req.method === 'GET' && raw.length)) {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  return { subject, raw };
}
function orderClient(req) {
  if (dataMode === 'legacy') return createClient({ transportTimeoutMs: 15000 });
  // Read only after runtime identity verification. The deployment must admit only
  // the trusted App Gateway, which strips caller headers and issues this proof
  // (tier0.app-data-subject/v1, aud=tier0-uns-data). Runtime assertion has another
  // audience: never copy it here. Core verifies proof claims; this App never does.
  const header = 'x-tier0-app-data-subject';
  const count = req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === header).length;
  if (count === 0) throw Object.assign(new Error(), { status: 401, code: 'APP_DATA_SUBJECT_REQUIRED' });
  if (count !== 1 || typeof req.headers[header] !== 'string') {
    throw Object.assign(new Error(), { status: 401, code: 'APP_DATA_SUBJECT_INVALID' });
  }
  try {
    // Immutable proof snapshot, used by context/find/insert in this request only.
    return createClient({ transportTimeoutMs: 15000, unsV2AppDataSubject: req.headers[header] });
  } catch { throw Object.assign(new Error(), { status: 401, code: 'APP_DATA_SUBJECT_INVALID' }); }
}
const orderIdentity = (kind, subject, intent) => kind + ':' + createHash('sha256')
  .update(JSON.stringify([subject.appID, subject.workspaceID, subject.userID, intent])).digest('hex');

async function deviceControl(req) {
  if (!controlAuthority || !process.env.TIER0_CONTROL_API_KEY?.trim()) {
    throw Object.assign(new Error(), { status: 503, code: 'CONTROL_UNAVAILABLE' });
  }
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 65536) throw Object.assign(new Error(), { status: 413, code: 'INVALID_INPUT' });
    parts.push(part);
  }
  const raw = Buffer.concat(parts);
  let subject;
  try {
    subject = controlAuthority.verify({ assertion: req.headers[APP_REQUEST_IDENTITY_HEADER.toLowerCase()],
      method: req.method, requestURI: req.url, body: raw });
  } catch { throw Object.assign(new Error(), { status: 401, code: 'APP_IDENTITY_INVALID' }); }
  if (!controlAuthority.users.has(subject.userID)) {
    throw Object.assign(new Error(), { status: 403, code: 'CONTROL_FORBIDDEN' });
  }
  // An absent control credential must never fall back to the default data Key.
  const control = createClient({ apiKey: process.env.TIER0_CONTROL_API_KEY, transportTimeoutMs: 15000 })
    .controls.use({ code: controlAuthority.code });
  if (req.method === 'GET') {
    if (raw.length) throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
    const definition = await control.describe();
    return { code: definition.code, name: definition.name, operator: subject.userID, canInvoke: definition.status === 'active' };
  }
  let input;
  try { input = JSON.parse(raw.toString('utf8')); } catch { /* Rejected below. */ }
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json' || !input ||
      Array.isArray(input) || Object.keys(input).length !== 1 ||
      typeof input.intentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.intentId)) {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  const digest = createHash('sha256').update(JSON.stringify([subject.appID, subject.workspaceID, subject.userID, input.intentId])).digest('hex');
  const result = await control.invoke({}, { idempotencyKey: `app-control:${digest}` });
  return { status: result.status, replayed: result.replayed };
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path = new URL(req.url, 'http://app.invalid').pathname;
    if (req.method === 'GET' && path === '/healthz') return reply(res, 200, { status: 'ready' });
    if (req.method === 'GET' && staticFiles.has(path)) {
      const [name, type] = staticFiles.get(path);
      const content = await readFile(new URL(`./public/${name}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(content);
    }
    if (['GET', 'POST'].includes(req.method) && path === '/api/device/telemetry') {
      return reply(res, 200, await deviceControl(req));
    }
    if (req.method === 'GET' && path === '/api/orders') {
      const { subject } = await orderSubject(req);
      const client = orderClient(req);
      const { response, grant } = await ordersContext(client, 'record:read', subject);
      const records = await client.unsV2.recordFind({ collectionId: grant.collectionId,
        // Core must enforce row scope itself; a successful App filter is no proof
        // of Core enforcement. Keep the result owner check as a separate guard.
        ...(dataMode === 'legacy' ? { filter: { ownerUserId: { $eq: subject.userID } } } : {}),
        projection: { orderNo: 1, amount: 1, status: 1, ownerUserId: 1 }, limit: 20 });
      if (records.data.items.some((item) => item.data.ownerUserId !== subject.userID)) {
        throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_POLICY_UNAVAILABLE' });
      }
      return reply(res, 200, {
        app: response.data.name, operator: subject.userID,
        policyRevision: response.data.revision,
        dataMode, receiptDomain,
        canWrite: grant.permissions.includes('record:write') && (dataMode === 'legacy' || coreWritesEnabled),
        items: records.data.items.map((item) => ({ id: item.id, revision: item.revision, data: {
          orderNo: item.data.orderNo, amount: item.data.amount, status: item.data.status,
        } })),
      });
    }
    if (req.method === 'POST' && path === '/api/orders') {
      const { subject, raw } = await orderSubject(req);
      const client = orderClient(req);
      if (dataMode === 'core' && !coreWritesEnabled) {
        throw Object.assign(new Error(), { status: 403, code: 'APP_DATA_READ_ONLY' });
      }
      const input = orderInput(req, raw);
      const { grant } = await ordersContext(client, 'record:write', subject);
      const result = await client.unsV2.recordInsertOne({
        collectionId: grant.collectionId, id: orderIdentity('app-order', subject, input.orderNo),
        idempotencyKey: orderIdentity(dataMode === 'core' ? 'app-order-intent-core-v1' : 'app-order-intent', subject, input.idempotencyKey),
        data: { orderNo: input.orderNo, amount: input.amount,
          ...(dataMode === 'legacy' ? { status: 'draft', ownerUserId: subject.userID } : {}) },
      });
      return reply(res, 200, { status: result.data.status, replayed: result.data.replayed });
    }
    reply(res, 404, { code: 'NOT_FOUND' });
  } catch (error) {
    const unknown = error.outcomeUnknown === true;
    const status = unknown ? 504 : [400, 401, 403, 409, 413, 422, 429, 502, 503, 504].includes(error.status) ? error.status : 503;
    const code = unknown ? 'OUTCOME_UNKNOWN' : /^[A-Z_0-9]{1,80}$/.test(error.errorCode ?? error.code ?? '') ? (error.errorCode ?? error.code) : 'UNAVAILABLE';
    if (!res.headersSent) reply(res, status, { code });
    else res.destroy();
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
