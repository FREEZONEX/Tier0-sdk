import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadataPath = resolve(root, 'contracts/capability-discovery/provenance.json');
const sha = value => createHash('sha256').update(value).digest('hex');
if (process.argv[2] === '--check') {
  const metadata = JSON.parse(readFileSync(metadataPath));
  assert.match(metadata.revision, /^[a-f0-9]{40}$/);
  assert.ok(!process.argv.includes('--committed') || metadata.sourceKind !== 'working-tree-preview',
    'Capability discovery is a working-tree preview; sync the committed Backend contract before publishing.');
  for (const [path, hash] of Object.entries(metadata.inputs)) {
    assert.equal(sha(readFileSync(resolve(root, path))), hash, `Capability input changed: ${path}`);
  }
  console.log(`Verified capability contract (${metadata.sourceKind}) at ${metadata.revision}.`);
} else {
  const [backend, reference] = process.argv.slice(2);
  assert.ok(backend && reference, 'Usage: sync-capability-contract.mjs <backend> <commit|--worktree>');
  const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], {
    maxBuffer: 20 << 20, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const preview = reference === '--worktree';
  let revision;
  if (preview) {
    try { revision = git('rev-parse', 'HEAD^{commit}').toString().trim(); }
    catch { revision = JSON.parse(readFileSync(resolve(backend, '.git/source-baseline.json'))).sha; }
  } else revision = git('rev-parse', `${reference}^{commit}`).toString().trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const sources = {
    'contracts/capability-discovery/response.schema.json': 'share/domain/capability/discovery.schema.json',
    'contracts/capability-discovery/vectors.json': 'share/domain/capability/testdata/discovery.vectors.json',
  };
  const contents = Object.fromEntries(Object.entries(sources).map(([local, source]) =>
    [local, preview ? readFileSync(resolve(backend, source)) : git('show', `${revision}:${source}`)]));
  const schema = JSON.parse(contents['contracts/capability-discovery/response.schema.json']);
  const vectors = JSON.parse(contents['contracts/capability-discovery/vectors.json']);
  assert.ok(schema.$id.includes('/capability-discovery/2.0/'), 'Expected discovery contract 2.0');
  assert.ok(Array.isArray(vectors) && vectors.length > 0, 'Missing capability vectors');
  const app = JSON.parse(readFileSync(resolve(root, 'package.json'))).name === '@tier0/sdk';
  const inputs = Object.fromEntries(Object.entries(contents).map(([path, data]) => [path, sha(data)]));
  inputs['src/capabilities.ts'] = sha(readFileSync(resolve(root, 'src/capabilities.ts')));
  const metadata = {
    repository: 'FREEZONEX/Tier0-Backend', revision,
    sourceKind: preview ? 'working-tree-preview' : 'committed',
    ...(preview ? { baseRevision: revision } : {}), sources, vectorCount: vectors.length,
    consumerScope: ['namespace.v2', 'source', 'stream', ...(app ? ['stream.requests.v1', 'stream.requests.invoke.v1'] : [])], inputs,
  };
  for (const [path, data] of Object.entries(contents)) writeFileSync(resolve(root, path), data);
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Synced capability contract ${metadata.sourceKind} at ${revision}.`);
}
