---
name: tier0-sdk-flow-native-nodered
version: 0.1.0
description: "访问 Node-RED 自身 Admin API（原生运行时接口）：通过网关前缀 /flow/source|event 直接读取/写入 sourceflow/eventflow 的画布、节点与状态。用于需要原生运行时数据或直接部署的场景；平台管理（创建/删除 Flow、版本快照）仍走 /openapi/v1/flow/*。"
---

# Node-RED 原生 Admin API（`/flow/{source|event}/**`）

## 何时使用

- 需要 Node-RED **运行时真实数据**（`GET /flows` 的原生响应，含运行时 rev，**非平台合成的 EditorPayload**）；
- 需要直接操作运行时画布/节点/状态（读 `flow/:id`、`nodes`、`settings`、`status`）；
- 需要绕过平台管理接口直接部署/更新/删除运行时画布。

> 平台管理操作（创建 Flow、元数据、版本快照、经平台校验的部署）仍走
> `POST /openapi/v1/flow/*`（见 `create.md`、`deploy.md` 等）。本节是**运行时直连**通道。

## 前缀与鉴权

| 前缀 | 指向 | 鉴权 |
|---|---|---|
| `TIER0_API_HOST + /flow/source/**` | sourceflow Node-RED 原生接口 | `Authorization: Bearer <TIER0_API_KEY>`（或 `X-API-Key`） |
| `TIER0_API_HOST + /flow/event/**` | eventflow Node-RED 原生接口 | 同上 |

- key 类型：`full_access` 读写全开；`read_only` 只读（写操作 403）；
- host：App 服务端用部署注入的 `TIER0_API_HOST`（`backend:8080`），浏览器端不得直连（走 BFF）。

## 端点清单

| 方法 | 路径 | 说明 |
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

## 请求示例（原生 fetch）

```typescript
const host = process.env.TIER0_API_HOST; // 例如 backend:8080
const apiKey = process.env.TIER0_API_KEY;

// 读 sourceflow 原生 flows
const res = await fetch(`http://${host}/flow/source/flows`, {
  headers: { Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey },
});
const runtimeFlows = await res.json();

// 部署 eventflow 画布（全量替换，先备份）
const deployRes = await fetch(`http://${host}/flow/event/flows`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
    'Node-RED-Deployment-Type': 'flows',
  },
  body: JSON.stringify({ flows: canvasFlows }),
});
```

## 与 OpenAPI 管理接口对比

| 维度 | `/openapi/v1/flow/*`（平台管理） | `/flow/{source\|event}/**`（原生） |
|---|---|---|
| payload | 平台合成/DB 快照 | Node-RED 运行时真实数据 |
| 部署 | 平台校验（缺失节点、scope、版本快照、outbox） | 裸透传，绕过平台校验 |
| 创建/删除 Flow 资源 | 支持 | 部分支持（仅运行时操作，无平台元数据） |
| 鉴权 | ApiKeyAuth（`/openapi/v1/**`） | 网关 apikey 策略（`/flow/*/**`） |
| 建议 | 默认选择 | 仅需原生运行时数据/能力时 |

## 写操作风险与备份流程

写操作（部署/更新/删除）**绕过平台校验与版本快照**，可能造成平台 DB 快照与 Node-RED 运行时漂移。

1. 备份：先 `GET /flow/{source|event}/flows` 保存当前原生 flows JSON；
2. 保留系统创建的 `mqtt-broker` config 节点及其 ID；
3. 全量替换语义：确认提交的画布完整（保留必需系统节点）；
4. 部署后核对 `GET /flow/{source|event}/flows` 的 rev 变化；
5. 需要平台纳管（版本快照/审计）时，改走 `/openapi/v1/flow/deploy`。

## 注意

- 这些路径非 swagger 生成，SDK 生成代码不含它们，App 侧用原生 fetch 或自封装；
- 浏览器端禁止直连（`TIER0_API_HOST` 是容器网络内部地址），统一在 App 服务端（BFF）调用。
