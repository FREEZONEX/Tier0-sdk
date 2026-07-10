---
name: tier0-sdk-openapi-delete
version: 0.5.0
description: "POST /openapi/v1/uns/delete — delete UNS nodes (soft/hard delete)"
---

# delete — `POST /openapi/v1/uns/delete`

> ⚠️ **High-risk operation**: hard delete (`hard_delete: true`) is irreversible and removes historical data as well. Default to soft delete (recoverable via `restore`) unless the user explicitly asks for a hard delete.

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsdelete(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `topics` | string[] | **Yes** | Full paths of the nodes to delete (leaf or folder) |
| `hard_delete` | boolean | No | `false` (default) = soft delete, recoverable via `restore`; `true` = hard delete, **irreversible**, also removes historical data |

## Response Structure

```typescript
{
  code: number;   // 200 = success
  msg: string;    // "success"
  data: {};       // empty object; success is judged by the outer code/msg
}
```

## Examples

### Soft delete (recoverable)

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsdelete({
  topics: ['Plant/Line1/Metric/Temperature'],
  // hard_delete defaults to false (soft delete)
});

if (result.code !== 200) {
  console.error('Delete failed:', result.msg);
}
```

### Hard delete (irreversible — requires explicit user confirmation)

```typescript
// ⚠️ Confirm with the user before hard-deleting; this cannot be undone.
const result = await unsApi.openapiv1unsdelete({
  topics: ['Plant/Line1/Metric/OldSensor'],
  hard_delete: true,
});
```

### Batch soft delete

```typescript
const result = await unsApi.openapiv1unsdelete({
  topics: [
    'Plant/Line1/Metric/Sensor1',
    'Plant/Line1/Metric/Sensor2',
  ],
});

// Batch delete: success is judged by code === 200 for the whole call.
console.log(result.code === 200 ? 'All deleted' : `Failed: ${result.msg}`);
```
