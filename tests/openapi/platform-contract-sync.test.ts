import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const sourcePath = 'service/gwsvr/internal/handler/openapi/v2/unsv2/swagger_generated.json';
const directories: string[] = [];
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it('syncs committed platform blobs, guards every preview and checks both projections', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-platform-contract-')); directories.push(directory);
  const backend = join(directory, 'backend');
  const sdk = join(directory, 'sdk');
  mkdirSync(join(sdk, 'scripts'), { recursive: true });
  mkdirSync(join(sdk, 'contracts/openapi'), { recursive: true });
  mkdirSync(dirname(join(backend, sourcePath)), { recursive: true });
  copyFileSync(join(root, 'scripts/sync-platform-contract.mjs'), join(sdk, 'scripts/sync-platform-contract.mjs'));
  const source = JSON.parse(readFileSync(join(root, 'contracts/openapi/platform.swagger.json'), 'utf8'));
  source.servers = [{ url: '/openapi/v2' }];
  source.paths = Object.fromEntries(Object.entries(source.paths).map(([route, operation]) => [route.slice('/openapi/v2'.length), operation]));
  source.paths['/retired/unrelated'] = { post: { operationId: 'ignored' } };
  const raw = JSON.stringify(source, null, 2) + '\n';
  writeFileSync(join(backend, sourcePath), raw);
  const git = (...args: string[]) => execFileSync('git', ['-C', backend, ...args], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('-c', 'core.autocrlf=false', 'add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'committed fixture');
  const revision = git('rev-parse', 'HEAD').trim();
  const run = (...args: string[]) => spawnSync(process.execPath, [join(sdk, 'scripts/sync-platform-contract.mjs'), ...args], { encoding: 'utf8' });
  const file = (name: string) => join(sdk, 'contracts/openapi', name);
  const read = (name: string) => JSON.parse(readFileSync(file(name), 'utf8'));

  writeFileSync(join(backend, sourcePath), 'dirty invalid source');
  const synced = run(backend, revision);
  expect(synced.status, synced.stderr).toBe(0);
  expect(read('platform-provenance.json').sourceSHA256).toBe(sha(raw));
  expect(read('platform-provenance.json').revision).toBe(revision);
  expect(read('platform-provenance.json')).not.toHaveProperty('sourceKind');
  expect(read('platform.swagger.json').paths).not.toHaveProperty('/openapi/v2/retired/unrelated');
  expect(run('--check', '--committed').status).toBe(0);

  // The App overlay cannot remain a preview when the platform snapshot is committed.
  const appMetadata = read('app-members-provenance.json');
  writeFileSync(file('app-members-provenance.json'), JSON.stringify({ ...appMetadata, mode: 'working-tree-preview' }));
  expect(run('--check', '--committed').stderr).toContain('working-tree preview');
  writeFileSync(file('app-members-provenance.json'), JSON.stringify(appMetadata));

  const committedSnapshot = readFileSync(file('platform.swagger.json'));
  writeFileSync(file('platform.swagger.json'), Buffer.concat([committedSnapshot, Buffer.from(' ')]));
  expect(run('--check').stderr).toContain('Platform snapshot changed without sync');
  writeFileSync(file('platform.swagger.json'), committedSnapshot);

  writeFileSync(join(backend, sourcePath), raw);
  expect(run(backend, '--worktree').status).toBe(0);
  expect(read('platform-provenance.json').sourceKind).toBe('working-tree-preview');
  expect(read('platform-provenance.json').baseRevision).toBe(revision);
  expect(run('--check').status).toBe(0);
  expect(run('--check', '--committed').stderr).toContain('working-tree preview');

  const previewSnapshot = readFileSync(file('platform.swagger.json'));
  delete source.paths['/apps/access-members/list'];
  writeFileSync(join(backend, sourcePath), JSON.stringify(source));
  expect(run(backend, '--worktree').stderr).toContain('Missing public POST /openapi/v2/apps/access-members/list');
  expect(readFileSync(file('platform.swagger.json'))).toEqual(previewSnapshot);
  // Re-syncing the real commit clears preview metadata without editing it by hand.
  expect(run(backend, revision).status).toBe(0);
  expect(run('--check', '--committed').status).toBe(0);
});
