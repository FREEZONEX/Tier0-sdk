---
name: tier0-sdk-openapi-quickstart
version: 0.1.1
description: "OpenAPI module quickstart: configuration, configureClient, basic API calls"
---

# OpenAPI Quickstart

> UNS is a data source, not a UI. The calls below are how you get/put data; keep topic paths and raw responses in a service/data layer and render business domain objects. `browse`/`search` are for dev-time discovery, not for building a user-facing namespace tree. See `references/core/concepts.md` → "UNS In Applications".

## Configuration

In Node.js, the SDK can read `TIER0_*` environment variables.

| Variable | Required | Description |
|------|------|------|
| `TIER0_API_HOST` | Yes | OpenAPI base URL injected by the platform/deployment, preferably including scheme |
| `TIER0_API_KEY` | Yes | API key |

For browser/Vite projects, pass values explicitly from `import.meta.env`; do not rely on automatic `VITE_*` lookup.

### Runtime Configuration

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  apiHost: process.env.TIER0_API_HOST,
  apiKey: process.env.TIER0_API_KEY,
});
```

### Dynamic Configuration

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  getApiHost: () => process.env.TIER0_API_HOST,
  getApiKey: () => {
    // Read from secure storage or an auth service.
    return localStorage.getItem('tier0_api_key') || undefined;
  },
});
```

## Basic Calls

### Read UNS Current Values

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
});

// HTTP 200 does not mean every item succeeded; check results[i].success.
const item = result.data.results[0];
if (item.success && item.result?.quality === 'Good') {
  // item.result.value: business object, e.g. { temperature: 27.5 }
  // item.result.timeStamp: timestamp in milliseconds
  console.log(item.result.value);
}
```

### Browse Namespace

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const nodes = await unsApi.openapiv1unsbrowse({
  path: 'Plant/Line1',
  include_metadata: true,
});
```

### Write Data

```typescript
import { unsApi } from '@tier0/sdk/openapi';

// value must be an object; do not write bare numbers/strings.
// Use top-level timeStamp for collection time; do not put _timestamp in value.
const result = await unsApi.openapiv1unswrite({
  writes: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      value: { temperature: 27.5 },
      timeStamp: Date.now(),
    },
  ],
});

// Check business results.
if (!result.data.success) {
  result.data.results.filter(r => !r.success)
    .forEach(r => console.error(r.topic, r.error?.message));
}
```

### List Flows

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const flows = await flowApi.openapiv1flowlist({
  flowType: 'source',
});
```

### Upload / Download / Delete Files

```typescript
import { uploadFile, downloadFile, getFileUrl, deleteFile } from '@tier0/sdk/files';

// Upload
const uploaded = await uploadFile(file, { visibility: 'private', business: 'attachment' });

// Get URL (public returns long-lived URL; private returns presigned URL)
const { fileUrl } = await getFileUrl({ filePath: uploaded.filePath, expiredSec: 3600 });

// Download to browser/Node.js
const { response } = await downloadFile({ filePath: uploaded.filePath });

// Delete
await deleteFile({ filePath: uploaded.filePath });
```

> See `references/openapi/files/*.md` for parameter details and advanced usage.

## Types

Types are exported from the OpenAPI module:

```typescript
import type { components } from '@tier0/sdk/openapi';

type BrowseReq = components['schemas']['BrowseReq'];
type FlowInfo = components['schemas']['FlowInfo'];
```

## Error Handling

Handle two error layers:

```typescript
import { unsApi } from '@tier0/sdk/openapi';

// Layer 1: network/auth errors -> try/catch
try {
  const result = await unsApi.openapiv1unsread({
    topics: ['Plant/Line1/Metric/Temperature'],
  });

  // Layer 2: per-item business errors -> check results[i].success
  for (const item of result.data.results) {
    if (!item.success) {
      console.error(`${item.topic} failed: ${item.error?.message}`);
    }
  }
} catch (error) {
  if (error instanceof Error) {
    // HTTP 4xx/5xx or network error
    console.error(error.message); // "HTTP 401: Unauthorized"
  }
}
```
