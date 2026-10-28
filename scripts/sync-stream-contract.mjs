import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'contracts/openapi/streams.swagger.json');
const provenancePath = resolve(root, 'contracts/openapi/streams-provenance.json');
const sourcePath = 'service/gwsvr/internal/handler/swaggerui/swagger.json';
const routes = [
  '/openapi/v1/stream-requests/discover',
  '/openapi/v1/stream-requests/{requestCode}/describe',
  '/openapi/v1/stream-requests/{requestCode}/invoke',
  '/openapi/v1/stream-messages/connect',
  '/openapi/v1/capabilities/discover',
];
const sha = value => createHash('sha256').update(value).digest('hex');
if (process.argv[2] === '--check') {
  const metadata = JSON.parse(readFileSync(provenancePath, 'utf8'));
  const raw = readFileSync(target, 'utf8');
  assert.equal(sha(raw), metadata.snapshotSHA256);
  assert.deepEqual(Object.keys(JSON.parse(raw).paths), routes);
  console.log(`Verified public Stream contract from Backend ${metadata.revision}`);
} else {
  const [backend, reference] = process.argv.slice(2);
  assert.ok(backend && reference, 'Usage: sync-stream-contract.mjs <backend-checkout> <committed-revision>');
  const revision = execFileSync('git', ['rev-parse', `${reference}^{commit}`], { cwd: backend, encoding: 'utf8' }).trim();
  const raw = execFileSync('git', ['show', `${revision}:${sourcePath}`], { cwd: backend, encoding: 'utf8', maxBuffer: 20 << 20 });
  const source = JSON.parse(raw);
  const paths = Object.fromEntries(routes.map(route => {
    assert.ok(source.paths[route]?.post, `Missing public POST ${route}`);
    return [route, source.paths[route]];
  }));
  const schemas = {};
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) {
      const name = value.$ref.split('/').pop();
      if (!Object.hasOwn(schemas, name)) {
        assert.ok(source.components.schemas[name], `Missing public schema ${name}`);
        schemas[name] = source.components.schemas[name];
        visit(schemas[name]);
      }
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(paths);
  const snapshot = JSON.stringify({ openapi: source.openapi, info: source.info, paths, components: { schemas } }, null, 2) + '\n';
  writeFileSync(target, snapshot);
  writeFileSync(provenancePath, JSON.stringify({
    repository: 'FREEZONEX/Tier0-Backend', revision, source: sourcePath,
    sourceSHA256: sha(raw), snapshotSHA256: sha(snapshot),
    trustRevision: execFileSync('git', ['rev-parse', '5eecd2188^{commit}'], { cwd: backend, encoding: 'utf8' }).trim(),
    scope: 'Public Stream requests, message connection and capability discovery only. Current UNS v5 data and single-model inputs are pinned separately; this snapshot does not assert a matching deployed Backend/SWE/App or SYS/GW/browser acceptance.',
  }, null, 2) + '\n');
  console.log(`Pinned ${routes.length} public routes and ${Object.keys(schemas).length} schemas from ${revision}`);
}
