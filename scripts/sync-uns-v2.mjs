import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[2] === '--snapshot') {
  const [, , , metadataPath, expectedPin] = process.argv;
  if (!metadataPath || !/^sha256:[a-f0-9]{64}$/.test(expectedPin || '') || process.argv.length !== 5) {
    throw new Error('Usage: node scripts/sync-uns-v2.mjs --snapshot <canonical-metadata.json> <sha256:bundle-pin>');
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (metadata.pin !== expectedPin) throw new Error('Canonical snapshot pin differs');
  const sources = new Map();
  const sourceInputs = [];
  for (const file of metadata.files) {
    const value = readFileSync(file.snapshot, 'utf8');
    const sha256 = createHash('sha256').update(value).digest('hex');
    if (sha256 !== file.sha256 || sources.has(file.path)) throw new Error(`Invalid snapshot input ${file.path}`);
    sources.set(file.path, value);
    sourceInputs.push({ path: file.path, sha256 });
  }
  const manifestText = sources.get('share/unscontract/manifest.json');
  const manifest = JSON.parse(manifestText);
  const registry = sources.get('share/unscontract/registry_generated.go');
  if (!registry || !manifest.cloudContractRevision || !manifest.version.startsWith('5.')) {
    throw new Error('Snapshot must contain the resolved current Cloud UNS v5 manifest and registry');
  }
  // The signed-off resolved manifest contains all operation/schema metadata.
  // Do not pretend this snapshot includes a Git-pinned Go ContractJSON input.
  const contract = { version: manifest.version, cloudContractRevision: manifest.cloudContractRevision,
    operations: manifest.operations, schemas: manifest.schemas };
  const put = (file, value) => writeFileSync(resolve(root, 'contracts/uns-v2', file), value);
  put('manifest.json', manifestText);
  put('registry_generated.go', registry);
  put('contract.json', JSON.stringify(contract, null, 2) + '\n');
  put('cloud-support.json', JSON.stringify({ operations: [] }, null, 2) + '\n');
  put('provenance.json', JSON.stringify({
    repository: 'FREEZONEX/Tier0-Backend', revision: expectedPin, cloudRevision: expectedPin,
    version: manifest.version, cloudContractRevision: manifest.cloudContractRevision,
    sourceMode: 'immutable-snapshot', source: 'share/unscontract/manifest.json', sourceInputs,
    resolvedCloudContract: true,
    note: 'Contract projected from the complete resolved canonical manifest, verified against immutable source file hashes. Not a Git release or deployment. No separate Cloud overlay is applied.',
  }, null, 2) + '\n');
  console.log(`Synced canonical snapshot ${expectedPin}: ${manifest.operations.length} operations.`);
  process.exit(0);
}
const [backend, revision, mode] = process.argv.slice(2);
const workingTree = mode === '--working-tree';
if (!backend || !/^[a-f0-9]{40}$/.test(revision || '') || (mode !== undefined && !workingTree) || process.argv.length > 5) {
  throw new Error('Usage: node scripts/sync-uns-v2.mjs <backend-checkout> <full-commit-sha> [--working-tree]');
}
const hash = value => createHash('sha256').update(value).digest('hex');
if (workingTree && execFileSync('git', ['-C', backend, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) {
  throw new Error('Working-tree contract base differs from Backend HEAD');
}
const inputs = new Map();
const sourceInputs = [];
const read = path => {
  if (inputs.has(path)) return inputs.get(path);
  let committed;
  try {
    committed = execFileSync('git', ['-C', backend, 'show', `${revision}:${path}`], {
      encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) { if (!workingTree) throw error; }
  const value = workingTree ? readFileSync(resolve(backend, path), 'utf8') : committed;
  inputs.set(path, value);
  sourceInputs.push({ path, sha256: hash(value), matchesCommit: value === committed });
  return value;
};
const sourcePath = 'service/unssvr/internal/domain/unsv2/contract_generated.go';
const source = read(sourcePath);
const literal = source.match(/^const ContractJSON\s*=\s*("(?:[^"\\]|\\.)*")[\t ]*$/m)?.[1];
if (!literal) throw new Error('Missing resolved Backend ContractJSON');
const contractText = JSON.parse(literal);
const contract = JSON.parse(contractText);
const manifestText = read('share/unscontract/manifest.json');
const manifest = JSON.parse(manifestText);
if (contract.version !== manifest.version || contract.operations.length !== manifest.operations.length) {
  throw new Error('Resolved contract and manifest disagree');
}
// 先捕获所有输入；工作区模式按字节摘要记账，不能冒记为已提交制品。
for (const path of ['cloud-support.json', 'registry_generated.go', 'provenance.json']) read(`share/unscontract/${path}`);
for (const file of ['cloud-support.json', 'registry_generated.go']) {
  writeFileSync(resolve(root, 'contracts/uns-v2', file), read(`share/unscontract/${file}`));
}
writeFileSync(resolve(root, 'contracts/uns-v2/manifest.json'), manifestText);
writeFileSync(resolve(root, 'contracts/uns-v2/contract.json'), JSON.stringify(contract, null, 2) + '\n');
writeFileSync(resolve(root, 'contracts/uns-v2/provenance.json'), JSON.stringify({
  repository: 'FREEZONEX/Tier0-Backend', revision, version: manifest.version,
  sourceMode: workingTree ? 'working-tree' : 'commit', sourceInputs,
  source: `${sourcePath}#ContractJSON`, cloudRevision: revision,
  cloudContractRevision: manifest.cloudContractRevision, resolvedCloudContract: true,
  enterpriseBase: JSON.parse(read('share/unscontract/provenance.json')),
  sourceDerivedContractSHA256: hash(contractText),
  upstreamSourceSHA256: hash(source),
  note: workingTree
    ? 'Development contract snapshot from Backend working tree; revision identifies its base, sourceInputs identify actual bytes. Not a committed or deployed release.'
    : 'Resolved Cloud contract from the pinned commit; local fixtures do not establish deployment acceptance or device ACK.',
}, null, 2) + '\n');
console.log(`Synced Backend ${revision}: UNS ${manifest.version}, ${manifest.operations.length} operations.`);
