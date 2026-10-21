import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createClient, UnsV2RawNumber } from '@tier0/sdk/cloud';
import { createHash } from 'node:crypto';
import { createCloudAppRequestVerifier, APP_REQUEST_IDENTITY_HEADER } from '@tier0/sdk/cloud/server';
import { orderCreateHint } from './public/order-create-capability.mjs';

// Explicit deployment migration: legacy preserves v5 receipts and App-side filtering.
// Core never falls back to legacy. Enable writes only after reconciling old receipts
// and provisioning cloud-app-data-rule/v1: ownerField=ownerUserId, stateField=status,
// initialState=draft. Core rules own row/field/state permissions, including supervisor
// access; this server neither infers roles nor requires hidden owner fields to read.
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
  if (dataMode === 'legacy' && (grant.recordSchema?.properties?.ownerUserId?.type !== 'string' ||
      !grant.recordSchema.required?.includes('ownerUserId'))) {
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

const patchReceiptDomain = 'core-order-patch/v1';
// PATCH accepts {changes:{amount?,status?}, expectedRevision:"<positive int64>",
// idempotencyKey:"core-patch-v1-<UUID>", receiptDomain:"core-order-patch/v1"}.
// This is syntax validation, never a local role/field/state permission decision.
function patchInput(req, raw) {
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch { /* Rejected below. */ }
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json' ||
      !value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some((key) => !['changes', 'expectedRevision', 'idempotencyKey', 'receiptDomain'].includes(key)) ||
      !value.changes || Array.isArray(value.changes) || typeof value.changes !== 'object' ||
      !Object.keys(value.changes).length || Object.keys(value.changes).some((key) => !['amount', 'status'].includes(key)) ||
      (Object.hasOwn(value.changes, 'amount') && (!Number.isSafeInteger(value.changes.amount) || value.changes.amount < 0)) ||
      (Object.hasOwn(value.changes, 'status') && (typeof value.changes.status !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.changes.status))) ||
      typeof value.expectedRevision !== 'string' || !/^[1-9]\d{0,18}$/.test(value.expectedRevision) ||
      BigInt(value.expectedRevision) > 9223372036854775807n) {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  if (value.receiptDomain !== patchReceiptDomain || typeof value.idempotencyKey !== 'string' ||
      !/^core-patch-v1-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.idempotencyKey)) {
    throw Object.assign(new Error(), { status: 409, code: 'NEW_DATA_INTENT_REQUIRED' });
  }
  return value;
}

function orderView(item) {
  // Missing fields stay absent: do not turn a hidden amount/status/owner into a
  // fabricated value, or read/merge them into a later update or binding.
  return { id: item.id, revision: typeof item.revision === 'bigint' || item.revision instanceof UnsV2RawNumber ? item.revision.toString() : item.revision,
    data: Object.fromEntries(['orderNo', 'amount', 'status'].filter((key) => Object.hasOwn(item.data, key))
      .map((key) => [key, item.data[key]])) };
}

function checkCoreReadFields(items, grant) {
  // Query without client projection so App filtering cannot mask a Core policy
  // failure. Check every raw data key, including fields this App never displays.
  const properties = grant.recordSchema?.properties ?? {};
  if (typeof properties !== 'object' || Array.isArray(properties) || items.some((item) =>
    !item || !item.data || typeof item.data !== 'object' || Array.isArray(item.data) ||
    Object.keys(item.data).some((key) => !Object.hasOwn(properties, key)))) {
    throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_POLICY_UNAVAILABLE' });
  }
}

const auditPolicyError = () => Object.assign(new Error(), { status: 503, code: 'APP_DATA_POLICY_UNAVAILABLE' });
function auditInteger(value) {
  const text = value instanceof UnsV2RawNumber || typeof value === 'bigint' ? value.toString()
    : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  if (!/^(0|[1-9]\d{0,18})$/.test(text) || BigInt(text) > 9223372036854775807n) throw auditPolicyError();
  return text;
}
function historyPage(data, grant, recordId, size) {
  if (!data || !Array.isArray(data.items) || data.items.length > size || typeof data.nextCursor !== 'string' ||
      data.nextCursor.length > 4096 || !/^[A-Za-z0-9_.-]*$/.test(data.nextCursor)) throw auditPolicyError();
  const seen = new Set();
  const items = data.items.map((event) => {
    if (!event || event.collectionId !== grant.collectionId || event.recordId !== recordId ||
        typeof event.eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(event.eventId) || seen.has(event.eventId) ||
        !['create', 'update', 'delete', 'restore'].includes(event.action) ||
        typeof event.beforeDeleted !== 'boolean' || typeof event.afterDeleted !== 'boolean' ||
        !Array.isArray(event.changedFields) || new Set(event.changedFields).size !== event.changedFields.length) throw auditPolicyError();
    seen.add(event.eventId);
    // Validate raw snapshots and field names before selecting App display fields.
    // Never conceal a Core disclosure failure by silently stripping hidden fields.
    checkCoreReadFields([event.before, event.after].filter((value) => value !== null).map((value) => ({ data: value })), grant);
    const properties = grant.recordSchema?.properties ?? {};
    if (event.changedFields.some((key) => typeof key !== 'string' || !Object.hasOwn(properties, key))) throw auditPolicyError();
    const revisionBefore = auditInteger(event.revisionBefore), revisionAfter = auditInteger(event.revisionAfter);
    if (BigInt(revisionAfter) !== BigInt(revisionBefore) + 1n) throw auditPolicyError();
    const actor = event.actor;
    if (!actor || !['user', 'app_employee', 'app', 'service', 'personal_key'].includes(actor.kind)) throw auditPolicyError();
    const human = ['user', 'app_employee'].includes(actor.kind);
    if (human && (typeof actor.userId !== 'string' || !/^[1-9]\d{0,18}$/.test(actor.userId) ||
        BigInt(actor.userId) > 9223372036854775807n)) throw auditPolicyError();
    const snapshot = (value) => value === null ? null : Object.fromEntries(Object.entries(orderView({ data: value }).data)
      .map(([key, entry]) => [key, entry instanceof UnsV2RawNumber ? entry.toString() : entry]));
    return { eventId: event.eventId, action: event.action, revisionBefore, revisionAfter, createdAt: auditInteger(event.createdAt),
      before: snapshot(event.before), after: snapshot(event.after), beforeDeleted: event.beforeDeleted, afterDeleted: event.afterDeleted,
      changedFields: event.changedFields.filter((key) => ['orderNo', 'amount', 'status'].includes(key)),
      // Employee attribution is actor.userId, never the App Key owner. Key IDs and
      // raw credentials are not part of the browser history view.
      actor: { kind: actor.kind, ...(human ? { userId: actor.userId } : {}) } };
  });
  return { items, nextCursor: data.nextCursor };
}

// Identity and legacy user grants are pinned by the App operator, never browser
// input. Core principals and business permissions are managed by Core data rules.
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
const dataUsers = dataMode === 'legacy' ? userGrant('CLOUD_DATA_USER_IDS') : undefined;
if (dataMode === 'core' && !verifyIdentity) throw new Error('APP_IDENTITY_CONFIGURATION_INVALID');
let controlAuthority;
if (process.env.CLOUD_CONTROL_USER_IDS || process.env.CLOUD_CONTROL_CODE) {
  const users = userGrant('CLOUD_CONTROL_USER_IDS');
  if (!users || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(process.env.CLOUD_CONTROL_CODE || '')) {
    throw new Error('CONTROL_CONFIGURATION_INVALID');
  }
  controlAuthority = { users, code: process.env.CLOUD_CONTROL_CODE, verify: verifyIdentity };
}
async function orderSubject(req, requestPath = '/api/orders') {
  if (dataMode === 'legacy' && !dataUsers) throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_UNAVAILABLE' });
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
  if (dataMode === 'legacy' && !dataUsers.has(subject.userID)) throw Object.assign(new Error(), { status: 403, code: 'APP_DATA_FORBIDDEN' });
  if (req.url !== requestPath || (req.method === 'GET' && raw.length)) {
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
    const historyPath = path.match(/^\/api\/orders\/([^/]+)\/history$/);
    if (dataMode === 'core' && req.method === 'GET' && historyPath) {
      // Verify the exact signed URI including its query before parsing parameters.
      const { subject } = await orderSubject(req, req.url);
      const client = orderClient(req);
      const url = new URL(req.url, 'http://app.invalid');
      let recordId;
      try { recordId = decodeURIComponent(historyPath[1]); } catch { /* Rejected below. */ }
      const params = [...url.searchParams.keys()];
      const sizeText = url.searchParams.get('size') ?? '20', cursor = url.searchParams.get('cursor');
      if (req.url !== url.pathname + url.search || typeof recordId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(recordId) ||
          params.some((key) => !['size', 'cursor'].includes(key)) || new Set(params).size !== params.length ||
          !/^[1-9]\d{0,2}$/.test(sizeText) || Number(sizeText) > 100 ||
          (cursor !== null && (!cursor.length || cursor.length > 4096 || !/^[A-Za-z0-9_.-]+$/.test(cursor)))) {
        throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
      }
      const { grant } = await ordersContext(client, 'record:read', subject);
      // Ordinary history only. Core checks current/historical row scope and
      // historyRead on every page, including deleted records and policy changes.
      const result = await client.unsV2.recordAuditList({ collectionId: grant.collectionId, recordId,
        size: Number(sizeText), ...(cursor === null ? {} : { cursor }) });
      return reply(res, 200, { operator: subject.userID, recordId, ...historyPage(result.data, grant, recordId, Number(sizeText)) });
    }
    if (dataMode === 'core' && ['GET', 'PATCH'].includes(req.method) && path.startsWith('/api/orders/')) {
      const { subject, raw } = await orderSubject(req, path);
      const client = orderClient(req);
      let id;
      try { id = decodeURIComponent(path.slice('/api/orders/'.length)); } catch { /* Rejected below. */ }
      if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(id)) {
        throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
      }
      if (req.method === 'GET') {
        const { grant } = await ordersContext(client, 'record:read', subject);
        const records = await client.unsV2.recordFind({ collectionId: grant.collectionId,
          filter: { _id: { $eq: id } }, limit: 1 });
        checkCoreReadFields(records.data.items, grant);
        const item = records.data.items[0];
        if (!item) return reply(res, 404, { code: 'NOT_FOUND' });
        if (records.data.items.length !== 1 || item.id !== id) {
          throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_POLICY_UNAVAILABLE' });
        }
        return reply(res, 200, { item: orderView(item), receiptDomain: patchReceiptDomain,
          canWrite: coreWritesEnabled && grant.permissions.includes('record:write') });
      }
      if (!coreWritesEnabled) throw Object.assign(new Error(), { status: 403, code: 'APP_DATA_READ_ONLY' });
      const input = patchInput(req, raw);
      const { grant } = await ordersContext(client, 'record:write', subject);
      // Bind the intent to actor + target, never to a fetched/merged row or the
      // payload hash: Core must detect conflicting reuse of the same intent.
      const result = await client.unsV2.recordUpdateOne({ collectionId: grant.collectionId,
        filter: { _id: { $eq: id } }, expectedRevision: new UnsV2RawNumber(input.expectedRevision),
        update: { $set: input.changes }, upsert: false, dryRun: false,
        idempotencyKey: orderIdentity('app-order-patch-v1', subject, JSON.stringify([id, input.idempotencyKey])) });
      if (result.data.matchedCount === 0 || result.data.matchedCount === 0n) return reply(res, 404, { code: 'NOT_FOUND' });
      return reply(res, 200, { status: result.data.status, replayed: result.data.replayed,
        matchedCount: String(result.data.matchedCount), modifiedCount: String(result.data.modifiedCount), requestId: result.requestId });
    }
    if (req.method === 'GET' && path === '/api/orders') {
      const { subject } = await orderSubject(req);
      const client = orderClient(req);
      const { response, grant } = await ordersContext(client, 'record:read', subject);
      const records = await client.unsV2.recordFind({ collectionId: grant.collectionId,
        // Core alone decides own/all scope and field visibility. Legacy retains
        // its owner filter and result guard; neither can represent supervisor rules.
        ...(dataMode === 'legacy' ? { filter: { ownerUserId: { $eq: subject.userID } } } : {}),
        ...(dataMode === 'legacy' ? { projection: { orderNo: 1, amount: 1, status: 1, ownerUserId: 1 } } : {}), limit: 20 });
      if (dataMode === 'core') checkCoreReadFields(records.data.items, grant);
      if (dataMode === 'legacy' && records.data.items.some((item) => item.data.ownerUserId !== subject.userID)) {
        throw Object.assign(new Error(), { status: 503, code: 'APP_DATA_POLICY_UNAVAILABLE' });
      }
      const createState = dataMode === 'core' ? (coreWritesEnabled
        ? orderCreateHint(grant.createCapability, response.data.revision) : 'readonly') : undefined;
      return reply(res, 200, {
        app: response.data.name, operator: subject.userID,
        policyRevision: response.data.revision,
        dataMode, receiptDomain,
        canWrite: grant.permissions.includes('record:write') && (dataMode === 'legacy' || coreWritesEnabled),
        ...(dataMode === 'core' ? { canCreate: createState === 'createAllowed', createState } : {}),
        items: records.data.items.map(orderView),
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
      // UI capabilities/bindings are not credentials. No cached hint or browser
      // binding is accepted here: Core reauthorizes actual input and replay now.
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
    const status = unknown ? 504 : [400, 401, 403, 404, 409, 413, 422, 429, 502, 503, 504].includes(error.status) ? error.status : 503;
    const code = unknown ? 'OUTCOME_UNKNOWN' : /^[A-Z_0-9]{1,80}$/.test(error.errorCode ?? error.code ?? '') ? (error.errorCode ?? error.code) : 'UNAVAILABLE';
    if (!res.headersSent) reply(res, status, { code });
    else res.destroy();
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
