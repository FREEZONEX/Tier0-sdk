import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backend, revision] = process.argv.slice(2);
if (!backend || !/^[a-f0-9]{40}$/.test(revision || '')) {
  throw new Error('Usage: node scripts/sync-uns-v2.mjs <backend-checkout> <full-commit-sha>');
}
const read = path => execFileSync('git', ['-C', backend, 'show', `${revision}:${path}`], { encoding: 'utf8', maxBuffer: 16 << 20 });
const hash = value => createHash('sha256').update(value).digest('hex');
const sourcePath = 'service/unssvr/internal/domain/unsv2/contract_generated.go';
const source = read(sourcePath);
const literal = source.match(/^const ContractJSON = (".*")$/m)?.[1];
if (!literal) throw new Error('Missing resolved Backend ContractJSON');
const contractText = JSON.parse(literal);
const contract = JSON.parse(contractText);
const manifestText = read('share/unscontract/manifest.json');
const manifest = JSON.parse(manifestText);
if (contract.version !== manifest.version || contract.operations.length !== manifest.operations.length) {
  throw new Error('Resolved contract and manifest disagree');
}
for (const file of ['cloud-support.json', 'registry_generated.go']) {
  writeFileSync(resolve(root, 'contracts/uns-v2', file), read(`share/unscontract/${file}`));
}
writeFileSync(resolve(root, 'contracts/uns-v2/manifest.json'), manifestText);
writeFileSync(resolve(root, 'contracts/uns-v2/contract.json'), JSON.stringify(contract, null, 2) + '\n');
writeFileSync(resolve(root, 'contracts/uns-v2/provenance.json'), JSON.stringify({
  repository: 'FREEZONEX/Tier0-Backend', revision, version: manifest.version,
  source: `${sourcePath}#ContractJSON`, cloudRevision: revision,
  cloudContractRevision: manifest.cloudContractRevision, resolvedCloudContract: true,
  enterpriseBase: JSON.parse(read('share/unscontract/provenance.json')),
  sourceDerivedContractSHA256: hash(contractText),
  upstreamSourceSHA256: hash(source),
  note: 'Resolved Cloud contract from the pinned commit; local fixtures do not establish deployment acceptance or device ACK.',
}, null, 2) + '\n');
console.log(`Synced Backend ${revision}: UNS ${manifest.version}, ${manifest.operations.length} operations.`);
