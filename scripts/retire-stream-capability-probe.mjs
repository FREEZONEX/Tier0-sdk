// Project one verified Backend retirement onto the frozen SDK data contract.
// Do not import unrelated data, permission or Stream execution changes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = process.argv[2];
if (!backend) throw new Error('Usage: node scripts/retire-stream-capability-probe.mjs <Backend checkout> [--candidate]');
const source = 'share/unscontract/manifest.json';
const revision = execFileSync('git', ['-C', backend, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const bytes = readFileSync(resolve(backend, source));
const committed = execFileSync('git', ['-C', backend, 'show', `${revision}:${source}`], { maxBuffer: 16 * 1024 * 1024 });
const matchesCommit = bytes.equals(committed);
if (!matchesCommit && !process.argv.includes('--candidate')) throw new Error('Backend manifest must match its committed HEAD');
const upstream = JSON.parse(bytes.toString('utf8'));
const operation = 'streamRuntimeCapabilitiesGet';
const path = '/uns/streams/runtime/capabilities/get';
const schemas = ['CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse'];
const retirement = 'stream-control-probe-retirement/1';
const retireRevision = value => value.split('+').includes(retirement) ? value : `${value}+${retirement}`;
if (upstream.operations.some(item => item.name === operation || item.path === path || item.suffix === path) ||
    schemas.some(name => Object.hasOwn(upstream.schemas, name))) {
  throw new Error('Backend still exposes the retired public probe');
}
const contractPath = name => resolve(root, 'contracts/uns-v2', name);
for (const name of ['contract.json', 'manifest.json']) {
  const file = contractPath(name);
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  contract.cloudContractRevision = retireRevision(contract.cloudContractRevision);
  contract.operations = contract.operations.filter(item => item.name !== operation);
  for (const schema of schemas) delete contract.schemas[schema];
  writeFileSync(file, JSON.stringify(contract, null, 2) + '\n');
}
for (const name of ['cloud-support.json', 'registry_generated.go']) {
  const file = contractPath(name);
  const lines = readFileSync(file, 'utf8').split('\n');
  writeFileSync(file, lines.filter(line => !line.includes(`"${operation}"`)).join('\n'));
}
const overlayPath = contractPath('stream-runtime.schema-overlay.json');
const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
for (const schema of schemas) delete overlay.schemas[schema];
delete overlay.operationMetadata[operation];
overlay.scope = 'Current Stream runtime/write DTOs, compiled message metadata and read-only history only; unrelated UNS data remains on its separately reviewed baseline.';
writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
const provenancePath = contractPath('provenance.json');
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
provenance.cloudContractRevision = retireRevision(provenance.cloudContractRevision);
provenance.streamCapabilityRetirement = {
  revision: matchesCommit ? revision : null,
  source,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  matchesCommit,
};
writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + '\n');
console.log(`Retired the public Stream capability probe using Backend ${matchesCommit ? revision : 'uncommitted candidate'}; frozen data revision preserved.`);
