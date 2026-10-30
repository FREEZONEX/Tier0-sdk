import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
const routes = [
  '/openapi/v2/info',
  '/openapi/v2/auth/whoami',
  '/openapi/v2/notifications/send',
  '/openapi/v2/notifications/get',
  '/openapi/v2/platform/getMembers',
  '/openapi/v2/apps/access-members/list',
];
const appRoute = routes.at(-1);
const directory = 'contracts/openapi/';
const read = name => readFileSync(resolve(root, directory, name));
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');

function project(source, selected) {
  const paths = Object.fromEntries(selected.map(route => {
    const operation = source.paths[route] ?? source.paths[route.slice('/openapi/v2'.length)];
    assert.ok(operation?.post, `Missing public POST ${route}`);
    return [route, operation];
  }));
  const schemas = {};
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') {
      assert.ok(value.$ref.startsWith('#/components/schemas/'), `Unsupported schema reference ${value.$ref}`);
      const name = value.$ref.slice('#/components/schemas/'.length);
      if (!Object.hasOwn(schemas, name)) {
        assert.ok(Object.hasOwn(source.components?.schemas ?? {}, name), `Missing public schema ${name}`);
        schemas[name] = source.components.schemas[name];
        visit(schemas[name]);
      }
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(paths);
  return { openapi: source.openapi, info: source.info, paths, components: { schemas } };
}

if (process.argv[2] === '--check') {
  const platform = JSON.parse(read('platform-provenance.json'));
  const app = JSON.parse(read('app-members-provenance.json'));
  for (const metadata of [platform, app]) {
    assert.match(metadata.revision, /^[a-f0-9]{40}$/);
    assert.equal(metadata.repository, 'FREEZONEX/Tier0-Backend');
    assert.equal(metadata.source, sourcePath);
    assert.match(metadata.sourceSHA256, /^[a-f0-9]{64}$/);
    assert.ok(!process.argv.includes('--committed') ||
      ![metadata.sourceKind, metadata.mode].includes('working-tree-preview'),
    'Publish requires syncing the committed Backend platform contract; this snapshot is a working-tree preview.');
  }
  assert.equal(app.revision, platform.revision, 'App-members revision differs from platform');
  assert.equal(app.sourceSHA256, platform.sourceSHA256, 'App-members source differs from platform');
  const platformRaw = read('platform.swagger.json');
  const appRaw = read('app-members.swagger.json');
  assert.equal(sha(platformRaw), platform.snapshotSHA256, 'Platform snapshot changed without sync');
  assert.equal(sha(appRaw), app.appMembersSwaggerSHA256, 'App-members snapshot changed without sync');
  const snapshot = JSON.parse(platformRaw);
  assert.deepEqual(Object.keys(snapshot.paths), routes);
  assert.deepEqual(snapshot, project(snapshot, routes), 'Platform snapshot is not the selected schema closure');
  assert.deepEqual(JSON.parse(appRaw), project(snapshot, [appRoute]), 'App-members projection differs from platform');
  console.log(`Verified ${routes.length} public platform routes from Backend ${platform.revision} (${platform.sourceKind ?? 'committed'}).`);
} else {
  const [backend, reference] = process.argv.slice(2);
  assert.ok(backend && reference, 'Usage: sync-platform-contract.mjs <backend-checkout> <committed-revision | --worktree>');
  const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], { maxBuffer: 20 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  const preview = reference === '--worktree';
  let revision;
  if (preview) {
    try { revision = git('rev-parse', '--verify', 'HEAD^{commit}').toString('utf8').trim(); }
    catch { revision = JSON.parse(readFileSync(resolve(backend, '.git/source-baseline.json'), 'utf8')).sha; }
  } else revision = git('rev-parse', '--verify', `${reference}^{commit}`).toString('utf8').trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const raw = preview ? readFileSync(resolve(backend, sourcePath)) : git('show', `${revision}:${sourcePath}`);
  const source = JSON.parse(raw);
  assert.ok(source.servers?.some(server => server.url === '/openapi/v2'), 'Expected the public v2 server');
  const snapshot = json(project(source, routes));
  const appSnapshot = json(project(source, [appRoute]));
  const common = {
    repository: 'FREEZONEX/Tier0-Backend', revision, source: sourcePath,
    ...(preview ? { sourceKind: 'working-tree-preview', baseRevision: revision } : {}),
    sourceSHA256: sha(raw),
  };
  // Validate both projections before replacing any snapshot or provenance.
  const outputs = {
    'platform.swagger.json': snapshot,
    'app-members.swagger.json': appSnapshot,
    'platform-provenance.json': json({ ...common, snapshotSHA256: sha(snapshot) }),
    'app-members-provenance.json': json({ ...common, mode: preview ? 'working-tree-preview' : 'committed', appMembersSwaggerSHA256: sha(appSnapshot) }),
  };
  for (const [name, content] of Object.entries(outputs)) writeFileSync(resolve(root, directory, name), content);
  console.log(`${preview ? 'Previewed' : 'Pinned'} ${routes.length} public platform routes from Backend ${revision}. Run npm run generate.`);
}
