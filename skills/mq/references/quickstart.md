---
name: tier0-sdk-mq-quickstart
version: 0.1.0
description: "MQ 模块快速开始：环境变量配置、订阅、发布、取消订阅、事件监听"
---

# MQ 快速开始

## 环境变量配置

| 变量 | 必需 | 说明 |
|------|------|------|
| `TIER0_MQTT_URL` / `VITE_TIER0_MQTT_URL` | 是 | MQTT WebSocket 地址，如 `wss://mqtt.tier0.cloud` |
| `TIER0_API_KEY` / `VITE_TIER0_API_KEY` | 是 | 认证密钥（作为 MQTT password） |

### .env 文件示例

```bash
# Node.js
TIER0_MQTT_URL=wss://mqtt.tier0.cloud
TIER0_API_KEY=your-api-key

# Vite 前端
VITE_TIER0_MQTT_URL=wss://mqtt.tier0.cloud
VITE_TIER0_API_KEY=your-api-key
```

### 运行时传入（覆盖环境变量）

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  url: 'wss://mqtt.tier0.cloud',
  password: 'your-api-key',
});
```

## 订阅

### 基础订阅

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  console.log(topic, payload);
});
```

### 通配符订阅

```typescript
// # 匹配多层
client.subscribe('Plant/Line1/#', (topic, payload) => {
  // 匹配 Plant/Line1/Metric/Temperature
  // 匹配 Plant/Line1/State/MachineStatus
});

// + 匹配单层
client.subscribe('Plant/+/Metric/Temperature', (topic, payload) => {
  // 匹配 Plant/Line1/Metric/Temperature
  // 匹配 Plant/Line2/Metric/Temperature
  // 不匹配 Plant/Line1/Living/Metric/Temperature
});
```

### 同一 topic 多 handler

```typescript
const handler1 = (topic: string, payload: string) => {
  console.log('handler1:', payload);
};

const handler2 = (topic: string, payload: string) => {
  console.log('handler2:', JSON.parse(payload));
};

client.subscribe('sensor/temp', handler1);
client.subscribe('sensor/temp', handler2);
// 同一 topic 收到消息时，两个 handler 都会触发
```

## 发布

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

// 发布字符串
await client.publish('Device/Cmd', 'START');

// 发布对象（内部 JSON.stringify）
await client.publish('Device/Cmd', {
  action: 'setSpeed',
  params: { speed: 120 },
});

// 自定义 qos 和 retain
await client.publish('Device/Status', 'online', { qos: 2, retain: true });
```

## 取消订阅

```typescript
// 取消特定 handler
client.unsubscribe('sensor/temp', handler1);

// 取消 topic 下所有 handler
client.unsubscribe('sensor/temp');
```

## 事件监听

```typescript
const client = new Tier0MQClient();

client.on('connect', () => {
  console.log('MQ 已连接');
});

client.on('disconnect', () => {
  console.log('MQ 已断开');
});

client.on('error', (err) => {
  console.error('MQ 错误:', err);
});
```

## 断开连接

```typescript
client.disconnect();
```

## 状态检查

```typescript
console.log(client.isConnected);      // boolean
console.log(client.subscribedTopics); // string[]
```
