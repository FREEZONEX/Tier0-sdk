import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = 'share/unscontract/manifest.json';
const scope = 'source-stream-acquisition';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
export const acquisitionSchemas = [
  'CloudSourceCreateCredentials', 'CloudSourceDocumentCreateReq', 'CloudSourceDocumentUpdateReq',
  'UnsV2SourceStateUpdateReq', 'CloudStreamDocumentCreateReq', 'CloudStreamDocumentUpdateReq',
  'UnsV2StreamProgramDeployReq',
];

function references(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    assert.ok(value.$ref.startsWith('#/components/schemas/'), 'Unsupported schema reference');
    visit(value.$ref.slice('#/components/schemas/'.length));
  }
  for (const child of Object.values(value)) references(child, visit);
}

// 只同步已审阅的采集请求；其他数据模型与共享依赖继续使用原固定版本。
export function projectAcquisition(current, source) {
  const next = structuredClone(current);
  const selected = new Set(acquisitionSchemas);
  for (const name of selected) {
    assert.ok(current.schemas[name] && source.schemas[name], `Missing acquisition schema: ${name}`);
    const existingReferences = new Set();
    references(current.schemas[name], dependency => existingReferences.add(dependency));
    references(source.schemas[name], dependency => {
      if (!selected.has(dependency)) {
        assert.ok(current.schemas[dependency], `Missing pinned dependency: ${dependency}`);
        assert.ok(existingReferences.has(dependency), `New shared dependency requires review: ${dependency}`);
      }
    });
    next.schemas[name] = structuredClone(source.schemas[name]);
  }
  return next;
}

export function verifyAcquisition(repository, committed = false) {
  const provenance = JSON.parse(readFileSync(resolve(repository, 'contracts/uns-v2/provenance.json')));
  const updates = provenance.schemaUpdates ?? [];
  const update = updates.find(value => value.scope === scope);
  assert.ok(update, 'Sync the acquisition contract before validating it');
  assert.match(update.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(update.schemas, acquisitionSchemas);
  assert.match(update.sourceSHA256, /^[a-f0-9]{64}$/);
  if (committed) assert.notEqual(update.sourceKind, 'working-tree-preview', 'Acquisition contract is a working-tree preview; sync its committed Backend revision before publishing.');
  for (const [path, input] of Object.entries(update.inputs)) {
    assert.equal(sha(readFileSync(resolve(repository, path))), input.resultSHA256, `Acquisition snapshot changed without sync: ${path}`);
  }
  return update;
}

export function syncAcquisition(repository, backend, reference) {
  assert.ok(backend && reference, 'Usage: sync-acquisition-contract.mjs <backend-checkout> <commit | --worktree>');
  const git = (...args) => execFileSync('git', ['-C', resolve(backend), ...args], { maxBuffer: 24 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  const preview = reference === '--worktree';
  let revision;
  if (preview) {
    try { revision = git('rev-parse', '--verify', 'HEAD^{commit}').toString().trim(); }
    catch { revision = JSON.parse(readFileSync(resolve(backend, '.git/source-baseline.json'))).sha; }
  } else revision = git('rev-parse', '--verify', `${reference}^{commit}`).toString().trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const sourceRaw = preview ? readFileSync(resolve(backend, sourcePath)) : git('show', `${revision}:${sourcePath}`);
  const source = JSON.parse(sourceRaw);
  const provenancePath = 'contracts/uns-v2/provenance.json';
  const provenance = JSON.parse(readFileSync(resolve(repository, provenancePath)));
  const lockPath = resolve(repository, 'contracts/upstream.json');
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath)) : null;
  const previous = provenance.schemaUpdates?.find(value => value.scope === scope);
  const update = {
    scope, repository: 'FREEZONEX/Tier0-Backend', revision,
    sourceKind: preview ? 'working-tree-preview' : 'committed',
    ...(preview ? { baseRevision: revision } : {}),
    source: sourcePath, sourceSHA256: sha(sourceRaw), sourceContractRevision: source.cloudContractRevision,
    schemas: acquisitionSchemas, inputs: {},
  };
  const outputs = new Map();
  for (const path of ['contracts/uns-v2/manifest.json', 'contracts/uns-v2/contract.json']) {
    const before = readFileSync(resolve(repository, path));
    if (lock) assert.equal(sha(before), lock.inputs[path].sha256, `Unsynced input: ${path}`);
    if (previous) assert.equal(sha(before), previous.inputs[path].resultSHA256, `Edited acquisition snapshot: ${path}`);
    const current = JSON.parse(before);
    const patched = projectAcquisition(current, source);
    const after = isDeepStrictEqual(current, patched) ? before : Buffer.from(path.endsWith('/contract.json') && !before.includes('\n  ') ? JSON.stringify(patched) + '\n' : json(patched));
    update.inputs[path] = { path: sourcePath, sourceSHA256: update.sourceSHA256, baseSHA256: previous?.inputs[path].baseSHA256 ?? sha(before), resultSHA256: sha(after) };
    outputs.set(path, after);
    if (lock) lock.inputs[path] = { ...lock.inputs[path], sha256: sha(after) };
  }
  const updates = [...(provenance.schemaUpdates ?? []).filter(value => value.scope !== scope), update];
  provenance.schemaUpdates = updates;
  provenance.sourceDerivedContractSHA256 = sha(outputs.get('contracts/uns-v2/contract.json'));
  provenance.note = 'Pinned base with reviewed acquisition schema updates; schemaUpdates records the exact source revision and hashes. Other data-model inputs remain pinned.';
  outputs.set(provenancePath, json(provenance));
  if (lock) { lock.schemaUpdates = updates; outputs.set('contracts/upstream.json', json(lock)); }
  // 全部依赖与原始哈希验证完成后，才写入快照及来源记录。
  for (const [path, output] of outputs) writeFileSync(resolve(repository, path), output);
  return update;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--check') {
    verifyAcquisition(root, process.argv.includes('--committed'));
    console.log('Verified scoped Source/Stream acquisition contract.');
  } else {
    const update = syncAcquisition(root, ...process.argv.slice(2));
    console.log(`Synced ${update.schemas.length} acquisition schemas (${update.sourceKind}); unrelated inputs remain pinned.`);
  }
}
