---
name: tier0-sdk
version: 0.2.0
description: "Tier0 SDK — TypeScript/JavaScript 统一 SDK。涵盖 OpenAPI REST API 封装（支持 React/Vue3）和 MQ（MQTT over WebSocket）消息队列封装。适用于前端/Node.js 调用 Tier0 后端 API、实时订阅 UNS 数据、下发设备指令。triggers: Tier0, SDK, OpenAPI, REST, API, UNS, Flow, MQ, MQTT, WebSocket, React, Vue3, TypeScript"
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, rest, api, uns, flow, mq, mqtt, websocket, react, vue3]
---

# tier0-sdk — Tier0 平台 TypeScript SDK

## 概述

`@tier0/sdk` 是 Tier0 Cloud 平台的官方 TypeScript/JavaScript SDK，包含两个子模块：

| 模块 | 能力 | 适用场景 |
|------|------|----------|
| **openapi** | REST API 封装，含类型定义、React Hooks、Vue3 Composables | 前端/Node.js 调用 Tier0 后端 API：UNS 数据面、Flow 管理、系统接口 |
| **mq** | MQTT over WebSocket 封装，支持自动重连、断连重订阅 | 实时数据订阅、设备指令下发 |

SDK 与 CLI 的关系：CLI 通过命令行操作 Tier0，SDK 通过 TypeScript/JavaScript 代码调用同样的 OpenAPI 与 MQTT 接口。本文档专注 SDK 用法；如需命令行操作，请参考 `Tier0-skill` CLI Skills。

## 安装

```bash
npm install @tier0/sdk
```

npm 包页面：https://www.npmjs.com/package/@tier0/sdk

## 环境变量

SDK 优先从环境变量读取配置，无需在代码中硬编码地址或密钥。

| 环境变量 | 说明 | 适用模块 |
|----------|------|----------|
| `TIER0_API_HOST` / `VITE_TIER0_API_HOST` | OpenAPI 服务地址（gwsvr），如 `api.tier0.cloud` | openapi |
| `TIER0_API_KEY` / `VITE_TIER0_API_KEY` | API 认证密钥 | openapi + mq |
| `TIER0_MQTT_HOST` / `VITE_TIER0_MQTT_HOST` | MQTT Broker 地址，如 `mqtt.tier0.cloud` | mq |
| `TIER0_MQTT_PORT` / `VITE_TIER0_MQTT_PORT` | MQTT WebSocket 端口（默认 8084） | mq |

> **Vite 项目**：Vite 只暴露以 `VITE_` 开头的环境变量到客户端，因此前端项目请使用 `VITE_TIER0_*` 前缀。
> **Node.js 项目**：直接使用 `TIER0_*` 前缀。

### .env 文件示例

```bash
# .env（Node.js）
TIER0_API_HOST=api.tier0.cloud
TIER0_API_KEY=your-api-key-here
TIER0_MQTT_HOST=mqtt.tier0.cloud
TIER0_MQTT_PORT=8084

# .env（Vite 前端）
VITE_TIER0_API_HOST=api.tier0.cloud
VITE_TIER0_API_KEY=your-api-key-here
VITE_TIER0_MQTT_HOST=mqtt.tier0.cloud
VITE_TIER0_MQTT_PORT=8084
```

## 核心概念

| 概念 | 说明 |
|------|------|
| **Workspace** | 租户工作区，所有资源的隔离单位 |
| **UNS (Unified Namespace)** | 统一命名空间，树形路径结构组织数据点 |
| **Path（路径段）** | 路径中的每一段都是文件夹，相当于目录层级。只有完整路径才对应一个 topic |
| **Topic** | 完整路径字符串，如 `Plant/Line1/Metric/Temperature`。**只有叶子节点（OpenAPI `type=TOPIC`）才可 read/write**，中间路径段是 `PATH` |
| **Node** | 命名空间中的节点：`PATH`（文件夹）或 `TOPIC`（数据点，常配合 `topicType`: `METRIC`/`ACTION`/`STATE`） |
| **VQT** | 数据点的值结构：`value`（业务对象）+ `quality`（数据质量）+ `timeStamp`（毫秒时间戳） |
| **SourceFlow** | Node-RED 实例，连接工业协议采集设备数据并发布 MQTT / UNS |
| **EventFlow** | Node-RED 实例，订阅 MQTT 消息对业务数据进行二次处理 |

> **Flow ↔ UNS Topic 关联**：Flow 名称（`flowName`）与 UNS topic 路径**通常同名**——SourceFlow 负责采集并写入对应 topic，EventFlow 负责订阅并处理该 topic 的数据。当用户提到某个设备/数据点名称时，它**同时对应一个 UNS topic 和一个（或多个）Flow**，应同时查询两侧。

## 资源关系

```
Workspace
├── UNS (Unified Namespace)
│   ├── Plant/                          ← PATH（文件夹）
│   │   ├── Line1/                      ← PATH
│   │   │   ├── Metric/                 ← PATH
│   │   │   │   └── Temperature         ← TOPIC（数据点，完整 topic）
│   │   │   │       └── VQT { value: {"temperature":27.5,"unit":"C"},
│   │   │   │                 quality: "Good", timeStamp: 1733382000000 }
│   │   │   └── State/
│   │   │       └── MachineStatus       ← TOPIC（数据点）
│   │   └── Line2/
│   │       └── ...
└── Flow
    ├── SourceFlow "Line1-Collector"     ← 同名关联: 采集 → 写入 Plant/Line1/...
    └── EventFlow  "Line1-Processor"     ← 同名关联: 订阅 Plant/Line1/... → 处理
```

**关键规则**：
- `browse` / `search` 操作的对象是路径段（文件夹）
- `read` / `write` / `history` 操作的对象是完整 topic（叶子数据点）
- 写入时 `value` 是符合该 topic 字段定义的**对象**，不是标量
- 中间路径段（如 `Plant/Line1`）不能直接 read/write，只能 browse

## Topic 类型定义

UNS 叶子节点（OpenAPI `type=TOPIC`）的 `topicType` 有且仅有三种，含义严格区分：

| topicType | 用途 | 存储格式 | 典型示例 |
|-----------|------|---------|---------|
| **METRIC** | **设备实时数据** — 传感器采集、生产过程的时序数据，持续产生、有历史记录 | **单层 JSON**（字段扁平，不支持嵌套） | 产量、温度、压力、库存数量、设备运行状态 |
| **ACTION** | **对外集成接口（下行请求）** — 由 UNS 发出的命令/请求，触发下游系统执行操作 | **JSONB**（支持任意层级嵌套） | 工单下发、报工指令、出入库操作、设备控制命令 |
| **STATE** | **接口结果（上行回执）** — 外部系统返回的操作结果或当前状态快照，不是时序流 | **JSONB**（支持任意层级嵌套） | 工单执行结果、出入库确认、设备连接状态、报警状态 |

> **字段约束**：`METRIC` 节点的 `fields` 必须是单层扁平结构（不可嵌套）；`ACTION`/`STATE` 节点以 JSONB 存储，结构自由，`fields` 可省略。
>
> **路径约定**（强制）：叶子节点路径的倒数第二段必须与 `topicType` 一致：
> - `Plant/Line1/Metric/ProductionCount` ✓
> - `Plant/WMS/Action/StockOut` ✓
> - `Plant/MES/State/WorkOrderStatus` ✓
> - `Plant/Line1/ProductionCount`（缺少类型目录）✗

## 何时使用本 Skill

### 应该使用

- 前端或 Node.js 项目需要调用 Tier0 后端 API
- 需要类型安全的 API 调用（TypeScript 类型从 swagger.json 自动生成）
- React 项目希望用 useMutation/useQuery 风格调用 API
- Vue3 项目希望用 Composables 风格调用 API
- 需要实时订阅 Tier0 UNS 数据点（温度、状态、告警等）
- 需要向设备或系统下发指令（写数据点、触发动作）
- 需要接收 Flow（Node-RED）发布的事件消息
- 前端项目需要 WebSocket 实时推送

### 不应该使用

- 直接操作数据库或底层协议 → 不在 SDK 范围内
- 非 MQTT 协议通信 → MQ 模块仅支持 MQTT over WebSocket
- 命令行操作 Tier0 → 使用 `tier0` CLI 及其 Skills

## 不可违反规则

### OpenAPI

1. **必须先配置环境变量或客户端** — 未设置 `TIER0_API_HOST` / `TIER0_API_KEY`（或未调用 `configureClient`）时调用 API 会抛出错误
2. **批量接口 HTTP 200 ≠ 每项成功** — `read`/`write`/`history`/`browse`/`create`/`delete` 等批量端点，HTTP 200 + 外层 `code:200` 仅代表请求到达，**必须检查 `data.success`（整体）和 `data.results[i].success`（逐项）**
3. **write 的 value 必须是对象** — 写入格式 `{ topic, value: { field: val } }`；直接写 `value: 27.5` 或 `value: "ok"` 等标量会被 schema 校验拒绝
4. **禁止在 value 里写 `_timestamp`** — `_timestamp` 是系统落库时间字段，不属于业务数据；如需传采集时刻，用 WriteItem 的 `timeStamp` 字段（毫秒）
5. **先 browse/search 定位路径，再 read/write** — 不要猜测 topic 完整路径；`read`/`write` 只接受叶子节点（数据点），中间路径只能 browse
6. **history 时间格式是 ISO 8601 字符串** — `start_time`/`end_time` 传 `"2026-01-01T00:00:00Z"` 格式，不要传毫秒整数
7. **write 前先确认 schema** — 通过 `browse` + `include_metadata: true` 获取 `fields` 定义，再构造 `value`，避免字段名错误
8. **React Hooks 需安装 @tanstack/react-query** — 未安装时 import `@tier0/sdk/openapi/react` 会报错
9. **Vue3 Composables 需安装 vue** — 未安装时 import `@tier0/sdk/openapi/vue` 会报错

### MQ

1. **Host 和认证从环境变量读取** — 代码中不直接传 `host` / `password`，除非覆盖
2. **订阅 QoS 固定为 1** — 内部自动使用 `qos: 1`，publish 默认 `qos: 0`（可覆盖）
3. **handler 接收 (topic, payload) 字符串** — payload 已由 Buffer 转为 string，JSON 需自行 `JSON.parse`
4. **通配符只支持 # 和 +** — `#` 匹配多层，`+` 匹配单层，不支持其他通配符
5. **断连后自动重订阅** — 依赖 mqtt.js 自动重连 + SDK 在 connect 回调中恢复订阅，无需手动处理

### Flow

1. **deploy/delete 是高风险操作** — SDK 调用 `flowApi.openapiv1flowdeploy()` 会替换全部 Node-RED 节点配置，`flowApi.openapiv1flowdelete()` 会停止容器；代码层应要求显式 confirm，禁止静默执行
2. **deploy 前必须先 data 备份** — 调用 deploy 前必须先 `flowApi.openapiv1flowdata()` 导出当前 flowsJson
3. **`id` ≠ `flowId`** — 所有 REST 参数用整数 `id`（如 `1`），`flowId` 是 Node-RED 内部字符串（如 `e7bdfaabfcae875c`），不可用于 API 参数
4. **Flow 与 UNS 通常同名关联** — 用户按名称查询时，应同时查询 UNS（browse/read）和 Flow（list/get）

## 任务选路心智模型

| 用户意图 | 正确 SDK API | 不要误走 |
|---------|-------------|---------|
| 探索有哪些设备/数据点 | `unsApi.openapiv1unsbrowse()` 逐层展开 | 不要用 search 遍历结构 |
| 知道名字，找具体 topic | `unsApi.openapiv1unssearch()` 按关键词 | 不要逐层 browse（低效） |
| 查某个数据点的当前值 | `unsApi.openapiv1unsread()` 需完整 topic | 不要用 history（history 是时序） |
| 查某段时间的历史趋势 | `unsApi.openapiv1unshistory()` | 不要循环调用 read |
| 写入/更新数据点 | `unsApi.openapiv1unswrite()` value 是对象 | 不要用 update（update 改节点元数据） |
| 查看/管理节点元数据、字段定义 | `unsApi.openapiv1unsupdate()` | 不要用 write（write 是写 VQT 数据） |
| 创建 UNS 节点 | `unsApi.openapiv1unscreate()` | 路径须含 `Metric` 等类型目录 |
| 查看 Flow 列表或详情 | `flowApi.openapiv1flowlist()` + `flowApi.openapiv1flowget()` | 不要用 `flowId` 当参数 |
| 导出 Node-RED 画布备份 | `flowApi.openapiv1flowdata()` | deploy 前必须备份 |
| 部署 Node-RED 画布 | `flowApi.openapiv1flowdeploy()` 带显式 confirm | 不要在未备份的情况下直接 deploy |
| 查数据同时了解采集来源 | 同时查 UNS browse/read 和 flow list/get | 不要只查其中一侧 |

## 参考文档

### OpenAPI

| 意图 | 加载文件 | 说明 |
|------|---------|------|
| 客户端配置与基础使用 | `references/openapi/quickstart.md` | 环境变量、configureClient、基础调用、真实响应结构 |
| React Hooks 使用 | `references/openapi/react.md` | useMutation 风格、QueryClient 配置 |
| Vue3 Composables 使用 | `references/openapi/vue.md` | ref/reactive 风格、响应式数据 |
| `GET /gw/reload` | `references/openapi/reload.md` | 网关重载 |
| `POST /openapi/v1/info` | `references/openapi/info.md` | 服务信息 |
| `POST /openapi/v1/auth/whoami` | `references/openapi/auth/whoami.md` | API Key 身份/权限诊断 |
| Flow 端点 | `references/openapi/flow/*.md` | 创建、删除、部署、更新、列出 Flow 等 |
| UNS 端点 | `references/openapi/uns/*.md` | 浏览、创建、读取、写入、历史、搜索节点等 |

### MQ

| 意图 | 加载文件 | 说明 |
|------|---------|------|
| 快速开始与配置 | `references/mq/quickstart.md` | 环境变量、订阅、发布、事件监听 |

### Node-RED 协议配置（参考 CLI Skill）

如需构造 SourceFlow/EventFlow 的 flowsJson，请参考 CLI Skill `Tier0-skill` 中的协议文档：

- `flow/references/protocols/modbus.md`
- `flow/references/protocols/opcua.md`
- `flow/references/protocols/opcda.md`
- `flow/references/protocols/mqtt-bridge.md`
- `flow/references/protocols/postgresql.md`

SDK 用户通过 `flowApi.openapiv1flowdeploy()` 上传构造好的 flowsJson。

## API 模块速查

```typescript
import { systemApi, flowApi, unsApi } from '@tier0/sdk/openapi';
```

| 模块 | 端点 | 说明 |
|------|------|------|
| `systemApi` | `gwreload()` | 网关重载 |
| `systemApi` | `openapiv1authwhoami(body?)` | API Key 身份/权限诊断 |
| `systemApi` | `openapiv1info(body)` | 服务信息 |
| `flowApi` | `openapiv1flowcreate(body)` | 创建 Flow |
| `flowApi` | `openapiv1flowdelete(body)` | 删除 Flow |
| `flowApi` | `openapiv1flowdeploy(body)` | 部署 Flow |
| `flowApi` | `openapiv1flowflowdata(body)` | 获取 Flow 画布数据 |
| `flowApi` | `openapiv1flowget(body)` | 获取 Flow 详情 |
| `flowApi` | `openapiv1flowlist(body)` | 列出 Flow |
| `flowApi` | `openapiv1flownodes(body)` | 可用节点查询 |
| `flowApi` | `openapiv1flowupdate(body)` | 更新 Flow |
| `unsApi` | `openapiv1unsbrowse(body)` | 浏览命名空间 |
| `unsApi` | `openapiv1unscreate(body)` | 创建节点 |
| `unsApi` | `openapiv1unsdelete(body)` | 删除节点 |
| `unsApi` | `openapiv1unshistory(body)` | 查询历史 |
| `unsApi` | `openapiv1unsread(body)` | 读取数据点 |
| `unsApi` | `openapiv1unsrestore(body)` | 恢复节点 |
| `unsApi` | `openapiv1unssearch(body)` | 搜索节点 |
| `unsApi` | `openapiv1unsupdate(body)` | 更新节点 |
| `unsApi` | `openapiv1unswrite(body)` | 写入数据点 |

## 错误处理

| 现象 | 原因 | 解决 |
|------|------|------|
| `API Key not found` / HTTP 401 | 未配置 `TIER0_API_KEY` 或 API Key 失效 | 检查环境变量或调用 `configureClient({ apiKey })` |
| `HTTP 403` | Workspace 权限不足 | 联系管理员 |
| `HTTP 404` | 资源不存在 | 检查 ID 或路径 |
| 批量接口 `data.success: false` | 部分 topic 处理失败 | 检查 `data.results[i].success` 和 `error.message` |
| `field "id" is not set` | 误用了 `flowId`（字符串）而非 `id`（整数） | 先 `flowApi.openapiv1flowlist()` 拿整数 `id` |
| `segment before leaf must be a type folder` | 路径叶子前一段不是 Metric/Action/State | 在叶子名前补类型目录，如 `.../Metric/ProductionCount` |
| `write schema validation failed` | `value` 不是对象或字段不匹配 topic 的 `fields` | write 前先 browse 查 schema |

### 批量接口响应解析规则

适用接口：`uns read` / `uns write` / `uns history` / `uns create`。

```js
const apiOk = body.code === 200;
const businessOk =
  typeof body.data?.success === 'boolean'
    ? body.data.success
    : apiOk;

for (const item of body.data?.results ?? []) {
  if (!item.success) {
    // item.topic + item.error.code + item.error.message
  }
}
```

非批量接口（browse / search / flow list / flow get / info / auth whoami）不含 `data.success`，直接用外层 `code === 200` 判断即可。

## 快速示例

### OpenAPI — 读取 UNS 数据

```typescript
import { unsApi } from '@tier0/sdk/openapi';

// 环境变量已配置 TIER0_API_HOST 和 TIER0_API_KEY
const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
});

// 批量接口必须检查 data.success 和 results
if (result.data?.success) {
  console.log(result.data.results);
}
```

### MQ — 订阅实时数据

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

// 环境变量已配置 TIER0_MQTT_HOST 和 TIER0_API_KEY
client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  console.log(topic, JSON.parse(payload));
});
```

## 版本与升级

### 当前版本

```bash
npm list @tier0/sdk
```

### 升级命令

```bash
# 查看最新版本
npm view @tier0/sdk versions --json

# 升级到最新版
npm install @tier0/sdk@latest

# 升级到指定版本
npm install @tier0/sdk@0.2.0
```

### 版本差异

| 版本 | 变更内容 |
|------|----------|
| `0.1.0` | 初始版本。OpenAPI 18 个端点、MQ 订阅发布、React/Vue3 Hooks、环境变量自动读取 |
| `0.2.0` | Skill 内容同步 CLI 文档：新增核心概念、Topic 类型、任务选路、批量响应解析、Flow 高风险规则 |

### 升级后检查

升级后建议执行以下检查：

```bash
# 1. 确认版本
npm list @tier0/sdk

# 2. 检查 TypeScript 类型（如有类型报错，参考下方「Breaking Changes」）
npx tsc --noEmit

# 3. 运行测试
npm test
```

### Breaking Changes 策略

- **minor 版本（0.x.0）**：可能包含 API 调整，升级前请查看 CHANGELOG
- **patch 版本（0.0.x）**：仅修复 bug，可安全升级
- 所有破坏性变更会在 CHANGELOG 中标注迁移路径
