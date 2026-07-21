---
name: tier0-sdk-configuration
version: 0.1.1
description: "Tier0 SDK configuration for Node.js, browser/Vite, OpenAPI, and MQTT."
---

# Configuration

Read this file before writing code that connects to Tier0 or configures any Tier0 runtime value.

Use it when setting up API hosts, API keys, MQTT hosts, browser builds, client initialization, credential handling, or secret handling. Read it before `references/openapi/quickstart.md`, `references/mq/quickstart.md`, framework references, or endpoint references whenever the task involves a live Tier0 connection.

## Version — Always Use The Latest

Check and update the SDK to the latest published version every time before you use it. The SDK's API surface, endpoints, and types evolve; a stale version leads to wrong signatures and missing endpoints.

```bash
npm view @tier0/sdk version        # latest published version
npm ls @tier0/sdk                  # version currently installed
npm install @tier0/sdk@latest      # update to latest
```

MonoApp/scaffold caveat: do not run `npm install` manually inside the scaffold — its install is managed (running it manually can corrupt `node_modules` on the shared volume). Instead, set `@tier0/sdk` to the latest version in `package.json` and let the managed install / preview restart apply it.

## OpenAPI

The OpenAPI client needs:

| Value | Node.js environment | Explicit config |
|---|---|---|
| API base URL | `TIER0_API_HOST` | `configureClient({ apiHost })` |
| API key | `TIER0_API_KEY` | `configureClient({ apiKey })` |

Prefer complete URLs with scheme. The platform or deployment should inject these values; do not hard-code environment-specific hosts in reusable code or skills:

```bash
TIER0_API_HOST=https://<your-tier0-api-host>
TIER0_API_KEY=<your-api-key>
```

## Current Project

Tier0 application runtimes inject `TIER0_PROJECT_ID`. Read it through the SDK instead of hard-coding a project name or ID:

```typescript
import { getCurrentProjectId } from '@tier0/sdk';

const projectId = getCurrentProjectId();
```

The value is always exposed as a string: Cloud uses a UUID, while Enterprise uses its local numeric ID serialized as a string. An app imported into Enterprise receives the target Enterprise project ID, not the source Cloud project ID.

Call `getCurrentProjectId()` from server/runtime code. Browser bundles cannot read Node.js `process.env` automatically.

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
- For TLS/cloud brokers, prefer a full injected `wss://host:port/mqtt` URL. Do not hard-code a broker host; use `TIER0_MQTT_HOST` / `TIER0_MQTT_PORT` or runtime config supplied by the platform.

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  host: process.env.TIER0_MQTT_HOST,
  port: process.env.TIER0_MQTT_PORT ? Number(process.env.TIER0_MQTT_PORT) : undefined,
  password: process.env.TIER0_API_KEY,
});
```

The MQ username and client ID are generated from the API key workspace segment when possible. Override `username` and `clientId` only when the broker requires custom values.

Use OpenAPI `unsApi.openapiv1unswrite()` for UNS current-value writes. The MQ client publishes raw broker messages and does not guarantee that OpenAPI `read`/`browse` latest values will update.
