---
name: tier0-sdk-openapi-write
version: 0.5.0
description: "POST /openapi/v1/uns/write — write data points (VQT) to UNS topics"
---

# write — `POST /openapi/v1/uns/write`

## SDK Call

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unswrite(body);
```

## Request Parameters

| Field | Type | Required | Description |
|------|------|------|------|
| `writes` | WriteItem[] | **Yes** | Write items, one per topic |
| `qos` | integer | No | MQTT QoS (0/1/2), default 0, applies to all writes in this call |
| `retain` | boolean | No | MQTT retain flag, default false. When true, new subscribers immediately receive the topic's last retained message on connect |

### WriteItem Structure

| Field | Type | Required | Description |
|------|------|------|------|
| `topic` | string | **Yes** | Full path of the target topic (leaf node); wildcards not supported |
| `value` | object | **Yes** | **Must be an object** whose keys match the topic's `fields` definition. Never a bare number/string |
| `quality` | string | No | Data quality: `Good` / `Uncertain` / `Bad`; defaults to platform-set value based on broker ack |
| `timeStamp` | integer | No | Collection time, **millisecond** timestamp. Server fills current time when omitted |

> ⚠️ **Never write `_timestamp` inside `value`** — `_timestamp` is the system persistence-time field. To record collection time, use the top-level `timeStamp` field of WriteItem.
>
> **Note**: a successful write only means the MQTT broker accepted the message, not that downstream execution completed. To confirm the result of a command, `read` the corresponding State topic.

## Response Structure

HTTP 200 plus outer `code: 200` does **not** mean all writes succeeded. Check `data.success` and each `data.results[i].success`:

```typescript
{
  code: number;      // HTTP-level status; 200 only means the request arrived
  msg: string;
  data: {
    success: boolean;   // whether every item succeeded
    results: Array<{
      success: boolean; // per-item success
      topic: string;
      // no extra fields on success; error present on failure
      error?: { code: number; message: string };
    }>;
  };
}
```

## Examples

### Write a single topic

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unswrite({
  writes: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      value: { temperature: 27.5 },
    },
  ],
});

if (!result.data.success) {
  for (const item of result.data.results) {
    if (!item.success) {
      console.error(`Write failed ${item.topic}: ${item.error?.message}`);
    }
  }
}
```

### Batch write with collection timestamps

```typescript
const result = await unsApi.openapiv1unswrite({
  qos: 1,
  writes: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      value: { temperature: 27.5, humidity: 58.6 },
      timeStamp: Date.now(),
    },
    {
      topic: 'Plant/Line1/Metric/Pressure',
      value: { pressure: 1.013 },
      timeStamp: Date.now(),
    },
  ],
});
```

### Confirm the schema before writing (recommended)

When unsure about a topic's field definitions, browse first, then write:

```typescript
// 1. Look up the schema.
const browse = await unsApi.openapiv1unsbrowse({
  path: 'Plant/Line1/Metric/Temperature',
  include_metadata: true,
});
// browse.data.tree[0].fields contains the field definitions (include_metadata: true)

// 2. Build value according to fields, then write.
await unsApi.openapiv1unswrite({
  writes: [{ topic: 'Plant/Line1/Metric/Temperature', value: { temperature: 27.5 } }],
});
```

## Common Errors

| Error | Cause | Fix |
|------|------|------|
| `success: false` + schema validation | `value` keys do not match the fields definition, or types mismatch | browse with `include_metadata` first to confirm fields |
| `success: false` + topic not found | Topic path does not exist or is misspelled | browse/search first to confirm the full path |
| Scalar `value` rejected | `value: 27.5` instead of `value: { temperature: 27.5 }` | `value` must be an object |
