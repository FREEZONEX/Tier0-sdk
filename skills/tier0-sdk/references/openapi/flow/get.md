---
name: tier0-sdk-openapi-flow-get
version: 0.5.0
description: "POST /openapi/v1/flow/get — get a single Flow's details"
---

# get — `POST /openapi/v1/flow/get`

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowget(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | integer | **Yes** | The Flow's DB primary key (integer), obtained from `list` |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: {
    id: number;
    flowId: string;              // Node-RED internal id, internal use only
    flowName: string;
    flowType: 'source' | 'event';
    flowStatus: 'DRAFT' | 'PENDING' | 'RUNNING';
    description: string;
    isFavorite: number;          // 1 = favorited, 2 = not favorited
    currentVersionId: number;
    currentVersionName: string;
    currentVersionType: string;
    createdTime: number;
    updatedTime: number;
  };
}
```

## Example

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowget({ id: 42 });

const flow = result.data;
console.log(flow.flowName, flow.flowStatus);
// modbus-line1  RUNNING
```
