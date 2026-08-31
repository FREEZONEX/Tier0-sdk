---
name: tier0-sdk-flow
version: 1.4.0
description: "Tier0 SDK Flow management for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use it to create, list, inspect, rename/update, read Node-RED nodes or flowdata, deploy canvas JSON, and delete SourceFlow/EventFlow resources through Tier0 OpenAPI; or expose and invoke application HTTP endpoints built with Node-RED http in/http response nodes through /flow/{source|event}. Use for @tier0/sdk Flow, Node-RED lifecycle, webhook, or Flow HTTP endpoint tasks."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Flow

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md).**

## Guardrails

- Read the matching reference before every Flow operation.
- Before editing/deploying Node-RED JSON, fetch the existing flowdata and preserve the system-created `mqtt-broker` config node and its ID.
- Treat deploy as a full-canvas replacement; retain required system nodes and validate the complete JSON before sending.
- Use the Tier0 CLI Skill protocol references when constructing SourceFlow/EventFlow Node-RED protocol JSON.
- Use only the platform `flowApi` methods documented below for Flow management. Do not attempt management operations through `/flow/{source|event}/**`.
- Use `/flow/{source|event}/**` only to invoke user-defined `http in` endpoints. Build an `http in -> processing -> http response` chain and read the dedicated HTTP endpoint reference.
- When a Flow maintains statistics for an App's Dashboard, Trend, scope distribution, period comparison, or multi-dimensional analysis, first read [`../references/app-statistics-design.md`](../references/app-statistics-design.md). Keep its accumulator state recoverable, exclude the statistic output namespace from its own input, and publish only pre-modeled statistic topics.

## References

| Task | Read |
|---|---|
| Create | [`references/create.md`](references/create.md) |
| List | [`references/list.md`](references/list.md) |
| Get metadata | [`references/get.md`](references/get.md) |
| Update metadata | [`references/update.md`](references/update.md) |
| Get nodes | [`references/nodes.md`](references/nodes.md) |
| Get canvas flowdata | [`references/flowdata.md`](references/flowdata.md) |
| Deploy canvas | [`references/deploy.md`](references/deploy.md) |
| Delete | [`references/delete.md`](references/delete.md) |
| Expose or invoke an `http in` endpoint | [`references/http-endpoints.md`](references/http-endpoints.md) |
| Materialize reusable statistics required inside an App into UNS | [`../references/app-statistics-design.md`](../references/app-statistics-design.md) |

## 可调用接口速查（完整契约）

> 以下接口清单即为可调用全集。AI 直接按此表写调用代码即可，无需额外记忆。
> SDK 方法来自 `@tier0/sdk/openapi`（`dist/esm/openapi/api.js`，由 swagger.json 生成，勿手改）。

### A. 平台管理接口（`POST /openapi/v1/flow/*`，SDK 方法）

统一鉴权：SDK `getClient()` 自动带 `Authorization: Bearer <TIER0_API_KEY>` + `X-API-Key`（双头）。

| # | SDK 方法（`flowApi.*`） | Path | 请求体 | 返回（`data`） |
|---|---|---|---|---|
| 1 | `openapiv1flowlist` | `POST /openapi/v1/flow/list` | `{ keyword?: string; flowType?: 'source'\|'event' }`（不传 flowType 返回全部） | `{ list: FlowInfo[] }` |
| 2 | `openapiv1flowget` | `POST /openapi/v1/flow/get` | `{ id: number }` | `FlowInfo` |
| 3 | `openapiv1flowcreate` | `POST /openapi/v1/flow/create` | `{ flowName: string; flowType: 'source'\|'event'; description?: string; template?: string }` | `{ id: number }` |
| 4 | `openapiv1flowupdate` | `POST /openapi/v1/flow/update` | `{ id: number; flowName?: string; description?: string; template?: string; isFavorite?: number }` | `{ success: boolean }` |
| 5 | `openapiv1flowdelete` | `POST /openapi/v1/flow/delete` | `{ ids: number[] }` | `{ success: boolean }` |
| 6 | `openapiv1flowflowdata` | `POST /openapi/v1/flow/flowdata` | `{ id: number }` | `{ rev: string; flows: object[] }`（平台 DB 快照） |
| 7 | `openapiv1flownodes` | `POST /openapi/v1/flow/nodes` | `{ flowType: 'source'\|'event' }` | `{ nodes: { id; name; types[]; enabled; module; version }[] }` |
| 8 | `openapiv1flowdeploy` | `POST /openapi/v1/flow/deploy` | `{ id: number; flowsJson: string }` | `{ flowId: string }` |

`FlowInfo` 字段：`id, flowId, flowName, flowType, flowStatus, template, description, isFavorite, currentVersionId, currentVersionName, currentVersionType, createdTime, updatedTime`。

```typescript
import { flowApi } from '@tier0/sdk/openapi';

// 例 1：列出 eventflow
const { data } = await flowApi.openapiv1flowlist({ flowType: 'event' });

// 例 2：部署 sourceflow（flowsJson 为画布 JSON 字符串）
await flowApi.openapiv1flowdeploy({ id: 1, flowsJson: JSON.stringify(canvasFlows) });
```

### B. 用户定义的 HTTP 接口

当 Flow 使用 `http in` 接收应用请求时，通过以下地址调用：

```text
SourceFlow: {TIER0_API_HOST}/flow/source/<http-in path>
EventFlow:  {TIER0_API_HOST}/flow/event/<http-in path>
```

网关将请求转发到对应的 `http in` 节点。该入口只用于调用用户定义的业务接口，不用于 Flow 管理。读取 [`references/http-endpoints.md`](references/http-endpoints.md) 获取节点链路、路径映射、调用代码、权限和超时规则。

## Final Checklist

1. Existing flowdata was inspected before canvas changes.
2. The system MQTT broker node and ID are preserved.
3. Deploy sends the intended full canvas.
4. Every user-defined `http in` route ends in `http response` and is called with the required API-key permission.
5. Statistical Flows have restart recovery, deduplication, bucket/time-zone rules, and no feedback loop from their output topics.
