---
name: tier0-sdk
version: 0.3.9
description: "Tier0 SDK 单根聚合路由及 TypeScript/JavaScript 共享配置。用于 App/Stream requests 调用与 messages 发布订阅、Tier0 配置、UNS 当前数据、历史数据/history、趋势图/trend、时间范围查询、MQTT 实时订阅、Source/Stream 数据采集、成员、通知和系统能力；当应用需要文件上传/upload、附件/attachment、头像/avatar、文件导入/import、生成或导出文件/报表、持久化文件、访问链接、下载或删除时也必须触发，即使用户未提到 Tier0、SDK、S3 或对象存储。业务运行时文件必须路由到 tier0-sdk-files 并使用 @tier0/sdk/files，不能持久化到 Sandbox/本地目录、public/ 或数据库 Blob。源码、随版本发布的静态资源、构建产物和可丢弃的临时处理文件除外。"
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK Root Router

This is the bundle root Skill. Read it before using any `tier0-sdk-*` domain Skill. It owns package versioning, runtime configuration, official entry points, domain routing, and cross-domain application boundaries.

## Shared Workflow

1. Use the reviewed commit and SHA-256 pinned artifact/source pack when supplied for an App/Stream deployment; do not replace it with an npm release that lacks that unit. Otherwise check the published version with `npm view @tier0/sdk version` and use the latest release. In a managed MonoApp, update `package.json` and let the platform install dependencies.
2. Before making any actual `@tier0/sdk` call, read [`references/configuration.md`](references/configuration.md). This requirement applies even when a client already exists; verify host, credentials, runtime boundary, and project context instead of assuming them.
3. Route the task to the matching domain Skill below and read that Skill before writing code.
4. Import an official SDK entry point. Do not hand-write replacement REST, MQTT, object-storage, or environment-resolution clients.
5. Keep SDK calls in services, workers, server actions, API routes, hooks, or stores; expose business-domain objects to UI components.
6. For MonoApp browser attachment downloads, read [`references/scaffold-monoapp.md`](references/scaffold-monoapp.md) and [`tier0-sdk-files/references/download.md`](tier0-sdk-files/references/download.md). Resolve the trusted `filePath` server-side, stream `downloadFile().response.body` through an authenticated same-origin route, and save the browser Blob with `<a download>`.

## Mandatory File Routing

Route to [`tier0-sdk-files/SKILL.md`](tier0-sdk-files/SKILL.md) whenever an application needs file upload, attachment, avatar, file import, a generated or exported file/report, persistent file storage, an access URL, download, or deletion. This routing is mandatory even when the user does not mention Tier0 SDK, S3, RustFS, object storage, or a storage implementation.

User uploads and application-generated runtime files that must survive a request, restart, deployment, or application update are business files. Store them through `@tier0/sdk/files` and persist the returned stable `filePath` in business data. Do not use Sandbox or application-local directories, `public/`, database blobs, handwritten S3/RustFS clients, or expiring presigned URLs as the persistent source of truth.

This rule does not apply to source files, static assets intentionally shipped with an application version, build artifacts, or disposable local files used only during short-lived processing before upload.

## 可调用接口总览（OpenAPI，`@tier0/sdk/openapi`）

> 完整接口清单（方法名 → Path）。AI 据此选接口，详细参数/示例见对应领域 Skill 与
> 安装包内的类型声明 `@tier0/sdk/openapi`（`dist/esm/openapi/types.d.ts`）。方法均经
> `getClient()` 自动鉴权（`Authorization: Bearer <TIER0_API_KEY>` + `X-API-Key`）。

| 领域 | 方法 | Path |
|---|---|---|
| system | `systemApi.openapiV2Info` | `POST /openapi/v2/info` |
| system | `systemApi.openapiV2AuthWhoami` | `POST /openapi/v2/auth/whoami` |
| apps | `appsApi.openapiV2AppsAccessMembersList` | `POST /openapi/v2/apps/access-members/list` |
| platform | `platformApi.openapiV2PlatformGetmembers` | `POST /openapi/v2/platform/getMembers` |
| notifications | `notificationsApi.openapiV2NotificationsSend` | `POST /openapi/v2/notifications/send` |
| notifications | `notificationsApi.openapiV2NotificationsGet` | `POST /openapi/v2/notifications/get` |

Cloud UNS operations are exported as `unsV2` from `@tier0/sdk/cloud` or `@tier0/sdk`. Retired Flow, old Namespace and gateway-reload APIs have no aliases; use @tier0/sdk-v2 for Source/Stream management and current Collection contracts for App data.

## Domain Routing

| User need | Read |
|---|---|
| UNS modeling, browse/search, read/write/history, topic lifecycle, app data integration | [`tier0-sdk-uns/SKILL.md`](tier0-sdk-uns/SKILL.md) |
| App history, trend chart, bounded time-range data, aggregate history, or MQTT reconnect backfill | [`tier0-sdk-uns/references/history.md`](tier0-sdk-uns/references/history.md); for MonoApp also read [`references/scaffold-monoapp.md`](references/scaffold-monoapp.md) |
| App/Stream request describe/invoke/discover, logical-topic messages publish/subscribe, trusted App runtime | [`tier0-sdk-streams/SKILL.md`](tier0-sdk-streams/SKILL.md) |
| UNS telemetry realtime receive, MQTT subscribe/publish, connection lifecycle | [`tier0-sdk-mq/SKILL.md`](tier0-sdk-mq/SKILL.md) |
| File upload, attachment, avatar, import, generated/exported file or report, persistent storage, access URL, download, or deletion—even without an explicit SDK request | [`tier0-sdk-files/SKILL.md`](tier0-sdk-files/SKILL.md) |
| Cloud App access members or platform/workspace members and roles | [`tier0-sdk-members/SKILL.md`](tier0-sdk-members/SKILL.md) |
| Select a recipient by human identity, send an in-app notification (inbox + optional web/mobile push), or query delivery status. Never ask an end user for a user ID | [`tier0-sdk-notifications/SKILL.md`](tier0-sdk-notifications/SKILL.md) |
| API-key credential diagnostics (not an App end-user identity), service info/capabilities | [`tier0-sdk-system/SKILL.md`](tier0-sdk-system/SKILL.md) |
| Client configuration, generic OpenAPI, React/Vue, MonoApp | This Skill and its `references/` |

## Package Entry Points

| Need | Import |
|---|---|
| Runtime context plus combined exports | `@tier0/sdk` |
| Cloud data and App/Stream clients | `@tier0/sdk/cloud` |
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

## Shared Guardrails

- Never hard-code an API host, MQTT host, API key, workspace binding, project ID, or app ID when the platform supplies it at runtime.
- When API-key authentication or MQTT connection fails, follow the compatibility decision tree in [`references/configuration.md`](references/configuration.md) before changing credentials or overriding MQTT identity. A workspace-encoded non-service key with `@tier0/sdk < 0.5.2` requires an SDK upgrade.
- In generated project-scoped apps, call `getCurrentProjectId()` from server/runtime code. Imported apps receive a new local project context.
- Where an app id is needed, call `getCurrentAppId()` — it validates that the injected `APP_ID` is the agent-platform App UUID rather than the scaffold default or a session id. Never read `process.env.APP_ID` directly; see [`references/configuration.md`](references/configuration.md).
- Browser bundles do not automatically read Node environment variables or `VITE_*`. App/Stream calls automatically detect the trusted host runtime symbol; business Apps do not install a provider or configure broker URLs, subjects, keys or credentials. Other browser clients require explicit runtime values.
- Do not use these Skills for a non-Tier0 API, another named SDK, a generic external MQTT broker, or direct PLC/OPC UA/Modbus/device-protocol access outside Tier0 APIs.
- Do not navigate to or `window.open()` a private presigned URL for an attachment download. In MonoApp, proxy `downloadFile` through an authenticated same-origin route and let the UI save a Blob with `<a download>`.

## Final Checklist

1. The root [`references/configuration.md`](references/configuration.md) was read before any actual SDK call.
2. The matching domain Skill and operation reference were read.
3. The implementation uses the correct official `@tier0/sdk` entry point.
4. No platform-supplied host, credential, workspace, or project ID is hard-coded.
5. SDK calls stay in the service/data layer and UI components receive domain objects.
6. MonoApp attachment downloads resolve `filePath` from an authorized business record, stream `downloadFile().response.body` through the app route, and use Blob plus `<a download>` in the UI.
7. App history and trend queries use `unsV2.sampleFind` or `unsV2.sampleAggregate` with verified Collection/record IDs and bounded time ranges; return UI-facing DTOs and use the declared subscription contract for live updates.
