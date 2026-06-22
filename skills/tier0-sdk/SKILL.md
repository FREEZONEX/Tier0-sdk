---
name: tier0-sdk
version: 0.2.1
description: "Tier0 SDK for TypeScript/JavaScript agents. Use when building apps or scripts with @tier0/sdk to call Tier0 OpenAPI, manage UNS topics and Flow resources, or subscribe/publish MQTT over WebSocket. Covers Node.js, browser/Vite, React, Vue3, OpenAPI, UNS, Flow, MQ, MQTT, and WebSocket usage."
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, rest, api, uns, flow, mq, mqtt, websocket, react, vue3, typescript]
---

# Tier0 SDK

Use `@tier0/sdk` when code must call Tier0 from TypeScript or JavaScript.

```bash
npm install @tier0/sdk
```

Modules:

| Module | Import | Use for |
|---|---|---|
| OpenAPI | `@tier0/sdk/openapi` | UNS read/write/history/search/create/delete, Flow CRUD/deploy/data, system info/auth |
| MQ | `@tier0/sdk/mq` | MQTT over WebSocket subscribe/publish for realtime UNS and device messages |
| React | `@tier0/sdk/openapi/react` | React Query hooks; requires `@tanstack/react-query` |
| Vue | `@tier0/sdk/openapi/vue` | Vue 3 composables; requires `vue` |

For CLI command-line work, use the Tier0 CLI skill instead of this SDK skill.

## Minimal Configuration

Node.js can use environment variables:

```bash
TIER0_API_HOST=https://tier0-eks-frontend.tier0.dev
TIER0_API_KEY=sk-...
TIER0_MQTT_HOST=wss://mqtt.example.com/mqtt
```

OpenAPI can also be configured explicitly:

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  apiHost: 'https://tier0-eks-frontend.tier0.dev',
  apiKey: process.env.TIER0_API_KEY,
});
```

Browser/Vite projects should pass values explicitly from `import.meta.env`; do not assume the SDK can automatically read `VITE_*` variables at runtime.

```typescript
configureClient({
  apiHost: import.meta.env.VITE_TIER0_API_HOST,
  apiKey: import.meta.env.VITE_TIER0_API_KEY,
});
```

Read `references/setup/configuration.md` when setting up environments, browser builds, API hosts, MQTT hosts, or secrets.

## Non-Negotiable Rules

OpenAPI:

1. Configure `apiHost` and `apiKey` before calling APIs.
2. Batch endpoints can return HTTP 200 and outer `code: 200` while individual items fail. Always check `data.success` and each `data.results[i].success` when present.
3. UNS `read`, `write`, and `history` operate on leaf topic paths only. Browse/search first; do not read/write folder paths.
4. UNS topic paths must place `Metric`, `Action`, or `State` immediately before the leaf: `Plant/Line1/Metric/Temperature`.
5. `write.value` must be an object matching the topic fields. Do not write scalar values and do not put `_timestamp` inside `value`; use top-level `timeStamp`.
6. `history` `start_time` and `end_time` are ISO 8601 strings, not millisecond integers.

Flow:

1. Flow APIs use integer `id`, not Node-RED string `flowId`.
2. `deploy` and `delete` are high-risk operations. Require explicit user confirmation.
3. Before `deploy`, call `flowApi.openapiv1flowflowdata()` and keep a backup.
4. When editing Node-RED JSON, preserve the existing system-created `mqtt-broker` config node and its `id`; Node-RED credentials are not exported in plain JSON.

MQ:

1. MQTT auth uses the API key as password.
2. `subscribe(topic, handler)` handlers receive `(topic, payload)` where `payload` is a string; parse JSON yourself.
3. Topic wildcards are MQTT `#` and `+`.
4. The client lazy-connects and re-subscribes after reconnect.

## API Selection

| User intent | SDK API | Notes |
|---|---|---|
| Explore namespace tree | `unsApi.openapiv1unsbrowse()` | Use folder paths |
| Find a known topic by name | `unsApi.openapiv1unssearch()` | Faster than walking the full tree |
| Read current value | `unsApi.openapiv1unsread()` | Leaf topics only |
| Query historical values | `unsApi.openapiv1unshistory()` | Use ISO 8601 time strings |
| Write data or commands | `unsApi.openapiv1unswrite()` | `value` must be an object |
| Create UNS nodes | `unsApi.openapiv1unscreate()` | Topic leaf parent must be `Metric`/`Action`/`State` |
| Update UNS metadata/schema | `unsApi.openapiv1unsupdate()` | Not for writing VQT values |
| List/get Flow | `flowApi.openapiv1flowlist()` / `flowApi.openapiv1flowget()` | Use integer `id` |
| Export Node-RED JSON | `flowApi.openapiv1flowflowdata()` | Required before deploy |
| Deploy Node-RED JSON | `flowApi.openapiv1flowdeploy()` | Confirm and backup first |

## Minimal Examples

### Read UNS Current Values

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
});

for (const item of result.data.results ?? []) {
  if (!item.success) {
    console.error(item.topic, item.error?.message);
    continue;
  }
  if (item.result?.quality === 'Good') {
    console.log(item.result.value);
  }
}
```

### Write UNS Values

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unswrite({
  writes: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      value: { temperature: 27.5, unit: 'C' },
      timeStamp: Date.now(),
    },
  ],
});

if (!result.data.success) {
  for (const item of result.data.results ?? []) {
    if (!item.success) console.error(item.topic, item.error?.message);
  }
}
```

### Subscribe to MQ

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  host: 'wss://mqtt.example.com/mqtt',
  password: process.env.TIER0_API_KEY,
});

client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  console.log(topic, JSON.parse(payload));
});
```

## References

Load only the reference needed for the task:

| Need | Read |
|---|---|
| Tier0 concepts: Workspace, UNS, topic types, Flow relations, VQT | `references/core/concepts.md` |
| Environment variables, browser/Vite setup, URL normalization, credentials | `references/setup/configuration.md` |
| MonoApp/TanStack Start scaffold integration | `references/scaffolds/monoapptemplate.md` |
| OpenAPI quickstart and client configuration | `references/openapi/quickstart.md` |
| React Query hooks | `references/openapi/react.md` |
| Vue 3 composables | `references/openapi/vue.md` |
| UNS endpoint details | `references/openapi/uns/*.md` |
| Flow endpoint details | `references/openapi/flow/*.md` |
| System/auth endpoints | `references/openapi/info.md`, `references/openapi/auth/whoami.md`, `references/openapi/reload.md` |
| MQ subscribe/publish details | `references/mq/quickstart.md` |

For constructing SourceFlow/EventFlow Node-RED protocol JSON, use the Tier0 CLI skill protocol references.
