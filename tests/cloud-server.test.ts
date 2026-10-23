import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APP_REQUEST_IDENTITY_CONTRACT as contract } from '../src/app-identity-contract.generated.js';
import { AppRequestIdentityError, createCloudAppRequestVerifier } from '../src/cloud-server.js';

const now = Math.floor(Date.UTC(2026, 9, 20, 12) / 1000);
const pair = generateKeyPairSync('ed25519');
const rotated = generateKeyPairSync('ed25519');
const appID = '19c578a2-2027-41be-8517-bd8dc999ac2c';
const workspaceID = '9007199254740993';
const publicKey = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'current' };
const publicKeys = () => ({ keys: [{ ...publicKey }] });
const body = Buffer.from('{"idempotencyKey":"intent-real-bytes"}');
const claims = () => ({
  ver: contract.version, iss: contract.issuer, aud: contract.audience,
  sub: '9007199254740995', workspaceID, appID, method: 'POST', requestURI: '/api/device/telemetry?unit=1',
  bodySHA256: createHash('sha256').update(body).digest('hex'), iat: now, exp: now + contract.maxTTLSeconds,
  jti: 'a'.repeat(32), roles: ['operator'],
});
const token = (payload: unknown = claims(), header: unknown = { alg: contract.algorithm, typ: contract.type, kid: 'current' }) => {
  const input = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return input + '.' + sign(null, Buffer.from(input), pair.privateKey).toString('base64url');
};
const request = () => ({ assertion: token(), method: 'POST', requestURI: '/api/device/telemetry?unit=1', body });
const verifier = () => createCloudAppRequestVerifier({ appID, workspaceID, publicKeys: publicKeys() });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now * 1000); });
afterEach(() => vi.useRealTimers());

it('verifies real Ed25519 bytes and returns a frozen, precision-preserving subject', () => {
  const verify = verifier();
  const subject = verify(request());
  expect(subject).toMatchObject({ kind: 'gateway-user', userID: '9007199254740995', workspaceID, appID, roleKeys: ['operator'], requestID: 'a'.repeat(32), verificationKeyID: 'current' });
  expect(Object.isFrozen(subject)).toBe(true);
  expect(Object.isFrozen(subject.roleKeys)).toBe(true);
  expect(subject).not.toHaveProperty('assertion');
  expect(subject).not.toHaveProperty('privateKey');
  expect(verify(request()).requestID).toBe(subject.requestID, 'verification is not device execution or an idempotency ledger');
});

it('pins configured authority and imported public keys instead of accepting per-request key substitution', () => {
  const authority = { appID, workspaceID, publicKeys: publicKeys() };
  const verify = createCloudAppRequestVerifier(authority);
  authority.appID = '14bfc189-8516-4709-a4c9-865a0f1dc345';
  authority.workspaceID = '1';
  authority.publicKeys.keys[0].x = rotated.publicKey.export({ format: 'jwk' }).x;
  expect(verify(request()).appID).toBe(appID);
});

it('allows an explicit public-key rotation set while rejecting a removed signing key', () => {
  const next = { ...rotated.publicKey.export({ format: 'jwk' }), kid: 'next' };
  const verify = createCloudAppRequestVerifier({ appID, workspaceID, publicKeys: { keys: [publicKey, next] } });
  expect(verify(request()).verificationKeyID).toBe('current');
  const withoutOld = createCloudAppRequestVerifier({ appID, workspaceID, publicKeys: { keys: [next] } });
  expect(() => withoutOld(request())).toThrowError(AppRequestIdentityError);
});

it.each([
  ['version', { ver: 'tier0.app-request-identity/v999' }], ['issuer', { iss: 'other' }], ['audience', { aud: 'session' }],
  ['zero user', { sub: '0' }], ['numeric user', { sub: 1 }], ['leading-zero user', { sub: '01' }],
  ['overflow user', { sub: '9223372036854775808' }], ['workspace', { workspaceID: '1' }],
  ['App', { appID: '14bfc189-8516-4709-a4c9-865a0f1dc345' }], ['method', { method: 'GET' }],
  ['URI', { requestURI: '/api/device/telemetry?unit=2' }], ['body hash', { bodySHA256: 'b'.repeat(64) }],
  ['future clock', { iat: now + 60, exp: now + 90 }], ['expired', { iat: now - 100, exp: now - 70 }],
  ['overlong TTL', { exp: now + contract.maxTTLSeconds + 1 }], ['empty TTL', { exp: now }],
  ['fractional time', { iat: now + .5 }], ['nonce', { jti: '' }], ['role shape', { roles: {} }],
  ['duplicate roles', { roles: ['operator', 'operator'] }], ['role injection', { roles: ['operator\nadmin'] }],
  ['extra authority', { owner: true }],
] as const)('rejects validly signed but invalid %s claims', (_name, patch) => {
  expect(() => verifier()({ ...request(), assertion: token({ ...claims(), ...patch }) })).toThrowError(AppRequestIdentityError);
});

it.each([
  { alg: 'none', typ: contract.type, kid: 'current' },
  { alg: 'HS256', typ: contract.type, kid: 'current' },
  { alg: contract.algorithm, typ: 'session+jwt', kid: 'current' },
  { alg: contract.algorithm, typ: contract.type, kid: 'missing' },
  { alg: contract.algorithm, typ: contract.type, kid: 'current', jku: 'https://untrusted.invalid/key' },
])('rejects JOSE algorithm/key/identity confusion %j', (header) => {
  expect(() => verifier()({ ...request(), assertion: token(claims(), header) })).toThrowError(AppRequestIdentityError);
});

it('rejects altered signature, missing assertion, changed raw body, URI and oversized input', () => {
  const signed = token();
  const parts = signed.split('.');
  parts[2] = Buffer.alloc(64).toString('base64url');
  for (const value of [undefined, '', signed + '=', parts.join('.'), 'x'.repeat(contract.maxTokenBytes + 1)]) {
    expect(() => verifier()({ ...request(), assertion: value })).toThrowError(AppRequestIdentityError);
  }
  expect(() => verifier()({ ...request(), body: Buffer.from('{ "idempotencyKey":"intent-real-bytes"}') })).toThrowError(AppRequestIdentityError);
  expect(() => verifier()({ ...request(), requestURI: '/api/device/telemetry' })).toThrowError(AppRequestIdentityError);
  expect(() => verifier()({ ...request(), body: Buffer.alloc(contract.maxBodyBytes + 1) })).toThrowError(AppRequestIdentityError);
});

it.each([
  { keys: [] }, { keys: [publicKey, publicKey] }, { keys: [{ ...publicKey, d: 'private-material-must-not-leak' }] },
  { keys: [{ ...publicKey, kty: 'RSA' }] }, { keys: [{ ...publicKey, crv: 'X25519' }] },
  { keys: [{ ...publicKey, x: 'not-canonical===' }] }, { keys: [publicKey], remoteKeyURL: 'https://untrusted.invalid' },
])('rejects invalid or private key configuration without echoing it', (value) => {
  try { createCloudAppRequestVerifier({ appID, workspaceID, publicKeys: value }); throw new Error('accepted invalid key set'); }
  catch (error) {
    expect(error).toBeInstanceOf(AppRequestIdentityError);
    expect((error as AppRequestIdentityError).code).toBe('APP_IDENTITY_CONFIGURATION_INVALID');
    expect(String(error)).not.toContain('private-material');
  }
});
