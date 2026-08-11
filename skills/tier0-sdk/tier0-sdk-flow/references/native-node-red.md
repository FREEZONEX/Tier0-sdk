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
- host：App 服务端用部署注入的 `TIER0_API_HOST`（容器内为 `backend:8080`，云端为 `test.tier0.dev` 等）；
  **若 host 已含 `http(s)://` 前缀则原样使用，不要再拼 scheme**（见下方 normalizeBaseURL 帮助函数）；
  浏览器端不得直连（走 BFF）。

## 端点清单

> **`/status` 不存在**：Node-RED Admin API 无 `GET /status` 端点（运行时状态用 `/settings`、`/diagnostics`、
> `/flows/state` 等）。下表只列真实存在的端点。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/flow/{source\|event}/flows` | 原生全量 flows；**默认 v1 返回节点数组**；带 `Node-RED-API-Version: v2` 返回 `{rev, flows}` |
| GET | `/flow/{source\|event}/flow/:id` | 单个 flow 节点与 configs（`:id` 是 **Node-RED 运行时 flow id**，即 `FlowInfo.flowId`，**非平台 DB 整数 id**） |
| GET | `/flow/{source\|event}/flow/global` | 全局配置节点 |
| GET | `/flow/{source\|event}/nodes` | 已安装节点类型列表 |
| GET | `/flow/{source\|event}/settings`、`/diagnostics` | 运行时设置 / 诊断 |
| POST | `/flow/{source\|event}/flows` | 全量部署（`Node-RED-Deployment-Type: flows` + `Node-RED-API-Version: v2`） |
| POST | `/flow/{source\|event}/flow` | 创建 flow |
| PUT | `/flow/{source\|event}/flow/:id` | 更新 flow（含 global） |
| DELETE | `/flow/{source\|event}/flow/:id` | 删除 flow |
| WS | `/flow/{source\|event}/comms` | 实时通道（可选） |

> **`:id` 映射**：平台 OpenAPI 的 `openapiv1flowget/update/delete/deploy` 用的是**平台 DB 整数 id**（`FlowInfo.id`）；
> 原生接口 `/flow/:id` 用的是 **Node-RED 运行时 flow id**（`FlowInfo.flowId`，如 `923b1328f984b8f0`）。
> 两者不同——先 `openapiv1flowlist` 拿 `flowId` 字段，再传给原生接口，否则会 404 或命中错误资源。

## 请求示例（原生 fetch）

```typescript
// host 规范化：兼容 "backend:8080" 与 "https://test.tier0.dev" 两种配置
function baseURL(host: string): string {
  const h = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(h) ? h : `http://${h}`;
}

const host = process.env.TIER0_API_HOST;
const base = `${baseURL(host)}/flow/source`; // sourceflow；eventflow 用 /flow/event
const apiKey = process.env.TIER0_API_KEY;
const headers = { Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey };

// 读 sourceflow 原生 flows（v2 返回 {rev, flows}，需要 rev 时用）
const res = await fetch(`${base}/flows`, {
  headers: { ...headers, 'Node-RED-API-Version': 'v2' },
});
const { rev, flows: runtimeFlows } = await res.json(); // v2 响应 {rev, flows}

// 部署 eventflow 画布（全量替换，先备份；body 传节点数组）
const deployRes = await fetch(`${baseURL(host)}/flow/event/flows`, {
  method: 'POST',
  headers: {
    ...headers,
    'Content-Type': 'application/json',
    'Node-RED-Deployment-Type': 'flows',
    'Node-RED-API-Version': 'v2',
  },
  body: JSON.stringify(canvasFlows), // 直接传节点数组，非包裹对象
});
// 成功返回 HTTP 204
```

## 编辑 Node-RED 节点（完整工作流）

> 已按真实环境验证（云端 test 环境实测：加 comment 节点 → 部署 204 → 读回确认 → 恢复原画布）。

```typescript
import { randomUUID } from 'node:crypto';

const host = process.env.TIER0_API_HOST;
const apiKey = process.env.TIER0_API_KEY;
// host 规范化：兼容 "backend:8080" 与 "https://test.tier0.dev"
const baseURL = (h: string) => (/^https?:\/\//i.test(h.trim()) ? h.trim() : `http://${h.trim()}`).replace(/\/+$/, '');
const base = `${baseURL(host)}/flow/source`; // sourceflow；eventflow 用 /flow/event
const headers = { Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey };

// 1. 读当前画布（必须全量读，因为部署是全量替换；v1 返回节点数组）
const flowsRes = await fetch(`${base}/flows`, { headers });
const flows: any[] = await flowsRes.json();
console.log(`当前节点数: ${flows.length}`);

// 2. 修改节点（示例：给某个 tab 加一个 comment 注释节点）
const tab = flows.find((n) => n.type === 'tab' && n.label === '企业数据');
const comment = {
  id: `sdk-edit-${randomUUID().slice(0, 8)}`, // 唯一 id
  type: 'comment',
  name: 'SDK 编辑注释',
  info: '由 SDK 临时添加，可安全删除',
  x: 10, y: 10, w: 400, h: 80,
  z: tab.id, // 归属的 tab
};
flows.push(comment);

// 3. 全量部署（整画布替换）
const deployRes = await fetch(`${base}/flows`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', 'Node-RED-Deployment-Type': 'flows', 'Node-RED-API-Version': 'v2' },
  body: JSON.stringify(flows),
});
if (deployRes.status !== 204) throw new Error(`部署失败: ${deployRes.status} ${await deployRes.text()}`);

// 4. 读回确认写入
const verifyRes = await fetch(`${base}/flows`, { headers });
const after = await verifyRes.json();
console.log(`部署后节点数: ${after.length}（应比之前多 1）`);

// 5. 恢复（如需回滚）：重新 GET 备份 → 去掉新增节点 → 再 POST
```

### 编辑要点

- **全量替换语义**：`POST /flow/{source|event}/flows` 是整画布替换，请求体直接传**节点数组**（非 `{flows: [...]}` 包裹）；
- **必须先读后写**：改前 GET 完整 flows，改后整体提交；
- **保留系统节点**：`mqtt-broker` config 节点及其 ID 不能动（删除会导致 MQTT 连接失效）；
- **唯一 id**：新增节点 id 必须唯一，避免覆盖已有节点；
- **部署成功码**：`204 No Content`；
- **回滚**：改前保存一份 GET 结果，需要时原样 POST 回去即可还原；
- **`:id` 是 Node-RED 运行时 flow id**：`/flow/:id` 的 `:id` 是 `FlowInfo.flowId`（如 `923b1328f984b8f0`），**不是**平台 OpenAPI 用的 DB 整数 id——先 `openapiv1flowlist` 拿 `flowId` 再传给原生接口。

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
