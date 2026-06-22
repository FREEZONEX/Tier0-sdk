---
name: tier0-sdk-configuration
version: 0.1.0
description: "Tier0 SDK configuration for Node.js, browser/Vite, OpenAPI, and MQTT."
---

# Configuration

Read this file before writing code that connects to Tier0 or configures any Tier0 runtime value.

Use it when setting up API hosts, API keys, MQTT hosts, browser builds, client initialization, credential handling, or secret handling. Read it before `references/openapi/quickstart.md`, `references/mq/quickstart.md`, framework references, or endpoint references whenever the task involves a live Tier0 connection.

## OpenAPI

The OpenAPI client needs:

| Value | Node.js environment | Explicit config |
|---|---|---|
| API base URL | `TIER0_API_HOST` | `configureClient({ apiHost })` |
| API key | `TIER0_API_KEY` | `configureClient({ apiKey })` |

Prefer complete URLs with scheme:

```bash
TIER0_API_HOST=https://tier0-eks-frontend.tier0.dev
TIER0_API_KEY=sk-...
```

If `apiHost` has no scheme, the SDK normalizes it as `http://<host>`. For cloud deployments, pass `https://...` explicitly.

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  apiHost: process.env.TIER0_API_HOST,
  apiKey: process.env.TIER0_API_KEY,
});
```

## Browser and Vite

The SDK does not automatically read `VITE_*` variables at runtime. In Vite/browser code, pass values explicitly from `import.meta.env`.

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  apiHost: import.meta.env.VITE_TIER0_API_HOST,
  apiKey: import.meta.env.VITE_TIER0_API_KEY,
});
```

Do not expose long-lived production API keys in browser apps unless the deployment is explicitly designed for that trust model. Prefer short-lived or scoped keys when available.

## Dynamic Configuration

Use getters when the host or key can rotate:

```typescript
configureClient({
  getApiHost: () => process.env.TIER0_API_HOST,
  getApiKey: () => getKeyFromSecureStore(),
});
```

## MQTT

The MQ client needs:

| Value | Node.js environment | Explicit config |
|---|---|---|
| MQTT WebSocket host | `TIER0_MQTT_HOST` | `new Tier0MQClient({ host })` |
| MQTT WebSocket port | `TIER0_MQTT_PORT` | `new Tier0MQClient({ port })` |
| API key as MQTT password | `TIER0_API_KEY` | `new Tier0MQClient({ password })` |

Host normalization:

- If `host` starts with `ws://` or `wss://`, the SDK uses it directly and appends `/mqtt` if missing.
- If `host` has no WebSocket scheme, the SDK builds `ws://<host>:<port>/mqtt`.
- For TLS/cloud brokers, pass a full `wss://.../mqtt` URL explicitly.

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  host: 'wss://mqtt.example.com/mqtt',
  password: process.env.TIER0_API_KEY,
});
```

The MQ username and client ID are generated from the API key workspace segment when possible. Override `username` and `clientId` only when the broker requires custom values.
