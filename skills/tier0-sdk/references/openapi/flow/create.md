---
name: tier0-sdk-openapi-flow-create
version: 0.5.0
description: "POST /openapi/v1/flow/create — create a Flow (system auto-generates MQTT credentials)"
---

# create — `POST /openapi/v1/flow/create`

Creates a new Flow (Node-RED container). **The system auto-generates dedicated MQTT credentials and injects them into the initial Node-RED canvas configuration.**

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowcreate(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `flowName` | string | **Yes** | Flow name, unique within the same type |
| `flowType` | string | **Yes** | `source` (data collection, connects industrial protocols) / `event` (event processing, subscribes to MQTT messages) |
| `description` | string | No | Description |
| `template` | string | No | Template source identifier |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: {
    id: number;  // DB primary key of the new Flow; use it for follow-up operations
  };
}
```

## Examples

### Create a SourceFlow

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowcreate({
  flowName: 'modbus-line1',
  flowType: 'source',
  description: 'Modbus TCP collection for line 1',
});

const flowId = result.data.id;
console.log('Created, Flow id:', flowId);

// After creating, use flowdata to fetch the initial canvas
// (it contains the system-generated MQTT broker node).
```

### Create an EventFlow

```typescript
const result = await flowApi.openapiv1flowcreate({
  flowName: 'alert-handler',
  flowType: 'event',
  description: 'Over-temperature alert handling',
});
```

> **Typical post-create workflow**: create → flowdata (fetch the initial canvas, including the MQTT broker node) → edit the canvas → deploy

### Clone from an existing Flow

```typescript
// 1. Export the reference Flow's canvas.
const { data: { flows } } = await flowApi.openapiv1flowflowdata({ id: 1 });

// 2. Create the new Flow.
const { data: { id: newId } } = await flowApi.openapiv1flowcreate({
  flowName: 'modbus-line2',
  flowType: 'source',
  description: 'Collection Flow cloned from line1',
});

// 3. Deploy the template canvas to the new Flow (confirm with the user before deploy).
await flowApi.openapiv1flowdeploy({
  id: newId,
  flowsJson: JSON.stringify(flows),
});
```
