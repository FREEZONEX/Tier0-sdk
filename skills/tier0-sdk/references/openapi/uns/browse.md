---
name: tier0-sdk-openapi-browse
version: 0.5.0
description: "POST /openapi/v1/uns/browse — browse the UNS namespace tree"
---

# browse — `POST /openapi/v1/uns/browse`

**First choice when exploring an unknown path structure.** When you do not know the full topic path, browse first, then read/write.

> In application development, `browse` is for dev-time discovery or admin/diagnostics scenarios. It is not a basis for building a user-facing UNS tree page or a standalone UNS module. Business pages fetch data through services that use known topic paths; they do not expose the UNS hierarchy to users.

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsbrowse(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `path` | string | No | Starting path. Empty or omitted browses from the root |
| `include_metadata` | boolean | No | Return node displayName, fields, description and other metadata. **Recommended when learning a topic's structure for the first time** |
| `include_leaf_value` | boolean | No | Also return the current VQT value of leaf nodes (data points) |
| `max_depth` | integer | No | Maximum recursion depth, default 1 (expand one level) |

## Response Structure

> ⚠️ browse responses use `data.tree[]`, **not** `data.results[]`.
> ⚠️ `type` in **responses** is uppercase `'PATH' | 'TOPIC'`; in create **requests** it is lowercase `'path' | 'topic'`. They differ.

```typescript
{
  code: number;
  msg: string;
  data: {
    tree: Array<TreeNode>;
  };
}

interface TreeNode {
  id: number;           // node ID (numeric)
  name: string;         // short node name (last segment)
  path: string;         // full path, e.g. "Plant/Line1/Metric/Temperature"
  topicType: string;    // "Metric" | "Action" | "State" | "" (empty for folder nodes)
  type: 'PATH' | 'TOPIC';   // PATH = folder node, TOPIC = data point (leaf)
  children: TreeNode[]; // child nodes (returned when max_depth > 1 or default expansion)

  // Only returned when include_metadata: true
  alias?: string;
  displayName?: string;
  description?: string;
  enableHistory?: number;   // 1 = history on, 2 = off
  extendProperties?: Record<string, unknown>;
  fields?: Array<{
    name: string;
    type: 'STRING' | 'FLOAT' | 'INT' | 'BOOLEAN' | 'DATETIME';  // uppercase
    unit: string;
  }>;

  // Only returned when include_leaf_value: true (TOPIC nodes only)
  payload?: {
    value?: Record<string, unknown>;
    quality?: 'Good' | 'Uncertain' | 'Bad';
    timeStamp?: number;  // UNIX milliseconds
  };
}
```

## Examples

### List paths under the root

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsbrowse({});

for (const node of result.data.tree) {
  console.log(node.path, node.type);
  // "Choco_Factory"  PATH
  // "Plant"          PATH
}
```

### Children of a path, with field definitions

```typescript
const result = await unsApi.openapiv1unsbrowse({
  path: 'Choco_Factory/Production',
  include_metadata: true,
  max_depth: 2,
});

function walk(nodes: typeof result.data.tree) {
  for (const node of nodes) {
    if (node.type === 'TOPIC') {
      console.log(node.path, node.topicType, node.fields);
      // "Choco_Factory/Production/State/mixing_tank_01"
      //   "State"
      //   [{ name: "status", type: "STRING", unit: "" }, ...]
    }
    if (node.children?.length) walk(node.children);
  }
}
walk(result.data.tree);
```

### Current values of leaf nodes (browse + leaf value)

```typescript
const result = await unsApi.openapiv1unsbrowse({
  path: 'Choco_Factory/Production/State',
  include_leaf_value: true,
});

for (const node of result.data.tree) {
  if (node.type === 'TOPIC' && node.payload) {
    console.log(node.path, node.payload.value, node.payload.quality, node.payload.timeStamp);
  }
}
```

## UNS ↔ Flow Cross-Lookup

UNS topic paths and Flow names are **usually named alike**. After browsing to a path, if the user wants to know the data's origin (what collects/processes it), query the corresponding Flow as well:

```typescript
// 1. browse discovers the topic path
const browse = await unsApi.openapiv1unsbrowse({
  path: 'Plant/Line1',
  max_depth: 2,
});

// 2. Look up Flows by the same name (SourceFlow collects, EventFlow processes)
const flows = await flowApi.openapiv1flowlist({
  keyword: 'Line1',
});
```

> ⚠️ The API has no explicit relation field yet; a future `topicmeta` endpoint will provide the Flow ↔ topic mapping.
