// Generated from SWE gatewayheader/app-request-identity.v1.json; do not edit.
// Source SHA-256: ac5ec2efb882395e63a46c9ec479de16c09943b88fc0bd906dd77c7f9f4bfaa3
export const APP_REQUEST_IDENTITY_CONTRACT = {
  "version": "tier0.app-request-identity/v1",
  "header": "X-Tier0-App-Identity",
  "type": "tier0-app-request+jwt",
  "algorithm": "EdDSA",
  "issuer": "tier0-app-gateway",
  "audience": "tier0-app-runtime",
  "maxTokenBytes": 8192,
  "maxBodyBytes": 65536,
  "maxURIBytes": 8192,
  "maxTTLSeconds": 30,
  "clockSkewSeconds": 5,
  "maxRoles": 32,
  "maxRoleBytes": 128,
  "maxKeys": 8,
  "keyIDPattern": "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$",
  "appIDPattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
  "requiredClaims": [
    "ver",
    "iss",
    "aud",
    "sub",
    "workspaceID",
    "appID",
    "method",
    "requestURI",
    "bodySHA256",
    "iat",
    "exp",
    "jti",
    "roles"
  ],
  "methodPattern": "^[A-Z]{1,16}$",
  "requiredHeaderFields": [
    "alg",
    "typ",
    "kid"
  ],
  "publicKeyFields": [
    "kty",
    "crv",
    "x",
    "kid"
  ]
} as const;
