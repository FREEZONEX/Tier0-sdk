import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'contracts/openapi/streams.swagger.json');
const provenancePath = resolve(root, 'contracts/openapi/streams-provenance.json');
const sourcePath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
const routes = [
  '/openapi/v2/stream-requests/discover',
  '/openapi/v2/stream-requests/{requestCode}/describe',
  '/openapi/v2/stream-requests/{requestCode}/invoke',
  '/openapi/v2/stream-messages/connect',
  '/openapi/v2/capabilities/discover',
];
const sha = value => createHash('sha256').update(value).digest('hex');
if (process.argv[2] === '--check') {
  const metadata = JSON.parse(readFileSync(provenancePath, 'utf8'));
  assert.ok(!process.argv.includes('--committed') || metadata.sourceKind !== 'working-tree-preview',
    'Publish requires syncing the committed Backend contract; this snapshot is a working-tree preview.');
  if (process.argv.includes('--committed')) {
    const capability = JSON.parse(readFileSync(resolve(root, 'contracts/capability-discovery/provenance.json')));
    assert.notEqual(capability.sourceKind, 'working-tree-preview', 'Capability discovery must be synced from committed Backend inputs before publishing.');
  }
  const raw = readFileSync(target, 'utf8');
  assert.equal(sha(raw), metadata.snapshotSHA256);
  assert.deepEqual(Object.keys(JSON.parse(raw).paths), routes);
  console.log(`Verified public Stream contract from Backend ${metadata.revision}`);
} else {
  const [backend, reference] = process.argv.slice(2);
  assert.ok(backend && reference, 'Usage: sync-stream-contract.mjs <backend-checkout> <committed-revision>');
  const git = (...args) => execFileSync('git', args, { cwd: backend, maxBuffer: 20 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  const preview = reference === '--worktree';
  let revision;
  if (preview) {
    try { revision = git('rev-parse', 'HEAD^{commit}').toString().trim(); }
    catch { revision = JSON.parse(readFileSync(resolve(backend, '.git/source-baseline.json'), 'utf8')).sha; }
  } else revision = git('rev-parse', `${reference}^{commit}`).toString().trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const raw = preview ? readFileSync(resolve(backend, sourcePath), 'utf8') : git('show', `${revision}:${sourcePath}`);
  const source = JSON.parse(raw);
  const schemaSources = source.components.schemas;
  const paths = Object.fromEntries(routes.map(route => {
    const operation = source.paths[route.slice('/openapi/v2'.length)];
    assert.ok(operation?.post, `Missing public POST ${route}`);
    return [route, operation];
  }));
  const schemas = {};
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) {
      const name = value.$ref.split('/').pop();
      if (!Object.hasOwn(schemas, name)) {
        assert.ok(schemaSources[name], `Missing public schema ${name}`);
        schemas[name] = schemaSources[name];
        visit(schemas[name]);
      }
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(paths);
  const stableSchemas = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name.replace(/^Platform/, ''), schema]));
  assert.equal(Object.keys(stableSchemas).length, Object.keys(schemas).length, 'Schema name collision');
  const snapshot = JSON.stringify({ openapi: source.openapi, info: source.info, paths, components: { schemas: stableSchemas } }, null, 2)
    .replaceAll('#/components/schemas/Platform', '#/components/schemas/') + '\n';
  writeFileSync(target, snapshot);
  writeFileSync(provenancePath, JSON.stringify({
    repository: 'FREEZONEX/Tier0-Backend', revision, source: sourcePath,
    ...(preview ? { sourceKind: 'working-tree-preview', baseRevision: revision } : {}),
    sourceSHA256: sha(raw), snapshotSHA256: sha(snapshot),
    sourceInputs: [{ path: sourcePath, sha256: sha(raw) }],
    scope: 'Public Stream requests, message connection and capability discovery only. Current UNS v5 data and single-model inputs are pinned separately; this snapshot does not assert a matching deployed Backend/SWE/App or SYS/GW/browser acceptance.',
  }, null, 2) + '\n');
  console.log(`Pinned ${routes.length} public routes and ${Object.keys(schemas).length} schemas from ${revision}`);
}
