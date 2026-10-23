import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [backend, reference] = process.argv.slice(2);
assert.ok(backend && reference, 'Usage: sync-stream-runtime-contract.mjs <backend-checkout> <committed-revision>');
const revision = execFileSync('git', ['rev-parse', `${reference}^{commit}`], { cwd: backend, encoding: 'utf8' }).trim();
const source = 'share/unscontract/manifest.json';
const raw = execFileSync('git', ['show', `${revision}:${source}`], { cwd: backend, encoding: 'utf8', maxBuffer: 20 << 20 });
const manifest = JSON.parse(raw);
const names = ['RuntimeStreamDefinition', 'CloudStreamScript',
  'CloudStreamRuntimeCapabilitiesGetReq', 'CloudStreamRuntimeCapabilitiesGetResponse',
  'CloudStreamDocument', 'CloudStreamEntry'];
const schemas = Object.fromEntries(names.map(name => {
  assert.ok(manifest.schemas[name], `Missing Stream schema ${name}`);
  return [name, manifest.schemas[name]];
}));
for (const name of names.slice(0, 2)) {
  assert.deepEqual(schemas[name].properties.sdkVersion.enum, ['tier0-stream/v3']);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
writeFileSync(resolve(root, 'contracts/uns-v2/stream-runtime.schema-overlay.json'), JSON.stringify({
  version: 'stream-runtime-schema-overlay/v1', repository: 'FREEZONEX/Tier0-Backend', revision, source,
  sourceManifestSHA256: createHash('sha256').update(raw).digest('hex'),
  scope: 'Current Stream runtime/write DTOs, compiled message metadata and readiness only; unrelated UNS data remains on its separately reviewed baseline.',
  operationMetadata: Object.fromEntries(['streamRuntimeCapabilitiesGet'].map(name => {
    const operation = manifest.operations.find(operation => operation.name === name);
    assert.ok(operation && !operation.coreOnly, `Missing public operation ${name}`);
    return [name, Object.fromEntries(['permission', 'scope', 'minPermission'].map(key => [key, operation[key]]))];
  })),
  schemas,
}, null, 2) + '\n');
console.log(`Pinned ${names.length} Stream runtime schemas from ${revision}`);
