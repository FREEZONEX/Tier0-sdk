---
name: tier0-sdk-openapi-flow-deploy
version: 0.5.0
description: "POST /openapi/v1/flow/deploy — deploy a Node-RED canvas (full replace, irreversible)"
---

# deploy — `POST /openapi/v1/flow/deploy`

> ⚠️ **High-risk operation**: deploy **fully replaces** the Node-RED canvas configuration, overwrites all nodes, and the Node-RED instance reloads immediately. **Irreversible.** Before executing you **must**:
> 1. Back up the current canvas via `flowApi.openapiv1flowflowdata()`
> 2. Confirm the target Flow ID (verify with `flowApi.openapiv1flowget()` first)
> 3. Confirm the flowsJson is valid
> 4. Show the user what will change and get explicit confirmation before executing

## SDK Call

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const result = await flowApi.openapiv1flowdeploy(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | integer | **Yes** | The Flow's DB primary key |
| `flowsJson` | string | **Yes** | **JSON string** of the Node-RED node array (without the tab node). Must include the existing `mqtt-broker` config node (keeping its `id`) |

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: {
    flowId: string;  // Node-RED internal flow id (tab id)
  };
}
```

## Example

### Standard deploy workflow (backup → modify → deploy)

```typescript
import { flowApi } from '@tier0/sdk/openapi';

// Step 1: back up the current canvas (mandatory).
const { data: { flows } } = await flowApi.openapiv1flowflowdata({ id: 42 });

// Step 2: locate the system-generated mqtt-broker node (must be preserved as-is).
const mqttBrokerNode = flows.find((n: any) => n.type === 'mqtt-broker');

// Step 3: build the new canvas (keep the mqtt-broker node).
const newFlows = [
  mqttBrokerNode,   // ⚠️ must be kept — it carries system credentials
  {
    id: 'new-node-1',
    type: 'function',
    z: 'tab-id',
    name: 'transform',
    func: 'msg.topic = "Plant/Line1/Metric/Temperature";\nmsg.payload = JSON.stringify({ temperature: msg.payload.temp });\nreturn msg;',
    outputs: 1,
    x: 400, y: 120,
    wires: [['mqtt-out-1']],
  },
  // ... other nodes
];

// Step 4: deploy (after user confirmation).
const result = await flowApi.openapiv1flowdeploy({
  id: 42,
  flowsJson: JSON.stringify(newFlows),
});

console.log('Deployed, Node-RED flow id:', result.data.flowId);
```

> **Key constraints**:
> - `flowsJson` is a JSON **string**, not an object — `JSON.stringify()` it
> - The existing `mqtt-broker` config node (same `id`) must be preserved, otherwise the MQTT connection fails
> - Always back up before deploy, and show the user the pending changes before executing
