import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('syncs a committed Go contract containing literal Unicode line separators', () => {
  const root = mkdtempSync(join(tmpdir(), 'tier0-sdk-contract-sync-'));
  try {
    const backend = join(root, 'backend');
    const sdk = join(root, 'sdk');
    const put = (path: string, text: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    const description = 'before\u2028middle\u2029after';
    const contract = { version: 'fixture', operations: [], schemas: { Fixture: { description } } };
    put(join(backend, 'service/unssvr/internal/domain/unsv2/contract_generated.go'),
      `package unsv2\nconst ContractJSON = ${JSON.stringify(JSON.stringify(contract))}\n`);
    put(join(backend, 'share/unscontract/manifest.json'), JSON.stringify({
      version: 'fixture', operations: [], cloudContractRevision: 'fixture/1',
    }));
    for (const name of ['cloud-support.json', 'provenance.json']) {
      put(join(backend, 'share/unscontract', name), '{}');
    }
    put(join(backend, 'share/unscontract/registry_generated.go'), 'package fixture\n');
    const git = (...args: string[]) => execFileSync('git', ['-C', backend, ...args], { encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    const revision = git('rev-parse', 'HEAD');
    const script = join(sdk, 'scripts/sync-uns-v2.mjs');
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(join(sdk, 'contracts/uns-v2'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('../../scripts/sync-uns-v2.mjs', import.meta.url)), script);
    const result = spawnSync(process.execPath, [script, backend, revision], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const synced = JSON.parse(readFileSync(join(sdk, 'contracts/uns-v2/contract.json'), 'utf8'));
    expect(synced).toEqual(contract);
    const provenance = JSON.parse(readFileSync(join(sdk, 'contracts/uns-v2/provenance.json'), 'utf8'));
    expect(provenance.revision).toBe(revision);
    expect(provenance.resolvedCloudContract).toBe(true);
    expect(provenance.sourceMode).toBe('commit');
    expect(provenance.sourceInputs.every((input: { matchesCommit: boolean }) => input.matchesCommit)).toBe(true);
    const edited = { ...contract, schemas: { Fixture: { description: 'uncommitted current model' } } };
    put(join(backend, 'service/unssvr/internal/domain/unsv2/contract_generated.go'),
      `package unsv2\nconst ContractJSON = ${JSON.stringify(JSON.stringify(edited))}\n`);
    const development = spawnSync(process.execPath, [script, backend, revision, '--working-tree'], { encoding: 'utf8' });
    expect(development.status, development.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(sdk, 'contracts/uns-v2/contract.json'), 'utf8'))).toEqual(edited);
    const actual = JSON.parse(readFileSync(join(sdk, 'contracts/uns-v2/provenance.json'), 'utf8'));
    expect(actual.sourceMode).toBe('working-tree');
    expect(actual.sourceInputs.find((input: { path: string }) => input.path.endsWith('contract_generated.go')).matchesCommit).toBe(false);
    expect(spawnSync(process.execPath, [script, backend, '0'.repeat(40), '--working-tree']).status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('verifies every immutable canonical snapshot input before publishing generated inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'tier0-sdk-snapshot-sync-'));
  try {
    const script = join(root, 'scripts/sync-uns-v2.mjs');
    const output = join(root, 'contracts/uns-v2');
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(output, { recursive: true });
    copyFileSync(fileURLToPath(new URL('../../scripts/sync-uns-v2.mjs', import.meta.url)), script);
    const pin = `sha256:${'a'.repeat(64)}`;
    const manifest = { version: '5.0.0', cloudContractRevision: 'single-model/fixture', operations: [], schemas: {} };
    const files = [
      ['share/unscontract/manifest.json', JSON.stringify(manifest)],
      ['share/unscontract/registry_generated.go', 'package fixture\n'],
    ].map(([path, value], index) => {
      const snapshot = join(root, `input-${index}`);
      writeFileSync(snapshot, value);
      return { path, snapshot, sha256: createHash('sha256').update(value).digest('hex') };
    });
    const metadata = join(root, 'canonical.json');
    writeFileSync(metadata, JSON.stringify({ pin, files }));
    const run = (expected = pin) => spawnSync(process.execPath, [script, '--snapshot', metadata, expected], { encoding: 'utf8' });
    expect(run(`sha256:${'b'.repeat(64)}`).status).not.toBe(0);
    expect(run().status).toBe(0);
    const provenancePath = join(output, 'provenance.json');
    const before = readFileSync(provenancePath, 'utf8');
    expect(JSON.parse(before)).toMatchObject({ revision: pin, sourceMode: 'immutable-snapshot', sourceInputs: files.map(({ path, sha256 }) => ({ path, sha256 })) });
    expect(JSON.parse(readFileSync(join(output, 'contract.json'), 'utf8'))).toEqual(manifest);
    writeFileSync(files[1].snapshot, 'tampered registry');
    expect(run().status).not.toBe(0);
    expect(readFileSync(provenancePath, 'utf8')).toBe(before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
