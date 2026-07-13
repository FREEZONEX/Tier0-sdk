---
name: tier0-sdk-openapi-flow-delete
version: 0.5.0
description: "POST /openapi/v1/flow/delete — delete Flows (stops the Node-RED container)"
---

# delete — `POST /openapi/v1/flow/delete`

> ⚠️ **High-risk operation**: deleting a Flow **stops its Node-RED container** — collection/processing halts immediately and the operation is irreversible. Confirm with the user before executing.

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowdelete(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `ids` | integer[] | **Yes** | Array of Flow DB primary keys (integers); batch supported. **Not the `flowId` string** |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: { success: boolean };
}
```

## Examples

### Delete a single Flow (confirm with the user first)

```typescript
import { flowApi } from '@tier0/sdk/openapi';

// ⚠️ Confirm before executing: the Node-RED container stops and data collection halts.
const result = await flowApi.openapiv1flowdelete({
  ids: [42],
});

if (result.data.success) {
  console.log('Flow deleted, Node-RED container stopped');
}
```

### Batch delete

```typescript
await flowApi.openapiv1flowdelete({
  ids: [42, 43, 44],
});
```

> **Typical sequence**: `list` to confirm the `id`, show the user the names and statuses of the Flows to be deleted, then call delete after confirmation.
