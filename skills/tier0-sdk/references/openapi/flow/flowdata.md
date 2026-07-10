---
name: tier0-sdk-openapi-flow-flowdata
version: 0.5.0
description: "POST /openapi/v1/flow/flowdata — get a Flow's Node-RED canvas JSON"
---

# flowdata — `POST /openapi/v1/flow/flowdata`

Gets a Flow's current Node-RED canvas JSON (flowsJson). **Must be called to back up before every deploy.**

> ⚠️ **Node-RED does not export credentials**: in the returned JSON, the `mqtt-broker` node's `credentials` field is empty/missing, but Node-RED still stores the credentials internally (keyed by the node `id`). Deploys must preserve the existing `mqtt-broker` node's `id`, otherwise the connection fails.

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowflowdata(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | integer | **Yes** | The Flow's DB primary key |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: {
    rev: string;                    // Node-RED editor revision (usable for concurrency checks at deploy)
    flows: Record<string, unknown>[]; // Node-RED node array (without the tab node)
  };
}
```

## Examples

### Back up the current canvas

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowflowdata({ id: 42 });

const backup = result.data.flows;
// Save this backup before modifying; mandatory before deploy.

// Locate the system-generated mqtt-broker node (keep its id, never replace it).
const mqttBroker = backup.find(
  (node: any) => node.type === 'mqtt-broker' && node.name === 'emqx'
);
console.log('MQTT broker node id:', mqttBroker?.id);
```

### Modify the canvas and deploy

```typescript
// 1. Back up.
const { data: { flows, rev } } = await flowApi.openapiv1flowflowdata({ id: 42 });

// 2. Modify (keep the existing mqtt-broker node).
const updatedFlows = [
  ...flows,
  // add new nodes...
];

// 3. Deploy.
await flowApi.openapiv1flowdeploy({
  id: 42,
  flowsJson: JSON.stringify(updatedFlows),
});
```
