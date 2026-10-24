// Server-only entry point. Browser HTTP clients remain independent of node:crypto.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { APP_REQUEST_IDENTITY_CONTRACT as contract } from './app-identity-contract.generated.js';

export const APP_REQUEST_IDENTITY_HEADER = contract.header;

export class AppRequestIdentityError extends Error {
  constructor(public readonly code: 'APP_IDENTITY_INVALID' | 'APP_IDENTITY_CONFIGURATION_INVALID') {
    super(code);
    this.name = 'AppRequestIdentityError';
  }
}

export interface VerifiedCloudAppUser {
  readonly kind: 'gateway-user';
  readonly userID: string;
  readonly workspaceID: string;
  readonly appID: string;
  readonly roleKeys: readonly string[];
  readonly requestID: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly verificationKeyID: string;
}

export interface CloudAppIdentityAuthority {
  appID: string;
  workspaceID: string;
  /** Pinned server configuration, never a key or URL taken from the request. */
  publicKeys: unknown;
}

export interface CloudAppIdentityRequest {
  assertion: string | undefined;
  method: string;
  requestURI: string;
  /** Exact bytes received from the gateway, before JSON parsing or normalization. */
  body: Uint8Array;
}

const invalid = () => new AppRequestIdentityError('APP_IDENTITY_INVALID');
const invalidConfig = () => new AppRequestIdentityError('APP_IDENTITY_CONFIGURATION_INVALID');
const appPattern = new RegExp(contract.appIDPattern);
const kidPattern = new RegExp(contract.keyIDPattern);
const methodPattern = new RegExp(contract.methodPattern);
const maxID = BigInt('9223372036854775807');
const validID = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maxID;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
const validString = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maxBytes &&
  Buffer.from(value).toString('utf8') === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const decode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw invalid();
  return bytes;
};

/** Verifies request provenance, not business authorization or delegated UNS permissions. */
export function createCloudAppRequestVerifier(authority: CloudAppIdentityAuthority) {
  if (!isObject(authority) || typeof authority.appID !== 'string' || !appPattern.test(authority.appID) || !validID(authority.workspaceID)) throw invalidConfig();
  const appID = authority.appID;
  const workspaceID = authority.workspaceID;
  const keys = new Map<string, KeyObject>();
  try {
    let raw = authority.publicKeys;
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw) > contract.maxTokenBytes * contract.maxKeys) throw invalidConfig();
      raw = JSON.parse(raw);
    }
    if (!isObject(raw) || !exactKeys(raw, ['keys']) || !Array.isArray(raw.keys) ||
        raw.keys.length === 0 || raw.keys.length > contract.maxKeys) throw invalidConfig();
    for (const key of raw.keys) {
      if (!isObject(key) || !exactKeys(key, contract.publicKeyFields) || key.kty !== 'OKP' ||
          key.crv !== 'Ed25519' || typeof key.kid !== 'string' || !kidPattern.test(key.kid) ||
          keys.has(key.kid) || typeof key.x !== 'string' || decode(key.x).length !== 32) throw invalidConfig();
      keys.set(key.kid, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x }, format: 'jwk' }));
    }
  } catch { throw invalidConfig(); }

  return (request: CloudAppIdentityRequest): VerifiedCloudAppUser => {
    try {
      if (typeof request.assertion !== 'string' || Buffer.byteLength(request.assertion) > contract.maxTokenBytes ||
          !(request.body instanceof Uint8Array) || request.body.byteLength > contract.maxBodyBytes ||
          !methodPattern.test(request.method) || !validString(request.requestURI, contract.maxURIBytes) ||
          !request.requestURI.startsWith('/') || request.requestURI.startsWith('//')) throw invalid();
      const parts = request.assertion.split('.');
      if (parts.length !== 3) throw invalid();
      const header: unknown = JSON.parse(decode(parts[0]).toString('utf8'));
      if (!isObject(header) || !exactKeys(header, contract.requiredHeaderFields) ||
          header.alg !== contract.algorithm || header.typ !== contract.type ||
          typeof header.kid !== 'string' || !kidPattern.test(header.kid)) throw invalid();
      const key = keys.get(header.kid);
      const signature = decode(parts[2]);
      if (!key || signature.length !== 64 ||
          !verify(null, Buffer.from(parts[0] + '.' + parts[1], 'ascii'), key, signature)) throw invalid();
      const claims: unknown = JSON.parse(decode(parts[1]).toString('utf8'));
      if (!isObject(claims) || !exactKeys(claims, contract.requiredClaims) ||
          claims.ver !== contract.version || claims.iss !== contract.issuer || claims.aud !== contract.audience ||
          !validID(claims.sub) || claims.workspaceID !== workspaceID || claims.appID !== appID ||
          claims.method !== request.method || claims.requestURI !== request.requestURI ||
          typeof claims.bodySHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(claims.bodySHA256) ||
          claims.bodySHA256 !== createHash('sha256').update(request.body).digest('hex') ||
          typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat <= 0 ||
          typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat ||
          claims.exp - claims.iat > contract.maxTTLSeconds ||
          typeof claims.jti !== 'string' || !/^[a-f0-9]{32}$/.test(claims.jti) ||
          !Array.isArray(claims.roles) || claims.roles.length > contract.maxRoles ||
          claims.roles.some((role) => !validString(role, contract.maxRoleBytes) || role.trim() !== role) ||
          new Set(claims.roles).size !== claims.roles.length) throw invalid();
      const now = Math.floor(Date.now() / 1000);
      if (claims.iat > now + contract.clockSkewSeconds || now >= claims.exp + contract.clockSkewSeconds) throw invalid();
      return Object.freeze({
        kind: 'gateway-user' as const, userID: claims.sub, workspaceID, appID,
        roleKeys: Object.freeze([...claims.roles] as string[]), requestID: claims.jti,
        issuedAt: claims.iat, expiresAt: claims.exp, verificationKeyID: header.kid,
      });
    } catch { throw invalid(); }
  };
}
