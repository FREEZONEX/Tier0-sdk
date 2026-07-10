---
name: tier0-sdk-openapi-reload
version: 0.2.0
description: "GET /gw/reload — no request body"
---

# reload — `GET /gw/reload`

## SDK Call

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.gwreload();
```

## Request Parameters

| Field | Type | Description |
|------|------|------|
| — | — | This endpoint takes no request body |

## Response Type

`components["schemas"]["Response"]`

## Example

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.gwreload();
console.log(result);
```
