---
name: tier0-sdk
version: 0.2.11
description: "Tier0 SDK for TypeScript/JavaScript. Use when building apps or scripts with @tier0/sdk (React, Vue3, Vite, Node): read/write/history/subscribe UNS (Unified Namespace) as a backend data source, manage Flow (Node-RED) resources, publish/subscribe Tier0 MQTT/MQ over WebSocket, upload/download/delete files through Tier0 OpenAPI, or integrate external data. UNS is a data source, not a UI — do not build a UNS tree viewer, topic explorer, or namespace browser. Every topic path must have a Metric/Action/State type folder immediately before the leaf. Not for non-Tier0 brokers/APIs, another named SDK/client, or implementing an MQTT broker."
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, rest, api, uns, flow, file, upload, attachment, download, delete, mq, mqtt, websocket, react, vue3, typescript]
---

# Tier0 SDK

Use `@tier0/sdk` when code must call Tier0 from TypeScript or JavaScript.

## UNS Is A Data Source, Not A UI

The single most important rule. Treat UNS like a database or integration API:

- A topic (e.g. `Plant/Line1/Metric/Temperature`) is an integration channel — like a DB table or REST endpoint — not a screen or user-facing object.
- The app consumes UNS (read / history / subscribe / write) from a service/data layer, and the UI renders business domain objects (equipment, orders, alarms, KPIs). End users never see topic paths, MQTT topics, wildcards, `Metric`/`Action`/`State` folders, or the namespace tree.
- `browse`/`search` are for dev-time discovery only. Build a UNS tree viewer, topic explorer, or namespace browser **only** when the user explicitly asks for a browser, admin, diagnostics, or data-modeling tool.

If you are about to put a topic path or `JSON.stringify(response)` into a component, stop: move it into a service/hook and render a domain object instead.

## Topic Naming Contract (Non-Negotiable)

Every topic path — OpenAPI `read`/`write`/`create` **and** MQ `publish`/`subscribe` — must have a type folder (`Metric`, `Action`, or `State`) immediately before the leaf:

```text
<business path>/<Metric|Action|State>/<leaf>
```

| | Example |
|---|---|
| Valid | `Mock/Line1/Action/Request`, `Plant/Line1/Metric/Temperature`, `Acme/Sales/State/Order` |
| Invalid | `Mock/Line1/Request` (no type folder), `app/events/temperature`, `sensor/temp` |

Pick the type folder by semantics: `Metric` = measurements/time-series, `Action` = commands/requests, `State` = status/results/snapshots. Do not invent free-form MQTT-style topics; the platform will not insert the type folder for you, and the MQTT broker does not validate topic shape — a malformed publish "succeeds" silently and breaks interoperability.

Self-check: every literal topic string you emit must match `^.+/(Metric|Action|State)/[^/]+$` (wildcard segments like `+` allowed in subscribe patterns).

## Scope

Use for:

- Tier0 platform integration, including external data integration through Tier0.
- UNS as a backend data source: read/write/history/search/create/delete over topic paths.
- Flow (Node-RED) work via Tier0 APIs: create/list/get/update/deploy/delete.
- File/attachment operations through Tier0 OpenAPI: upload, download, get URL, delete.
- Tier0 OpenAPI clients, API keys, and host configuration.
- Tier0 MQ/MQTT over WebSocket where the broker is the Tier0 endpoint.
- React, Vue3, Vite, Node.js, or TypeScript code using `@tier0/sdk`.

Do not use for:

- A non-Tier0 API or SDK the user named — follow the client they specified.
- Generic MQTT against another broker (Mosquitto, EMQX, HiveMQ, AWS IoT) unless routed through Tier0.
- Implementing an MQTT broker/server — `@tier0/sdk/mq` is a client only.
- Direct database, PLC, OPC UA, Modbus, or device protocol access outside Tier0 APIs.

## Guardrails

The top-level skill stays small; load the reference for the task at hand from `references/`.

1. Always use the latest SDK. Before writing any code, check the published version with `npm view @tier0/sdk version` and update to it (`npm install @tier0/sdk@latest`); the SDK evolves, so never rely on a stale pinned version. In the MonoApp scaffold, do not run `npm install` manually — bump `@tier0/sdk` in `package.json` and let the managed install apply it. See `references/setup/configuration.md`.
2. Read `references/setup/configuration.md` before any connection, host, API key, OpenAPI, MQ/MQTT, or browser/Vite credential work.
3. Read `references/core/concepts.md` before modeling or changing UNS/Flow resources.
4. MonoApp/TanStack Start: read `references/scaffolds/monoapptemplate.md` before importing SDK modules.
5. Flow deploy/delete or Node-RED JSON edits: read the Flow reference and preserve the system-created `mqtt-broker` config node.
6. Browser/Vite: pass runtime values explicitly; the SDK does not auto-read `VITE_*`.
7. Never guess UNS request payload shapes, and never search the compiled package (`dist/`, `.d.ts`) for value conventions or examples — it contains none. Every endpoint reference under `references/openapi/` has field-value tables and complete working examples; read the matching file before composing the body. In particular, `uns/create.md` documents the exact `type`/`topicType`/`fields` values and full node-tree examples. Create topics explicitly (create, verify `results[i].success`, then write) — do not fall back to "write first, create best-effort".

## References

| Need | Read |
|---|---|
| Any connection, authentication, host, API key, OpenAPI client, MQ/MQTT client, browser/Vite credential setup | `references/setup/configuration.md` |
| Tier0 concepts: Workspace, UNS, topic types, Flow relations, VQT | `references/core/concepts.md` |
| Data-integration shapes: outbound sync, inbound consume, app DB vs UNS, async request–response (Action → State round-trip, correlation ids, event-stream topics) | `references/core/data-integration.md` |
| MonoApp/TanStack Start scaffold integration | `references/scaffolds/monoapptemplate.md` |
| OpenAPI quickstart and client configuration | `references/openapi/quickstart.md` |
| React Query hooks | `references/openapi/react.md` |
| Vue 3 composables | `references/openapi/vue.md` |
| UNS endpoint details — each file has field-value tables + working examples | `references/openapi/uns/{read,write,create,browse,search,history,update,delete,restore}.md` |
| UNS create node structure: `type`/`topicType`/`fields` values, full node-tree examples | `references/openapi/uns/create.md` |
| Flow endpoint details | `references/openapi/flow/*.md` |
| Launchpad project member and role queries | `references/openapi/launchpad/get-members.md` |
| File upload/download/URL/delete endpoints | `references/openapi/files/*.md` |
| System/auth endpoints | `references/openapi/info.md`, `references/openapi/auth/whoami.md`, `references/openapi/reload.md` |
| MQ subscribe/publish details | `references/mq/quickstart.md` |

For constructing SourceFlow/EventFlow Node-RED protocol JSON, use the Tier0 CLI skill protocol references.

## Final Checklist Before Delivering

Run this check on the code you generated. Do not skip it.

1. **Topic shape**: search the code for every literal topic string (OpenAPI `topics`/`topic`/`path` values, MQ `publish`/`subscribe` arguments, Node-RED `msg.topic`). Each one must match `^.+/(Metric|Action|State)/[^/]+$` (wildcards allowed in subscribe patterns). If any topic is missing the type folder, fix it — do not ship it.
2. **UNS stays out of the UI**: no topic path, wildcard, VQT structure, or `Metric`/`Action`/`State` folder name appears in any component/JSX/template or user-visible text. No page, route, or nav item named UNS/Namespace/Topic/Explorer exists — unless the user explicitly asked for an admin, diagnostics, or data-modeling tool.
3. **Layering**: all Tier0 SDK calls live in a service/data layer (services, hooks, API routes, server actions); components render domain objects only.
4. **Batch results checked**: every UNS batch call inspects `data.success` and each `data.results[i].success`, not just HTTP 200.
