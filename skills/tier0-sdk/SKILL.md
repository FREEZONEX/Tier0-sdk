---
name: tier0-sdk
version: 0.2.4
description: "Tier0 SDK for TypeScript/JavaScript agents. Use when building apps or scripts with @tier0/sdk for Tier0 platform integration, external data integration through Tier0, UNS topic modeling/read/write/history/search/create/delete, Flow resource management, or Tier0 MQTT/MQ publish/subscribe over WebSocket. Triggers include Tier0, UNS, Unified Namespace, topic, Metric, Action, State, Flow, data integration, OpenAPI, API key, MQ, MQTT, WebSocket, React, Vue3, Vite, TypeScript. Do not use for unrelated third-party APIs, non-Tier0 MQTT brokers, implementing an MQTT broker/server, or when the user explicitly specifies another API/client."
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, rest, api, uns, flow, mq, mqtt, websocket, react, vue3, typescript]
---

# Tier0 SDK

Use `@tier0/sdk` when code must call Tier0 from TypeScript or JavaScript.

For CLI command-line work, use the Tier0 CLI skill instead of this SDK skill.

## Scope

Use this skill for:

- Tier0 platform integrations, including external data integration through Tier0.
- UNS work: topic modeling, topic paths, `Metric`/`Action`/`State`, read/write/history/search/create/delete.
- Tier0 Flow work: create/list/get/update/deploy/delete and Node-RED JSON handled through Tier0 APIs.
- Tier0 OpenAPI clients, Tier0 API keys, and Tier0 host configuration.
- Tier0 MQ/MQTT over WebSocket publish/subscribe where the broker is the Tier0 MQTT endpoint and auth uses Tier0 credentials.
- React, Vue3, Vite, Node.js, or TypeScript code that uses `@tier0/sdk`.

Do not use this skill for:

- A user-specified non-Tier0 API or SDK. Follow the API/client the user named.
- Generic MQTT usage against another broker, such as Mosquitto, EMQX, HiveMQ, AWS IoT, or a customer broker, unless the task explicitly routes that broker through Tier0.
- Building or running an MQTT broker/server. `@tier0/sdk/mq` is a client, not a broker implementation.
- Non-Tier0 MQTT credentials, topics, or broker configuration that are not part of Tier0 runtime configuration.
- Direct database, PLC, OPC UA, Modbus, or device protocol access outside Tier0 APIs.

## How To Use This Skill

Load only the reference needed for the current task. The top-level skill intentionally stays small; detailed setup, examples, endpoint behavior, and framework patterns live in `references/`.

Core guardrails:

1. Before any task that connects to Tier0, configures hosts, uses API keys, initializes OpenAPI, initializes MQ/MQTT, or handles browser/Vite credentials, read `references/setup/configuration.md` first.
2. Treat UNS/Flow concepts as domain rules, not SDK conveniences. Read `references/core/concepts.md` before modeling or changing UNS/Flow resources.
3. For MonoApp/TanStack Start projects, read `references/scaffolds/monoapptemplate.md` before importing SDK modules.
4. For Flow deploy/delete or Node-RED JSON edits, read the relevant Flow reference and preserve the system-created `mqtt-broker` config node.
5. For browser/Vite code, pass runtime values explicitly; do not assume the SDK auto-reads `VITE_*`.

## References

Reference routing:

| Need | Read |
|---|---|
| Any connection, authentication, host, API key, OpenAPI client, MQ/MQTT client, browser/Vite credential setup | `references/setup/configuration.md` |
| Tier0 concepts: Workspace, UNS, topic types, Flow relations, VQT | `references/core/concepts.md` |
| MonoApp/TanStack Start scaffold integration | `references/scaffolds/monoapptemplate.md` |
| OpenAPI quickstart and client configuration | `references/openapi/quickstart.md` |
| React Query hooks | `references/openapi/react.md` |
| Vue 3 composables | `references/openapi/vue.md` |
| UNS endpoint details | `references/openapi/uns/*.md` |
| Flow endpoint details | `references/openapi/flow/*.md` |
| System/auth endpoints | `references/openapi/info.md`, `references/openapi/auth/whoami.md`, `references/openapi/reload.md` |
| MQ subscribe/publish details | `references/mq/quickstart.md` |

For constructing SourceFlow/EventFlow Node-RED protocol JSON, use the Tier0 CLI skill protocol references.
