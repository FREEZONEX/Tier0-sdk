---
name: tier0-sdk-openapi-search
version: 0.5.0
description: "POST /openapi/v1/uns/search — search UNS nodes by keyword"
---

# search — `POST /openapi/v1/uns/search`

Searches node names by keyword. **Use search when you know a name fragment; use browse to explore the tree structure.**
`keyword` currently matches the node's short/leaf name, not intermediate path segments; to scope by path, use `path_prefix`.

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unssearch(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `keyword` | string | No | Keyword (matches node short/leaf names, not intermediate path segments); empty returns all nodes |
| `path_prefix` | string | No | Restrict search to a path prefix, e.g. `"Plant/Line1"` |
| `topicType` | string | No | Filter by data type: `Metric` / `Action` / `State` (leaf nodes only; backend accepts lowercase) |
| `include_metadata` | boolean | No | Return each node's field definitions (fields), topicType, description. **Add it when you need topic structure after searching** |
| `page` | integer | No | Page number, default 1 |
| `size` | integer | No | Page size, default 20 |

## Response Structure

> ⚠️ search responses use `data.objects[]`, **not** `data.results[]` and not `data.list[]`.

```typescript
{
  code: number;
  msg: string;
  data: {
    total: number;  // total matches
    page: number;
    size: number;
    objects: Array<{
      id: number;           // node ID (numeric)
      name: string;         // short node name (last segment)
      path: string;         // full path, e.g. "Plant/Line1/Metric/Temperature"
      topicType: string;    // "Metric" | "Action" | "State" | ""
      type: 'PATH' | 'TOPIC';  // PATH = folder node, TOPIC = data point (leaf)
      // only when include_metadata: true
      fields?: Array<{ name: string; type: string; unit?: string }>;
      description?: string;
    }>;
  };
}
```

## Examples

### Search by name

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unssearch({
  keyword: 'mixing',
});

console.log('Found', result.data.total, 'nodes');
for (const obj of result.data.objects) {
  console.log(obj.path, obj.topicType, obj.type);
  // "Choco_Factory/Production/State/mixing_tank_01"  "State"  "TOPIC"
}
```

### Search State nodes under a path

```typescript
const result = await unsApi.openapiv1unssearch({
  keyword: 'tank',
  path_prefix: 'Choco_Factory/Production',
  topicType: 'State',
});

for (const obj of result.data.objects) {
  console.log(obj.path);
}
```

### Inspect field definitions after searching (recommended)

When unsure which fields, types, and units a topic has, add `include_metadata`:

```typescript
const result = await unsApi.openapiv1unssearch({
  keyword: 'Temperature',
  topicType: 'Metric',
  include_metadata: true,
});

for (const obj of result.data.objects) {
  if (obj.type === 'TOPIC') {
    console.log(obj.path, obj.fields);
    // "Plant/Line1/Metric/Temperature"
    // [{ name: 'temperature', type: 'float', unit: '°C' }, ...]
  }
}
```

With `fields` in hand you can construct a correct `write` request, or parse a `read` response's `value` field by field.

### Paginate through all nodes

```typescript
let page = 1;
const size = 50;
let allObjects: typeof result.data.objects = [];

while (true) {
  const result = await unsApi.openapiv1unssearch({ page, size });
  allObjects.push(...result.data.objects);
  if (allObjects.length >= result.data.total) break;
  page++;
}
```
