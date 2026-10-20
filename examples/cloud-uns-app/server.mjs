import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createClient } from '@tier0/sdk/cloud';

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
    const code = unknown ? 'OUTCOME_UNKNOWN' : /^[A-Z_0-9]{1,80}$/.test(error.code ?? '') ? error.code : 'UNAVAILABLE';
    if (!res.headersSent) reply(res, status, { code });
    else res.destroy();
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
