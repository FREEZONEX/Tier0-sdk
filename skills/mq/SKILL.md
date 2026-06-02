---
name: tier0-sdk-mq
version: 0.1.0
description: "Tier0 SDK MQ 模块 — MQTT over WebSocket 消息队列封装。支持懒连接、自动重连、断连重订阅、QoS 1、通配符 #/+. triggers: Tier0, SDK, MQ, MQTT, WebSocket, 消息队列, 订阅, 发布"
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, mq, mqtt, websocket, subscribe, publish]
---

# tier0-sdk-mq — 消息队列（MQTT over WebSocket）

## 何时使用本 Skill

### 应该使用

- 需要实时订阅 Tier0 UNS 数据点（温度、状态、告警等）
- 需要向设备或系统下发指令（写数据点、触发动作）
- 需要接收 Flow（Node-RED）发布的事件消息
- 前端项目需要 WebSocket 实时推送

### 不应该使用

- 查询历史数据或当前快照 → 走 `openapi/SKILL.md`（REST API 更适合查询场景）
- 管理 Flow/UNS 节点元数据 → 走 `openapi/SKILL.md`
- 非 MQTT 协议通信 → MQ 模块仅支持 MQTT over WebSocket

## 不可违反规则

1. **Host 和认证从环境变量读取** — 代码中不直接传 `host` / `password`，除非覆盖
2. **订阅 QoS 固定为 1** — 内部自动使用 `qos: 1`，publish 默认 `qos: 0`（可覆盖）
3. **handler 接收 (topic, payload) 字符串** — payload 已由 Buffer 转为 string，JSON 需自行 `JSON.parse`
4. **通配符只支持 # 和 +** — `#` 匹配多层，`+` 匹配单层，不支持其他通配符
5. **断连后自动重订阅** — 依赖 mqtt.js 自动重连 + SDK 在 connect 回调中恢复订阅，无需手动处理

## 子技能路由

| 意图 | 加载文件 | 说明 |
|------|---------|------|
| 快速开始与配置 | `references/quickstart.md` | 环境变量、订阅、发布、事件监听 |

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `TIER0_MQTT_HOST` / `VITE_TIER0_MQTT_HOST` | 是 | MQTT Broker 地址，如 `mqtt.tier0.cloud` |
| `TIER0_MQTT_PORT` / `VITE_TIER0_MQTT_PORT` | 否 | MQTT WebSocket 端口（默认 8084） |
| `TIER0_API_KEY` / `VITE_TIER0_API_KEY` | 是 | 认证密钥（作为 MQTT password） |

## 核心概念

| 概念 | 说明 |
|------|------|
| **Topic** | MQTT 主题路径，如 `Plant/Line1/Metric/Temperature` |
| **Handler** | 回调函数 `(topic: string, payload: string) => void`，payload 为字符串 |
| **QoS** | 服务质量：订阅固定 QoS 1，发布默认 QoS 0 |
| **通配符 #** | 匹配多层，如 `home/room/#` 匹配 `home/room/temp`、`home/room/living/light` |
| **通配符 +** | 匹配单层，如 `home/+/temp` 匹配 `home/bedroom/temp` 但不匹配 `home/bedroom/living/temp` |

## 快速示例

### 订阅实时数据（极简）

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

// 无需先调用 connect()，订阅时自动连接
client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  const data = JSON.parse(payload);
  console.log(topic, data);
});
```

### 发布指令

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

await client.publish('Device/PLC1/Cmd', {
  action: 'start',
  param: { speed: 100 },
});
```

### 事件监听

```typescript
const client = new Tier0MQClient();

client.on('connect', () => console.log('已连接'));
client.on('disconnect', () => console.log('已断开'));
client.on('error', (err) => console.error('错误:', err));
```
