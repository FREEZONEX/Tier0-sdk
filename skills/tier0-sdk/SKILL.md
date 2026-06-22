---
name: tier0-sdk
version: 0.2.2
description: "Tier0 SDK for TypeScript/JavaScript agents. Use when building apps or scripts with @tier0/sdk to call Tier0 OpenAPI, manage UNS topics and Flow resources, or subscribe/publish MQTT over WebSocket. Covers Node.js, browser/Vite, React, Vue3, OpenAPI, UNS, Flow, MQ, MQTT, and WebSocket usage."
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, rest, api, uns, flow, mq, mqtt, websocket, react, vue3, typescript]
---

# Tier0 SDK

Use `@tier0/sdk` when code must call Tier0 from TypeScript or JavaScript.

For CLI command-line work, use the Tier0 CLI skill instead of this SDK skill.

## How To Use This Skill

Load only the reference needed for the current task. The top-level skill intentionally stays small; detailed setup, examples, endpoint behavior, and framework patterns live in `references/`.

Core guardrails:

1. Configure Tier0 host and API key before using OpenAPI or MQ clients.
2. Treat UNS/Flow concepts as domain rules, not SDK conveniences. Read `references/core/concepts.md` before modeling or changing UNS/Flow resources.
3. For MonoApp/TanStack Start projects, read `references/scaffolds/monoapptemplate.md` before importing SDK modules.
4. For Flow deploy/delete or Node-RED JSON edits, read the relevant Flow reference and preserve the system-created `mqtt-broker` config node.
5. For browser/Vite code, pass runtime values explicitly; do not assume the SDK auto-reads `VITE_*`.

## References

Reference routing:

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
