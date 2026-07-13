---
name: tier0-sdk-flow-nodes
version: 0.5.0
description: "SDK call flow nodes — query available Node-RED node types"
---

# flow nodes — Available Node Query

Before constructing flowsJson, query the actual node types available for the target Flow type in the current Workspace.

> **Key**: every node object's `"type"` in flowsJson must exactly match a value from the `types` returned by `/flow/nodes`, otherwise Node-RED cannot recognize it.

## API

```
POST /openapi/v1/flow/nodes
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `flowType` | string | Yes | `SourceFlow` or `EventFlow`; backend also accepts `source` / `event` |

## SDK Call Example

```typescript
import { flowApi } from '@tier0/sdk/openapi';

// Query nodes available to SourceFlows
const sourceNodes = await flowApi.openapiv1flownodes({
  flowType: 'SourceFlow',
});
console.log(sourceNodes);

// Query nodes available to EventFlows
const eventNodes = await flowApi.openapiv1flownodes({
  flowType: 'EventFlow',
});
console.log(eventNodes);
```

## Response Structure

```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "nodes": [
      {
        "id": "node-red",
        "name": "Node-RED nodes",
        "types": ["inject", "debug", "function"],
        "enabled": true,
        "module": "node-red",
        "version": "x.y.z"
      }
    ]
  }
}
```

## Usage Rules

1. Only use strings from `data.nodes[].types[]` as node `type` values in flowsJson.
2. Do not use node sets with `enabled=false` in new canvases.
3. The same node type may differ between `SourceFlow` and `EventFlow`; query per target Flow type.
4. Results from this endpoint take precedence over any static reference table.
