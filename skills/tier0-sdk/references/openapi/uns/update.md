---
name: tier0-sdk-openapi-update
version: 0.5.0
description: "POST /openapi/v1/uns/update — update UNS node metadata (field definitions/description/name)"
---

# update — `POST /openapi/v1/uns/update`

Updates a node's metadata (field definitions, description, display name, etc.). **Not for writing VQT data** — that is `write`'s job.

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsupdate(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `path` | string | **Yes** | Full path of the target node |
| `fields` | FieldDef[] | No | New field definitions (metric nodes only). **Full-replace semantics**, see "fields Update Rules" below |
| `description` | string | No | New description |
| `displayName` | string | No | New display name |
| `alias` | string | No | Alias |
| `updateMask` | string[] | No | Names of the fields to update. Recommended to pass explicitly, e.g. `["description"]`, `["displayName","description"]`, or `["fields"]`, so the backend does not touch properties you did not intend to change |
| `extendProperties` | object | No | Custom extension properties (key-value pairs) |

### fields Update Rules (Important)

`fields` uses **full-replace** semantics: the submitted list completely overwrites the existing schema. Node types differ in what they allow:

| Operation | Metric node | State / Action node |
|------|------------|-------------------|
| Add a field | ✅ Allowed | ✅ Allowed |
| Remove a field (submit fewer than existing) | ❌ **Error** | ✅ Allowed |
| Change a field's `type` | ❌ **Error** | ❌ **Error** |
| Change a field's `unit` | ✅ Allowed | ✅ Allowed |
| Rename a field (change `name`) | ❌ Equivalent to remove+add, **error** | ⚠️ Equivalent to remove+add |

**Metric nodes are add-only**: you can only append new fields. Always include every existing field in the submitted list — no removals, no type changes, no renames.

> **Example (adding a field to a metric):**
> Existing fields: `[{name:"temperature", type:"float"}]`
> Correct: submit `[{name:"temperature", type:"float"}, {name:"humidity", type:"float"}]` (existing + new)
> Wrong: submit only `[{name:"humidity", type:"float"}]` (missing the existing `temperature` field → error `metric schema does not allow deleting fields: temperature`)

### FieldDef Structure

| Field | Type | Description |
|------|------|------|
| `name` | string | Field name; must not be `_timestamp` (system-reserved) |
| `type` | string | `int` / `float` / `string` / `bool` |
| `unit` | string | Unit (optional) |

## Response Structure

```typescript
{
  code: number;   // 200 = success
  msg: string;    // "success"
  data: {};       // empty object; success is judged by the outer code/msg
}
```

## Examples

### Update only the description (precise control via updateMask)

```typescript
import { unsApi } from '@tier0/sdk/openapi';

await unsApi.openapiv1unsupdate({
  path: 'Plant/Line1/Metric/Temperature',
  description: 'Line 1 temperature sensor, range -20 to 80 °C',
  updateMask: ['description'],  // only description; fields untouched
});
```

### Update field definitions (append new fields)

```typescript
await unsApi.openapiv1unsupdate({
  path: 'Plant/Line1/Metric/Temperature',
  fields: [
    { name: 'temperature', type: 'float', unit: '°C' },
    { name: 'unit', type: 'string' },
    { name: 'status', type: 'string' },  // new field
  ],
  updateMask: ['fields'],
});
```

### Update several properties at once

```typescript
await unsApi.openapiv1unsupdate({
  path: 'Plant/Line1/Metric/Temperature',
  displayName: 'Line 1 Temperature (calibrated)',
  description: 'Calibrated temperature sensor data',
  updateMask: ['displayName', 'description'],
});
```
