---
name: tier0-sdk-openapi-flow-update
version: 0.5.0
description: "POST /openapi/v1/flow/update — update Flow metadata (name/description/favorite)"
---

# update — `POST /openapi/v1/flow/update`

Updates a Flow's metadata (name, description, favorite state). **Not for editing the Node-RED canvas** — that is `deploy`'s job.

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowupdate(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | integer | **Yes** | The Flow's DB primary key |
| `flowName` | string | No | New name (unique within the same type) |
| `description` | string | No | New description |
| `isFavorite` | integer | No | Favorite state: `1` = favorite, `2` = unfavorite (note: integer, not boolean) |
| `template` | string | No | Template identifier |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: { success: boolean };
}
```

## Examples

### Rename a Flow

```typescript
import { flowApi } from '@tier0/sdk/openapi';

await flowApi.openapiv1flowupdate({
  id: 42,
  flowName: 'modbus-line1-v2',
});
```

### Favorite / unfavorite

```typescript
// Favorite
await flowApi.openapiv1flowupdate({ id: 42, isFavorite: 1 });

// Unfavorite
await flowApi.openapiv1flowupdate({ id: 42, isFavorite: 2 });
```

### Update the description

```typescript
await flowApi.openapiv1flowupdate({
  id: 42,
  description: 'All line-1 Modbus points connected, 500 ms collection cycle',
});
```
