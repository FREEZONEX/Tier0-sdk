---
name: tier0-sdk-openapi-restore
version: 0.5.0
description: "POST /openapi/v1/uns/restore — restore a soft-deleted UNS node"
---

# restore — `POST /openapi/v1/uns/restore`

Restores a soft-deleted node (`hard_delete: false`) back to an active state. **Hard-deleted nodes cannot be restored.**

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsrestore(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `path` | string | **Yes** | Full path of the node to restore (must currently be soft-deleted) |

## Response Structure

```typescript
{
  code: number;   // 200 = success
  msg: string;    // "success"
  data: {};       // empty object; success is judged by the outer code/msg
}
```

## Example

```typescript
import { unsApi } from '@tier0/sdk/openapi';

// Precondition: the node was soft-deleted via delete (hard_delete: false).
const result = await unsApi.openapiv1unsrestore({
  path: 'Plant/Line1/Metric/Temperature',
});

if (result.code === 200) {
  console.log('Node restored');
} else {
  console.error('Restore failed:', result.msg, '(node may have been hard-deleted or the path does not exist)');
}
```

> **Note**: restoring a node that was never deleted, or was hard-deleted, returns an error.
