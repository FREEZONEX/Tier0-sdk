---
name: tier0-sdk-openapi-flow-list
version: 0.5.0
description: "POST /openapi/v1/flow/list — list Flows"
---

# list — `POST /openapi/v1/flow/list`

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowlist(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `flowType` | string | No | Filter by type: `source` (data-collection Flow) / `event` (event-processing Flow). Omit for all |
| `keyword` | string | No | Filter by name keyword |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: {
    list: Array<{
      id: number;                  // DB primary key; use this id for all CLI/API operations
      flowId: string;              // Node-RED internal flow id (tab id), internal use only
      flowName: string;
      flowType: 'source' | 'event';
      flowStatus: 'DRAFT' | 'PENDING' | 'RUNNING';
      description: string;
      isFavorite: number;          // 1 = favorited, 2 = not favorited
      currentVersionId: number;
      currentVersionName: string;
      createdTime: number;         // millisecond timestamp
      updatedTime: number;
    }>;
  };
}
```

> ⚠️ **`id` ≠ `flowId`**: all follow-up operations (get/update/delete/deploy) use the integer `id`. `flowId` is a Node-RED internal string and must not be used as an API parameter.

## Examples

### List all Flows

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowlist({});

for (const flow of result.data.list) {
  console.log(flow.id, flow.flowName, flow.flowType, flow.flowStatus);
}
```

### List only SourceFlows

```typescript
const result = await flowApi.openapiv1flowlist({
  flowType: 'source',
});
```

### Search by name (often paired with a UNS lookup)

```typescript
const result = await flowApi.openapiv1flowlist({
  keyword: 'modbus',
});
const flow = result.data.list[0];
if (flow) {
  console.log(`Found Flow id=${flow.id}, status=${flow.flowStatus}`);
}
```

When a user asks about a device/data point by name, Flow names and UNS topics are usually named alike — query both sides:

```typescript
const [unsResult, flowResult] = await Promise.all([
  unsApi.openapiv1unssearch({ keyword: 'Line1', topicType: 'Metric' }),
  flowApi.openapiv1flowlist({ keyword: 'Line1' }),
]);
```
