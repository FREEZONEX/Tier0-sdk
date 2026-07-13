---
name: tier0-sdk-auth-whoami
version: 0.2.0
description: "SDK call auth whoami — inspect the user, workspace, roles, and permissions bound to the current API key"
---

# auth whoami — API Key Identity Diagnostics

Used to determine which user and Workspace the currently configured API key is bound to, and which roles and permissions it carries.

> `auth/whoami` is for diagnostics only; it is not a prerequisite for calling other APIs.

## API

```
POST /openapi/v1/auth/whoami
```

## Request Parameters

No business parameters — pass an empty object.

## SDK Call Example

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.openapiv1authwhoami();
console.log(result);
```

## Response Structure

```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "userID": 1,
    "userName": "agent",
    "email": "agent@example.com",
    "workspaceID": 1001,
    "workspaceName": "Default",
    "apiKeyName": "agent-key",
    "keyPrefix": "sk-per",
    "permissions": ["full_access"],
    "roles": ["admin"],
    "keyType": "personal"
  }
}
```

## Troubleshooting Rules

1. Use `workspaceID` / `workspaceName` to confirm the key is bound to the intended Workspace.
2. Use `permissions` to confirm the key has the permissions the target endpoint needs; `full_access` grants access to all OpenAPI resources.
3. Use `keyType` to distinguish personal / service keys.
4. If an endpoint returns 401, first check that `configureClient`'s apiKey is correct and the `apiHost` is reachable.
