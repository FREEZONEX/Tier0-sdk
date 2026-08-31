---
name: tier0-sdk
version: 0.4.3
description: "Tier0 SDK 单根聚合路由及 TypeScript/JavaScript 共享配置。用于 Tier0 配置、UNS 数据、MQTT 实时订阅、Flow/Node-RED HTTP 接口、成员、通知和系统能力；Tier0-backed 或 Tier0 托管环境中的 App，其 Dashboard、Trend、范围分布、同比/环比和多维统计需求也必须触发；应用涉及文件上传/upload、附件/attachment、头像/avatar、导入/import、生成或导出文件/报表、持久化文件、访问链接、下载或删除时也必须触发。业务运行时文件必须路由到 tier0-sdk-files 并使用 @tier0/sdk/files，不能持久化到 Sandbox/本地目录、public/ 或数据库 Blob。源码、随版本发布的静态资源、构建产物和可丢弃的临时文件除外。"
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK Root Router

This is the bundle root Skill. Read it before using any `tier0-sdk-*` domain Skill. It owns package versioning, runtime configuration, official entry points, domain routing, and cross-domain application boundaries.

## Shared Workflow

1. Check the published version with `npm view @tier0/sdk version` and use the latest release. In a managed MonoApp, update `package.json` and let the platform install dependencies.
2. Before making any actual `@tier0/sdk` call, read [`references/configuration.md`](references/configuration.md). This requirement applies even when a client already exists; verify host, credentials, runtime boundary, and project context instead of assuming them.
3. When a Tier0-backed App or an App running in the managed Tier0 environment includes Dashboard, Trend, scope distribution, period comparison, or multi-dimensional statistics, read [`references/app-statistics-design.md`](references/app-statistics-design.md) before designing topics, Flow logic, data services, or frontend requests. Do not route an App backed only by another API or database to this Tier0 statistics design.
4. Route the task to the matching domain Skill below and read that Skill before writing code.
5. Import an official SDK entry point. Do not hand-write replacement REST, MQTT, object-storage, or environment-resolution clients.
6. Keep SDK calls in services, workers, server actions, API routes, hooks, or stores; expose business-domain objects to UI components.
7. For MonoApp browser attachment downloads, read [`references/scaffold-monoapp.md`](references/scaffold-monoapp.md) and [`tier0-sdk-files/references/download.md`](tier0-sdk-files/references/download.md). Resolve the trusted `filePath` server-side, stream `downloadFile().response.body` through an authenticated same-origin route, and save the browser Blob with `<a download>`.

## Mandatory File Routing

Route to [`tier0-sdk-files/SKILL.md`](tier0-sdk-files/SKILL.md) whenever an application needs file upload, attachment, avatar, file import, a generated or exported file/report, persistent file storage, an access URL, download, or deletion. This routing is mandatory even when the user does not mention Tier0 SDK, S3, RustFS, object storage, or a storage implementation.

User uploads and application-generated runtime files that must survive a request, restart, deployment, or application update are business files. Store them through `@tier0/sdk/files` and persist the returned stable `filePath` in business data. Do not use Sandbox or application-local directories, `public/`, database blobs, handwritten S3/RustFS clients, or expiring presigned URLs as the persistent source of truth.

This rule does not apply to source files, static assets intentionally shipped with an application version, build artifacts, or disposable local files used only during short-lived processing before upload.

## 可调用接口总览（OpenAPI，`@tier0/sdk/openapi`）

> 完整接口清单（方法名 → Path）。AI 据此选接口，详细参数/示例见对应领域 Skill 与
> 安装包内的类型声明 `@tier0/sdk/openapi`（`dist/esm/openapi/types.d.ts`，含 `FlowInfo`、
> `NodeRedNodeSet` 等类型）。方法均经
> `getClient()` 自动鉴权（`Authorization: Bearer <TIER0_API_KEY>` + `X-API-Key`）。

| 领域 | 方法 | Path |
|---|---|---|
| system | `systemApi.openapiv1info` | `POST /openapi/v1/info` |
| system | `systemApi.openapiv1authwhoami` | `POST /openapi/v1/auth/whoami` |
| system | `systemApi.gwreload` | `GET /gw/reload` |
| flow | `flowApi.openapiv1flowlist` | `POST /openapi/v1/flow/list` |
| flow | `flowApi.openapiv1flowget` | `POST /openapi/v1/flow/get` |
| flow | `flowApi.openapiv1flowcreate` | `POST /openapi/v1/flow/create` |
| flow | `flowApi.openapiv1flowupdate` | `POST /openapi/v1/flow/update` |
| flow | `flowApi.openapiv1flowdelete` | `POST /openapi/v1/flow/delete` |
| flow | `flowApi.openapiv1flowflowdata` | `POST /openapi/v1/flow/flowdata` |
| flow | `flowApi.openapiv1flownodes` | `POST /openapi/v1/flow/nodes` |
| flow | `flowApi.openapiv1flowdeploy` | `POST /openapi/v1/flow/deploy` |
| uns | `unsApi.openapiv1unsbrowse` | `POST /openapi/v1/uns/browse` |
| uns | `unsApi.openapiv1unsread` | `POST /openapi/v1/uns/read` |
| uns | `unsApi.openapiv1unswrite` | `POST /openapi/v1/uns/write` |
| uns | `unsApi.openapiv1unshistory` | `POST /openapi/v1/uns/history` |
| uns | `unsApi.openapiv1unssearch` | `POST /openapi/v1/uns/search` |
| uns | `unsApi.openapiv1unscreate` | `POST /openapi/v1/uns/create` |
| uns | `unsApi.openapiv1unsupdate` | `POST /openapi/v1/uns/update` |
| uns | `unsApi.openapiv1unsdelete` | `POST /openapi/v1/uns/delete` |
| uns | `unsApi.openapiv1unsrestore` | `POST /openapi/v1/uns/restore` |
| launchpad | `launchpadApi.openapiv1launchpadgetmembers` | `POST /openapi/v1/launchpad/{projectName}/getMembers` |
| platform | `platformApi.openapiv1platformgetmembers` | `POST /openapi/v1/platform/getMembers` |
| notifications | `notificationsApi.openapiv1notificationssend` | `POST /openapi/v1/notifications/send` |
| notifications | `notificationsApi.openapiv1notificationsget` | `POST /openapi/v1/notifications/get` |

## Domain Routing

| User need | Read |
|---|---|
| UNS modeling, browse/search, read/write/history, topic lifecycle, app data integration | [`tier0-sdk-uns/SKILL.md`](tier0-sdk-uns/SKILL.md) |
| Continuous/realtime receive, MQTT subscribe/publish, connection lifecycle | [`tier0-sdk-mq/SKILL.md`](tier0-sdk-mq/SKILL.md) |
| Flow/Node-RED create, inspect, edit, deploy, delete, or expose/invoke an `http in` endpoint or webhook | [`tier0-sdk-flow/SKILL.md`](tier0-sdk-flow/SKILL.md) |
| Statistics requirements inside a Tier0-backed or managed Tier0 App: Dashboard, Trend, scope distribution, period comparison, or multi-dimensional analysis | [`references/app-statistics-design.md`](references/app-statistics-design.md), then the UNS and Flow Skills |
| File upload, attachment, avatar, import, generated/exported file or report, persistent storage, access URL, download, or deletion—even without an explicit SDK request | [`tier0-sdk-files/SKILL.md`](tier0-sdk-files/SKILL.md) |
| Launchpad project members or platform/workspace members and roles | [`tier0-sdk-members/SKILL.md`](tier0-sdk-members/SKILL.md) |
| Select a recipient by human identity, send an in-app notification (inbox + optional web/mobile push), or query delivery status. Never ask an end user for a user ID | [`tier0-sdk-notifications/SKILL.md`](tier0-sdk-notifications/SKILL.md) |
| API-key credential diagnostics (not an App end-user identity), service info/capabilities, gateway reload | [`tier0-sdk-system/SKILL.md`](tier0-sdk-system/SKILL.md) |
| Client configuration, generic OpenAPI, React/Vue, MonoApp | This Skill and its `references/` |

## Package Entry Points

| Need | Import |
|---|---|
| Runtime context plus combined exports | `@tier0/sdk` |
| OpenAPI clients and types | `@tier0/sdk/openapi` |
| Managed file operations | `@tier0/sdk/files` |
| MQTT/MQ over WebSocket | `@tier0/sdk/mq` |
| React Query adapters | `@tier0/sdk/openapi/react` |
| Vue 3 composables | `@tier0/sdk/openapi/vue` |

## Shared References

| Task | Read |
|---|---|
| Hosts, API keys, browser/Vite values, MQTT settings, current project | [`references/configuration.md`](references/configuration.md) |
| OpenAPI client setup and general calls | [`references/openapi.md`](references/openapi.md) |
| React Query integration | [`references/framework-react.md`](references/framework-react.md) |
| Vue 3 integration | [`references/framework-vue.md`](references/framework-vue.md) |
| MonoApp/TanStack Start integration | [`references/scaffold-monoapp.md`](references/scaffold-monoapp.md) |
| Statistics requirements inside an App: UNS topic families, Flow materialization, payloads, and frontend bundle calls | [`references/app-statistics-design.md`](references/app-statistics-design.md) |

## Shared Guardrails

- Never hard-code an API host, MQTT host, API key, workspace binding, or project ID when the platform supplies it at runtime.
- In generated project-scoped apps, call `getCurrentProjectId()` from server/runtime code. Imported apps receive a new local project context.
- Browser bundles do not automatically read Node environment variables or `VITE_*`; pass browser runtime values explicitly.
- Do not use these Skills for a non-Tier0 API, another named SDK, a generic external MQTT broker, or direct PLC/OPC UA/Modbus/device-protocol access outside Tier0 APIs.
- Do not navigate to or `window.open()` a private presigned URL for an attachment download. In MonoApp, proxy `downloadFile` through an authenticated same-origin route and let the UI save a Blob with `<a download>`.
- Do not implement a repeatedly viewed business dashboard by looping over hundreds of raw topics in a page request. Materialize reusable business statistics into bounded UNS statistic topics with Source Flow, then let one App endpoint read the exact topics required by the page.
- Do not expose raw topic paths, arbitrary topic filters, or SDK response shapes to the browser. The App service owns the topic allowlist, resolution selection, quality checks, and UI DTO mapping.

## Final Checklist

1. The root [`references/configuration.md`](references/configuration.md) was read before any actual SDK call.
2. The matching domain Skill and operation reference were read.
3. The implementation uses the correct official `@tier0/sdk` entry point.
4. No platform-supplied host, credential, workspace, or project ID is hard-coded.
5. SDK calls stay in the service/data layer and UI components receive domain objects.
6. MonoApp attachment downloads resolve `filePath` from an authorized business record, stream `downloadFile().response.body` through the app route, and use Blob plus `<a download>` in the UI.
7. Reusable business statistics are materialized by Flow and a page loads them through one bounded App bundle request instead of raw-topic loops.
