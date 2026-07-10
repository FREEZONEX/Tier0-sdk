---
name: tier0-sdk-openapi-read
version: 0.5.0
description: "POST /openapi/v1/uns/read — read UNS topic current values (VQT structure)"
---

# read — `POST /openapi/v1/uns/read`

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsread(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `topics` | string[] | **Yes** | Topic paths; wildcards supported: `+` matches one level, `#` matches all remaining levels |
| `include_metadata` | boolean | No | Also return topicType, fields (field definitions), description and other metadata. **Strongly recommended when reading an unknown topic for the first time** |
| `include_leaf_value` | boolean | No | With wildcards, also return the current value of expanded leaf nodes |

## Response Structure

Batch endpoint: HTTP 200 does **not** mean every item succeeded. Check `data.success` and each `data.results[i].success`:

```typescript
{
  code: number;
  msg: string;
  data: {
    success: boolean;
    results: Array<{
      success: boolean;
      topic: string;
      result?: {
        // VQT structure
        value: Record<string, unknown> | null;  // business data object; null when Bad/GoodNoData
        quality: 'Good' | 'Uncertain' | 'Bad' | 'GoodNoData';
        timeStamp: number;  // collection time, milliseconds
      };
      metadata?: {           // only when include_metadata: true
        topicType: 'METRIC' | 'ACTION' | 'STATE';
        description: string;
        fields: Array<{ name: string; type: string; unit?: string }>;
      };
      error?: { code: number; message: string };
    }>;
  };
}
```

### quality Semantics

| quality | Meaning | value state |
|---------|------|-----------|
| `Good` | Value is valid and fresh | non-null |
| `Uncertain` | Trustworthiness in doubt | non-null |
| `Bad` | Data source disconnected/untrusted | `null` or last-known retained |
| `GoodNoData` | Topic is modeled but has never received data | `null` |

## Examples

### Read a single topic

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
});

const item = result.data.results[0];
if (item.success && item.result?.quality === 'Good') {
  const temp = item.result.value as { temperature: number; unit: string };
  console.log(temp.temperature); // 27.5
}
```

### First read — fetch field definitions at the same time

```typescript
const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
  include_metadata: true,
});

const item = result.data.results[0];
if (item.success) {
  console.log(item.metadata?.fields);
  // [{ name: 'temperature', type: 'float', unit: '°C' }, ...]
  console.log(item.result?.value);
  // { temperature: 27.5, unit: 'C' }
}
```

### Wildcard batch read

```typescript
const result = await unsApi.openapiv1unsread({
  topics: ['Plant/+/Metric/Temperature'],  // temperatures of all lines
});

for (const item of result.data.results) {
  if (!item.success) continue;
  if (item.result?.quality !== 'Good') continue;
  console.log(item.topic, item.result.value);
}
```

### Handle null value (data source disconnected)

```typescript
const item = result.data.results[0];
if (item.success) {
  if (item.result?.quality === 'Bad' || item.result?.quality === 'GoodNoData') {
    // Data unavailable; value is null.
    console.warn('Data unavailable:', item.result.quality);
  } else {
    // Good / Uncertain: value is usable.
    console.log(item.result?.value);
  }
}
```
