---
name: tier0-sdk
version: 0.3.0
description: "Tier0 SDK for TypeScript/JavaScript. Use when building Tier0 apps, services, workers, or scripts with @tier0/sdk: runtime configuration and project context; OpenAPI auth/system operations; project/workspace member queries; UNS modeling, current values, history, and realtime updates; MQTT/MQ publish/subscribe; Flow/Node-RED lifecycle; managed file upload/download/URL/delete; React/Vue adapters; or MonoApp integration. Prefer the SDK over hand-written HTTP, MQTT, or object-storage clients. Not for non-Tier0 APIs, brokers, or SDKs."
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, runtime, project, auth, members, uns, flow, file, upload, mq, mqtt, websocket, react, vue3, typescript]
---

# Tier0 SDK

Use the official `@tier0/sdk` package as the application integration layer for Tier0. Keep SDK calls in services, workers, server actions, API routes, hooks, or stores; expose business-domain objects to UI components.

## Workflow

1. Check the published version with `npm view @tier0/sdk version` and use the latest release. In a managed MonoApp, update `package.json` and let the platform install dependencies.
2. Read `references/configuration.md` before configuring a live connection, host, API key, browser runtime, MQTT client, or project context.
3. Identify the capability below and read only its linked references before writing code.
4. Import the matching official SDK entry point. Do not hand-write replacement REST, MQTT, file-storage, or environment-resolution clients.
5. Run the final checklist for every capability used.

## Package Entry Points

| Need | Import |
|---|---|
| Runtime context plus combined exports | `@tier0/sdk` |
| OpenAPI clients and types | `@tier0/sdk/openapi` |
| Managed file operations | `@tier0/sdk/files` |
| MQTT/MQ over WebSocket | `@tier0/sdk/mq` |
| React Query adapters | `@tier0/sdk/openapi/react` |
| Vue 3 composables | `@tier0/sdk/openapi/vue` |

## Capability Router

| Capability or task | Read |
|---|---|
| Hosts, API keys, browser/Vite values, MQTT settings, runtime project context | `references/configuration.md` |
| OpenAPI client setup and general usage | `references/openapi.md` |
| UNS concepts, application boundaries, topic types, VQT | `references/uns-concepts.md` |
| UNS ownership, app DB integration, event streams, request/response, transport choice | `references/uns-data-integration.md` |
| UNS browse/create/delete/history/read/restore/search/update/write | Matching `references/uns-*.md` file |
| Continuous, realtime, monitoring, auto-refresh, watch, or event-stream receive | `references/mqtt.md`, `references/uns-data-integration.md` |
| MQTT subscribe/publish, lifecycle, wildcard, and event handling | `references/mqtt.md` |
| Flow create/list/get/update/nodes/flowdata/deploy/delete | Matching `references/flow-*.md` file |
| File upload/download/access URL/delete | Matching `references/files-*.md` file |
| Current identity | `references/identity-whoami.md` |
| Launchpad project members and roles | `references/identity-project-members.md` |
| Platform workspace members, roles, status, and filters | `references/identity-platform-members.md` |
| Service connectivity/capabilities or gateway reload | `references/system-info.md`, `references/system-reload.md` |
| React Query integration | `references/framework-react.md` |
| Vue 3 integration | `references/framework-vue.md` |
| MonoApp/TanStack Start integration | `references/scaffold-monoapp.md` |

## Cross-Capability Rules

### Runtime And Configuration

- Never hard-code an API host, MQTT host, API key, workspace binding, or project ID when the platform supplies it at runtime.
- In generated project-scoped apps, call `getCurrentProjectId()` from server/runtime code. Imported apps receive a new local project context.
- Browser bundles do not automatically read Node environment variables or `VITE_*`; pass browser runtime values explicitly as documented.

### UNS Receive Strategy (Non-Negotiable)

- **Read once**: use OpenAPI `read` for a one-time current-value snapshot.
- **Continuously changing, realtime, or always listening**: use MQTT `subscribe`. Never poll OpenAPI `read` with a timer, query refetch interval, or loop to simulate a subscription.
- **Reconnect backfill**: use OpenAPI `history` only when the topic was created with `enableHistory` enabled. Never assume history exists.

For a live feature, use `read` only for the initial snapshot, keep subsequent updates on MQTT `subscribe`, and use `history` after a connection gap only when history is enabled.

### Managed Files

- For Tier0 application files and attachments, use `uploadFile`, `downloadFile`, `getFileUrl`, and `deleteFile` from `@tier0/sdk/files`.
- Persist the returned `filePath` in business data. Do not persist an expiring presigned URL.
- Do not add AWS SDK/RustFS clients, direct bucket endpoints, or permanent object-storage credentials. The SDK obtains a presigned upload URL and transfers the file to the platform-managed storage.
- Use a manual PUT to the SDK-provided `uploadUrl` only for an advanced requirement such as custom upload progress.

### Domain Guardrails

- **UNS**: Treat UNS as a backend data/integration layer, not a user interface. Keep topic paths, wildcards, VQT, and the namespace tree out of ordinary UI. Every topic path must match `^.+/(Metric|Action|State)/[^/]+$`. Create modeled topics explicitly before writing or publishing; never guess payload shapes—read the matching `uns-*.md` reference.
- **Flow**: Before deploy/delete or Node-RED JSON edits, read the matching Flow reference and preserve the system-created `mqtt-broker` config node and its ID.
- **Members**: Use project-member APIs for one Launchpad project and platform-member APIs for workspace-wide user/role queries; do not substitute one scope for the other.
- **Scope**: Do not use this Skill for a non-Tier0 API, another named SDK, a generic external MQTT broker, an MQTT broker implementation, or direct PLC/OPC UA/Modbus/device-protocol access outside Tier0 APIs.

For SourceFlow/EventFlow Node-RED protocol JSON, use the Tier0 CLI Skill protocol references.

## Final Checklist

1. **Official entry point**: every integration uses the matching `@tier0/sdk` export; no replacement HTTP, MQTT, storage, or runtime-context client was introduced.
2. **Runtime safety**: no platform-supplied host, credential, workspace, or project ID is hard-coded.
3. **Layering**: SDK calls stay in the service/data layer and UI components receive domain objects.
4. **UNS transport**: one-time snapshots use `read`; continuous/realtime receive uses MQTT `subscribe`; reconnect backfill uses `history` only when enabled. No polling simulates realtime.
5. **UNS model**: topic paths satisfy the naming contract, topics are explicitly created, and batch responses inspect both outer and item-level success.
6. **Files**: uploads/downloads use `@tier0/sdk/files`, business records store `filePath`, and no permanent storage credentials or presigned URLs are persisted.
7. **Flow**: deploys preserve the existing system MQTT broker node.
