---
name: tier0-sdk-flow
version: 1.1.0
description: "Tier0 SDK Flow management for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use it to create, list, inspect, rename/update, read Node-RED nodes or flowdata, deploy canvas JSON, and delete SourceFlow/EventFlow resources through Tier0 OpenAPI, or to access Node-RED native Admin APIs directly through the /flow/{source|event} gateway prefix. Use for @tier0/sdk Flow or Node-RED lifecycle tasks."
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
- When accessing Node-RED native Admin APIs through `/flow/{source|event}/**`, treat writes (deploy/update/delete) as bypassing platform validation and version snapshots: back up flowdata first and verify the full canvas JSON before sending.

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
| Node-RED native Admin API | [`references/native-node-red.md`](references/native-node-red.md) |

## 可调用接口速查（完整契约）

> 以下接口清单即为可调用全集。AI 直接按此表写调用代码即可，无需额外记忆。
> SDK 方法来自 `@tier0/sdk/openapi`（`src/openapi/api.ts`，由 swagger.json 生成，勿手改）。

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

### B. Node-RED 原生接口（`/flow/{source|event}/**`，原生 fetch）

平台管理接口走 A；需 Node-RED **运行时真实数据/直接写运行时**时走本节。
鉴权：`Authorization: Bearer <TIER0_API_KEY>`（或 `X-API-Key`）；host = `TIER0_API_HOST`（App 服务端）。

| Method | Path | 说明 |
|---|---|---|
| GET | `/flow/{source\|event}/flows` | 原生全量 flows + rev（非平台合成） |
| GET | `/flow/{source\|event}/flow/:id` | 单个 flow 节点与 configs |
| GET | `/flow/{source\|event}/flow/global` | 全局配置节点 |
| GET | `/flow/{source\|event}/nodes` | 已安装节点类型列表 |
| GET | `/flow/{source\|event}/settings`、`/status` | 运行时设置 / 状态 |
| POST | `/flow/{source\|event}/flows` | 全量部署（`Node-RED-Deployment-Type: flows`） |
| POST | `/flow/{source\|event}/flow` | 创建 flow |
| PUT | `/flow/{source\|event}/flow/:id` | 更新 flow（含 global） |
| DELETE | `/flow/{source\|event}/flow/:id` | 删除 flow |
| WS | `/flow/{source\|event}/comms` | 实时通道（可选） |

```typescript
const host = process.env.TIER0_API_HOST; // 例如 backend:8080
const key = process.env.TIER0_API_KEY;

// 读 sourceflow 原生 flows
const res = await fetch(`http://${host}/flow/source/flows`, {
  headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
});
const runtimeFlows = await res.json();

// 部署 eventflow 画布（全量替换，先备份）
await fetch(`http://${host}/flow/event/flows`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key, 'Content-Type': 'application/json', 'Node-RED-Deployment-Type': 'flows' },
  body: JSON.stringify({ flows: canvasFlows }),
});
```

> 完整端点与示例见 [`references/native-node-red.md`](references/native-node-red.md)。
> 选择建议：默认用 A（平台管理，含校验/版本快照）；仅需原生运行时数据/能力时用 B。

## Final Checklist

1. Existing flowdata was inspected before canvas changes.
2. The system MQTT broker node and ID are preserved.
3. Deploy sends the intended full canvas.
4. Native Admin API writes are backed up and deliberate (bypass platform validation).
