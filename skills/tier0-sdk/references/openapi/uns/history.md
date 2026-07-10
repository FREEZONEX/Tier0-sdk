---
name: tier0-sdk-openapi-history
version: 0.5.0
description: "POST /openapi/v1/uns/history — query UNS topic historical data"
---

# history — `POST /openapi/v1/uns/history`

**⚠️ The time format and aggregation parameters are highly error-prone. Read this file fully before calling.**

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unshistory(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `topics` | string[] | **Yes** | Topic paths (leaf nodes; wildcards not supported) |
| `start_time` | string | **Yes** | Start time, **ISO 8601 format**, e.g. `"2026-01-01T00:00:00Z"` |
| `end_time` | string | **Yes** | End time, **ISO 8601 format**, e.g. `"2026-01-02T00:00:00Z"` |
| `page` | integer | No | Page number, default 1 |
| `size` | integer | No | Page size, default 100 |
| `aggregation` | object | No | Aggregation config; omit to get raw data points |

### aggregation Structure

| Field | Type | Required | Description |
|------|------|------|------|
| `function` | string | **Yes** | Aggregation function: `avg` / `max` / `min` / `sum` / `count` |
| `interval` | string | **Yes** | Aggregation window: `1m` (minute) / `1h` (hour) / `1d` (day) |
| `field` | string | No | Field to aggregate (a key inside the `value` object, e.g. `"temperature"`) |

> **Time format**: `start_time`/`end_time` must be ISO 8601 strings — **millisecond integers are rejected**. The CLI supports relative time expressions (`-1h`, `-7d`), but the SDK calls the API directly, so convert relative times to ISO 8601 strings in your code.

## Response Structure

Batch endpoint: HTTP 200 does **not** mean every item succeeded. Check `data.success` and each `data.results[i].success`:

```typescript
{
  code: number;
  msg: string;
  data: {
    success: boolean;
    total: number;  // total record count
    page: number;
    size: number;
    results: Array<{
      success: boolean;
      topic: string;
      result?: {
        values: Array<{
          value: Record<string, unknown>;  // business data object
          quality: 'Good' | 'Uncertain' | 'Bad';
          timeStamp: number;              // collection time, milliseconds
        }>;
      };
      error?: { code: number; message: string };
    }>;
  };
}
```

## Examples

### Raw data for the last hour

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature'],
  start_time: oneHourAgo.toISOString(),  // "2026-06-15T10:00:00.000Z"
  end_time: now.toISOString(),
  size: 200,
});

const item = result.data.results[0];
if (item.success) {
  for (const record of item.result!.values) {
    const temp = record.value as { temperature: number };
    console.log(new Date(record.timeStamp), temp.temperature);
  }
}
```

### Hourly averages over 24 hours

```typescript
const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature'],
  start_time: '2026-06-14T00:00:00Z',
  end_time: '2026-06-15T00:00:00Z',
  aggregation: {
    function: 'avg',
    interval: '1h',
    field: 'temperature',  // key inside the value object
  },
});

if (result.data.success) {
  const values = result.data.results[0].result?.values ?? [];
  // Each value represents one hour's average.
  values.forEach(r => {
    console.log(new Date(r.timeStamp).toISOString(), r.value);
  });
}
```

### Multiple topics with pagination

```typescript
const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature', 'Plant/Line1/Metric/Humidity'],
  start_time: '2026-06-01T00:00:00Z',
  end_time: '2026-06-08T00:00:00Z',
  page: 1,
  size: 100,
});

for (const item of result.data.results) {
  if (!item.success) {
    console.error(`${item.topic} query failed: ${item.error?.message}`);
    continue;
  }
  console.log(`${item.topic}: ${item.result!.values.length} records`);
}
```

## Common Errors

| Error | Cause | Fix |
|------|------|------|
| `start_time` format error | A millisecond integer was passed (e.g. `1733382000000`) | Use an ISO string: `new Date(ts).toISOString()` |
| `aggregation.field` returns no data | Field name does not match the keys in the `value` object | `read` one record first to confirm the value field names |
| `values` is empty | No data in the time range, or wrong topic path | Confirm the topic exists and the time range is correct |
