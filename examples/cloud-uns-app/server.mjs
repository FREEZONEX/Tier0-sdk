import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createClient } from '@tier0/sdk/cloud';
import { createHash } from 'node:crypto';
import { createCloudAppRequestVerifier, APP_REQUEST_IDENTITY_HEADER } from '@tier0/sdk/cloud/server';

const client = createClient({ transportTimeoutMs: 15000 });
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function ordersContext(permission) {
  const response = await client.unsV2.dataAppContext({});
  const grant = response.data.collections.find((item) => item.alias === 'orders');
  if (!grant || !grant.permissions.includes(permission)) throw Object.assign(new Error(), { status: 403, code: 'FORBIDDEN' });
  return { response, grant };
}

async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(new Error(), { status: 413, code: 'INVALID_INPUT' });
    parts.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some((key) => !['orderNo', 'amount', 'idempotencyKey'].includes(key)) ||
      typeof value.orderNo !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.orderNo) ||
      !Number.isSafeInteger(value.amount) || value.amount < 0 ||
      typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.idempotencyKey)) {
    throw Object.assign(new Error(), { status: 400, code: 'INVALID_INPUT' });
  }
  return value;
}

// Control authority is pinned by the App operator, never by browser input.
const identityFields = ['CLOUD_APP_ID', 'CLOUD_WORKSPACE_ID', 'CLOUD_APP_IDENTITY_PUBLIC_KEYS', 'CLOUD_CONTROL_USER_IDS', 'CLOUD_CONTROL_CODE'];
let controlAuthority;
if (identityFields.some((key) => process.env[key])) {
  if (identityFields.some((key) => !process.env[key])) throw new Error('CONTROL_CONFIGURATION_INVALID');
  const users = process.env.CLOUD_CONTROL_USER_IDS.split(',');
  if (!users.length || users.some((id) => !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) ||
      new Set(users).size !== users.length || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(process.env.CLOUD_CONTROL_CODE)) {
    throw new Error('CONTROL_CONFIGURATION_INVALID');
  }
  controlAuthority = {
    users: new Set(users), code: process.env.CLOUD_CONTROL_CODE,
    verify: createCloudAppRequestVerifier({ appID: process.env.CLOUD_APP_ID,
      workspaceID: process.env.CLOUD_WORKSPACE_ID, publicKeys: process.env.CLOUD_APP_IDENTITY_PUBLIC_KEYS }),
  };
}

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
      const { response, grant } = await ordersContext('record:read');
      const records = await client.unsV2.recordFind({ collectionId: grant.collectionId, limit: 20 });
      return reply(res, 200, {
        app: response.data.name,
        policyRevision: response.data.revision,
        canWrite: grant.permissions.includes('record:write'),
        items: records.data.items.map((item) => ({ id: item.id, revision: item.revision, data: {
          orderNo: item.data.orderNo, amount: item.data.amount, status: item.data.status,
        } })),
      });
    }
    if (req.method === 'POST' && path === '/api/orders') {
      const input = await body(req);
      const { grant } = await ordersContext('record:write');
      const result = await client.unsV2.recordInsertOne({
        collectionId: grant.collectionId, id: input.orderNo, idempotencyKey: input.idempotencyKey,
        data: { orderNo: input.orderNo, amount: input.amount, status: 'draft' },
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
