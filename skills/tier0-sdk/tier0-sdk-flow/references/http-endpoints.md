---
name: tier0-sdk-flow-http-endpoints
version: 0.2.0
description: "通过 Tier0 网关暴露和调用 SourceFlow/EventFlow 中由 Node-RED http in/http response 节点定义的应用 HTTP 接口。"
---

# Flow HTTP 接口（`http in` / `http response`）

使用本参考创建或调用 Flow 中由 `http in` 节点定义的用户业务接口。Flow 的创建、读取、部署、更新和删除统一使用 `flowApi`，不要通过本入口执行管理操作。

## 内容

- [路径映射](#路径映射)
- [必需节点链路](#必需节点链路)
- [App 服务端调用](#app-服务端调用)
- [请求与响应](#请求与响应)
- [鉴权、权限与超时](#鉴权权限与超时)
- [路径约束](#路径约束)

## 路径映射

| Flow 类型 | `http in` 的 `url` | 应用调用地址 |
|---|---|---|
| SourceFlow | `/device/webhook` | `{TIER0_API_HOST}/flow/source/device/webhook` |
| EventFlow | `/material/track` | `{TIER0_API_HOST}/flow/event/material/track` |

网关把请求转发到对应的 `http in` 节点。请求方法和业务路径必须与 `http in.method`、`http in.url` 一致。

选择原则：外部设备或数据源接入优先放 SourceFlow；业务事件处理和应用接口优先放 EventFlow。

## 必需节点链路

```text
http in -> function/业务节点 -> http response
```

- 使用 `http in` 接收入站请求，不要误用发送出站请求的 `http request`。
- 每条正常和异常分支都要到达 `http response`，否则客户端会一直等待并最终超时。
- 使用 `msg.payload` 返回响应体、`msg.statusCode` 设置状态码、`msg.headers` 设置响应头。
- 构造画布前调用 `openapiv1flownodes` 查询目标 Flow 的可用节点，并确认返回类型包含 `http in` 和 `http response`。

以下节点可追加到已读取的完整画布中；部署时仍须保留已有系统节点，尤其是 `mqtt-broker` 及其 ID：

```json
[
  {
    "id": "http-material-track",
    "type": "http in",
    "z": "<existing-tab-id>",
    "name": "接收物料跟踪请求",
    "url": "/material/track",
    "method": "post",
    "upload": false,
    "swaggerDoc": "",
    "x": 180,
    "y": 160,
    "wires": [["handle-material-track"]]
  },
  {
    "id": "handle-material-track",
    "type": "function",
    "z": "<existing-tab-id>",
    "name": "处理请求",
    "func": "msg.statusCode = 200;\nmsg.headers = { 'content-type': 'application/json' };\nmsg.payload = { ok: true, received: msg.payload };\nreturn msg;",
    "outputs": 1,
    "x": 430,
    "y": 160,
    "wires": [["reply-material-track"]]
  },
  {
    "id": "reply-material-track",
    "type": "http response",
    "z": "<existing-tab-id>",
    "name": "返回结果",
    "statusCode": "",
    "headers": {},
    "x": 680,
    "y": 160,
    "wires": []
  }
]
```

## App 服务端调用

这些路径不是 Swagger 生成接口，不使用 `flowApi`。在 App 服务端使用原生 `fetch`，并从运行时读取 host 和 API Key：

```typescript
function normalizeBaseURL(host: string): string {
  const normalized = host.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
}

const host = process.env.TIER0_API_HOST;
const apiKey = process.env.TIER0_API_KEY;
if (!host || !apiKey) throw new Error('Tier0 API host and API key are required');

const response = await fetch(
  `${normalizeBaseURL(host)}/flow/event/material/track?source=app`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ materialId: 'MAT-001', state: 'arrived' }),
  },
);

if (!response.ok) {
  throw new Error(`Flow HTTP request failed: ${response.status} ${await response.text()}`);
}
const result = await response.json();
```

浏览器端不要暴露长期 API Key。浏览器请求应先进入应用的同源 BFF，由服务端调用上述地址。

## 请求与响应

| HTTP 内容 | Node-RED 中的位置 |
|---|---|
| JSON/Form 请求体 | `msg.payload` |
| 查询参数 | `msg.req.query` |
| 请求头 | `msg.req.headers` |
| 路径参数（如 `/item/:id`） | `msg.req.params` |
| 响应体 | 传入 `http response` 的 `msg.payload` |
| 响应状态码 | `msg.statusCode` |
| 响应头 | `msg.headers` |

## 鉴权、权限与超时

- 所有 `/flow/{source|event}/**` 请求都需要 Tier0 API Key。
- 网关按 HTTP 方法鉴权，而不是按节点用途鉴权：`GET/HEAD` 需要 Flow 读取权限；`POST/PUT/PATCH/DELETE` 需要 Flow 管理权限。用户定义的 POST 接口也按写操作处理，read-only key 会返回 `403`。
- 这是需要 API Key 的应用/集成接口，不是匿名公开 webhook。第三方无法安全携带 Tier0 API Key 时，应在受控 BFF 或专用公开网关中校验第三方身份后再转发。
- 请求必须在网关超时前完成；当前 Enterprise 内置路由为 10 秒，其他部署以实际配置为准。同步处理按 10 秒上限设计；长任务先返回 `202 Accepted`，再通过 MQTT、状态 Topic 或其他异步机制报告结果。
- 校验输入、限制请求体大小，不要把任意目标 URL 交给 Flow 形成开放代理，也不要在响应或日志中回显 API Key。

## 路径约束

- 推荐把业务路径放在 `/api/<domain>/...` 或明确的业务前缀下。
- `/flow/{source|event}/**` 只用于调用 `http in` 业务接口；Flow 管理统一使用 `flowApi`。
- **Node-RED Admin API 已被网关黑名单拦截**：`/flow/{source|event}/flows`、`/flow/:id`、`/nodes`、
  `/settings`、`/comms`、`/auth` 等固定首段一律返回 `403`——不要通过本前缀读取画布、部署或查节点，
  这些能力走 `flowApi`（`/openapi/v1/flow/*`）。
- 同一 Node-RED 实例内的 `http in` 方法与路径组合必须唯一。
- 修改画布前读取现有 flowdata；部署后用真实调用验证状态码、响应体和错误分支。
