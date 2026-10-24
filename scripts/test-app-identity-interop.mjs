import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createCloudAppRequestVerifier } from '../dist/esm/cloud-server.js';

const path = process.argv[2];
assert.ok(path, 'Usage: test-app-identity-interop.mjs <SWE gatewayheader directory>');
const fixture = JSON.parse(execFileSync('go', ['run', './testdata/identity'], { cwd: resolve(path), encoding: 'utf8', env: { ...process.env, GOWORK: 'off' } }));
const request = { ...fixture.request, body: Buffer.from(fixture.request.body) };
const require = createRequire(import.meta.url);
const commonJS = require('../dist/cjs/cloud-server.js');
for (const [kind, createVerifier] of [['ESM', createCloudAppRequestVerifier], ['CJS', commonJS.createCloudAppRequestVerifier]]) {
  const verify = createVerifier(fixture.authority);
  const subject = verify(request);
  assert.equal(subject.userID, fixture.expectedUserID);
  assert.equal(subject.workspaceID, fixture.authority.workspaceID);
  assert.deepEqual(subject.roleKeys, ['operator']);
  assert.throws(() => verify({ ...request, body: Buffer.from('{}') }));
  assert.throws(() => verify({ ...request, method: 'GET' }));
  assert.throws(() => verify({ ...request, requestURI: '/api/device/telemetry?unit=2' }));
  console.log(`PASS: actual Go Ed25519 signer -> ${kind} public server verifier; raw request binding and precision-preserving identity`);
}
