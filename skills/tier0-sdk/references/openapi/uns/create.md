---
name: tier0-sdk-openapi-create
version: 0.6.0
description: "POST /openapi/v1/uns/create — create UNS namespace nodes"
---

# create — `POST /openapi/v1/uns/create`

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `namespace` | NamespaceNode[] | **Yes** | Array of node trees; nest `children` to build hierarchy |

### NamespaceNode Structure

> ⚠️ `name` is a **single segment** and must not contain `/`. Express multi-level paths by nesting `children`; never put a full path into `name`.

| Field | Type | Required | Description |
|------|------|------|------|
| `name` | string | **Yes** | Single-segment node name without `/`, e.g. `"Production"`, `"mixing_tank_01"` |
| `type` | string | **Yes** | Node kind: `"path"` (folder) / `"topic"` (data point). Case-insensitive (`PATH`/`path` both accepted; legacy values `folder`/`file` still work). Responses return uppercase `PATH`/`TOPIC` |
| `topicType` | string | No (derived) | `"metric"` / `"action"` / `"state"`. **Derived automatically from the type folder (second-to-last path segment)** — omit it in new code. Passing it explicitly is still accepted for backward compatibility but logs a deprecation warning |
| `displayName` | string | No | Display name |
| `description` | string | No | Description; for action/state nodes, strongly recommended to include an example payload |
| `fields` | FieldDef[] | Required for metric | Field definitions. A metric without `fields` fails with `schema required for metric`. Optional for action/state but **strongly recommended**: when the payload top level is flat key-values (most commands/statuses are), declaring `fields` makes the topic's schema visible in UNS; cover nested parts that `fields` cannot express with an example payload in `description` |
| `enableHistory` | boolean | No | Whether to persist history |
| `children` | NamespaceNode[] | No | Child nodes, used to create multi-level structures in one call |

### FieldDef Structure

| Field | Type | Description |
|------|------|------|
| `name` | string | Field name; must not be `_timestamp` (system-reserved) |
| `type` | string | `"int"` / `"float"` / `"string"` / `"bool"` |
| `unit` | string | Unit (optional), e.g. `"°C"`, `"bar"` |

> **Naming rule (mandatory)**: node names must be stable, human-readable business names (`Temperature`, `Order`, `Packer01`). **Never** use UUIDs, database primary keys, timestamps, or other runtime-generated values as node names; **never** create topics dynamically per database row or business record (one topic per order/customer is wrong modeling). The namespace is a fixed schema designed once. Business entities use **one shared topic per entity type** with the instance id carried inside the payload — see `references/core/data-integration.md` for granularity rules.
>
> **Path rule (mandatory)**: the second-to-last segment of every data-point path must be a type folder: `Metric` / `Action` / `State` (case-insensitive):
> - `Plant/Line1/Metric/Temperature` ✓ (topicType derived: metric)
> - `Plant/WMS/Action/StockOut` ✓ (topicType derived: action)
> - `Plant/MES/State/OrderStatus` ✓ (topicType derived: state)
> - `Plant/Line1/Temperature` ✗ (missing type folder)
>
> The type folder is **not inserted automatically** — segments you did not write will not appear in the path.

## Response Structure

Batch endpoint: HTTP 200 does **not** mean every node was created. Check `data.success` and each `data.results[i].success`:

```typescript
{
  code: number;
  msg: string;
  data: {
    success: boolean;
    results: Array<{
      success: boolean;
      topic: string;       // full path of the created node
      error?: { code: number; message: string };
    }>;
  };
}
```

## Examples

### Create a single Metric data point

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate({
  namespace: [
    {
      name: 'Plant',
      type: 'path',
      children: [
        {
          name: 'Line1',
          type: 'path',
          children: [
            {
              name: 'Metric',
              type: 'path',
              children: [
                {
                  name: 'Temperature',
                  type: 'topic',
                  displayName: 'Line 1 Temperature',
                  fields: [
                    { name: 'temperature', type: 'float', unit: '°C' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

if (!result.data.success) {
  for (const item of result.data.results) {
    if (!item.success) {
      console.error(`Create failed ${item.topic}: ${item.error?.message}`);
    }
  }
}
```

### Create a full production tree in one call (all three topic types)

```typescript
const result = await unsApi.openapiv1unscreate({
  namespace: [
    {
      name: 'Choco_Factory',
      type: 'path',
      children: [
        {
          name: 'Production',
          type: 'path',
          children: [
            {
              name: 'Metric',
              type: 'path',
              children: [
                {
                  name: 'OvenTemp',
                  type: 'topic',
                  fields: [{ name: 'temperature', type: 'float', unit: '°C' }],
                },
              ],
            },
            {
              name: 'Action',
              type: 'path',
              children: [
                {
                  name: 'StartBatch',
                  type: 'topic',
                  // Declare fields on action/state too so the schema is visible in UNS.
                  fields: [
                    { name: 'batch_id', type: 'string' },
                    { name: 'recipe', type: 'string' },
                    { name: 'qty', type: 'int' },
                  ],
                  description: 'Start-batch command. Example: {"batch_id":"B-001","recipe":"dark_choco","qty":500}',
                },
              ],
            },
            {
              name: 'State',
              type: 'path',
              children: [
                {
                  name: 'BatchStatus',
                  type: 'topic',
                  fields: [
                    { name: 'batch_id', type: 'string' },
                    { name: 'status', type: 'string' },
                    { name: 'progress', type: 'int' },
                  ],
                  description: 'Batch status report. Example: {"batch_id":"B-001","status":"running","progress":42}',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
```

## Common Errors

| Symptom | Cause | Fix |
|------|------|------|
| `segment before leaf must be a type folder` | The segment before the leaf is not Metric/Action/State | Add the type folder before the leaf name, e.g. `.../Metric/ProductionCount` |
| `a topic node needs at least two segments` | Path has only one segment, missing the type folder | Write at least `Metric/Count`, never just `Count` |
| `metric schema does not allow deleting fields: {field}` | A metric node was sent with fewer `fields` than it already has | Metric fields are add-only; include all existing fields when updating |
| `schema required for metric` / empty metric definition | Metric node sent with missing or empty `fields` | Metric nodes must declare `fields` |
| `field type cannot be changed: {field}` | The `type` of an existing field was modified | Field types are immutable once created |
