---
name: tier0-sdk-mq-quickstart
version: 0.3.1
description: "MQ module quickstart: broker address resolution (parseMqttBroker/toWebSocketUrl), configuration, subscribe, publish, unsubscribe, backpressure, events. All topics follow the UNS naming contract: <business path>/<Metric|Action|State>/<leaf>."
---

# MQ Quickstart

> UNS/MQTT topics are integration plumbing, not UI. Subscribe/publish from server-side actions, services, or workers, map payloads into business domain objects, and push those to the UI. Never render topic strings, wildcards, or `subscribedTopics` to end users, and never build a "MQTT topics" list/monitor page unless the user explicitly asks for a diagnostics/admin tool.

## Contents

- Topic naming and configuration
- Broker address resolution (browser wss)
- Subscribe, wildcards, and multiple handlers
- Publish and UNS payload requirements
- Unsubscribe, lifecycle events, disconnect, and state

## Topic Naming (applies to publish AND subscribe)

Every topic on the Tier0 broker follows the UNS contract — a type folder immediately before the leaf:

```text
<business path>/<Metric|Action|State>/<leaf>

Plant/Line1/Metric/Temperature   ✓ (measurement)
Plant/Line1/Action/StartBatch    ✓ (command/request)
Plant/Line1/State/DeviceStatus   ✓ (status/result)
Plant/Line1/Temperature          ✗ missing type folder
app/events/temperature           ✗ free-form MQTT-style topic
```

The broker does **not** validate topic shape: publishing to a malformed topic "succeeds" but the data is invisible to UNS and other platform consumers. Do not invent free-form topics, even for app-internal channels — model them under the app's business path with the proper type folder so they stay interoperable.

## Configuration

In Node.js, the SDK can read `TIER0_*` environment variables.

| Variable | Required | Description |
|------|------|------|
| `TIER0_MQTT_HOST` | Yes | MQTT WebSocket host injected by the platform/deployment. It may be a full `wss://host:port/mqtt` URL for TLS brokers. |
| `TIER0_MQTT_PORT` | No | MQTT WebSocket port used when a bare host does not embed a port; explicit TCP/MQTT URL ports are not reused |
| `TIER0_API_KEY` | Yes | Original API key used as MQTT password; Cloud/Enterprise `sk-<type>-ws<base36>_<secret>` keys also supply the workspace MQTT identity |

For browser/Vite projects, pass values explicitly from `import.meta.env`; do not rely on automatic `VITE_*` lookup.

For `Tier0MQClient`, a bare `host:port` supplies the WebSocket port (for example, `emqx:8083` uses WS in Node.js). A full `ws://` or `wss://` URL keeps its explicit transport.

A key supplied through `connect({ password })` derives the same workspace identity as a constructor key. When that key changes before a new connection, the SDK recalculates auto-generated username/clientId fields and preserves each field explicitly supplied by the caller. To change credentials on an established connection, disconnect first, then call `connect()` with the new key.

### .env Example

```bash
# Node.js
TIER0_MQTT_HOST=wss://<your-tier0-mqtt-host>:<port>/mqtt
TIER0_API_KEY=<your-api-key>
```

### Runtime Configuration

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  host: process.env.TIER0_MQTT_HOST,
  port: process.env.TIER0_MQTT_PORT ? Number(process.env.TIER0_MQTT_PORT) : undefined,
  password: process.env.TIER0_API_KEY,
});
```

> Use `unsApi.openapiv1unswrite()` when you need the API to validate and write a UNS topic current value. If publishing to a UNS-ingested MQTT topic directly, the MQTT topic must already exist in UNS and the JSON payload keys must match that topic's `fields` schema exactly. For example, a topic with field `temperature` must receive `{"temperature":26.4}`, not `{"value":26.4,"unit":"C"}` unless `value` and `unit` are the actual field names in that topic schema.
>
> **No lazy creation**: never publish to a topic that has not been explicitly modeled. Create it first with the `create` endpoint (declaring `fields`) — do not treat publishing as a way to create topics. A publish to an unmodeled topic is a bug, not a provisioning mechanism.
>
> Default transport split: **HTTP write to send, MQTT subscribe to receive**. Both channels hit the same broker and topics — an HTTP write is delivered to MQTT subscribers in realtime. Reserve direct MQTT `publish` for high-frequency/fan-out sending. See [`../../tier0-sdk-uns/references/data-integration.md`](../../tier0-sdk-uns/references/data-integration.md) → "Transport selection".

### Scheme 自适应（host 不带 ws(s) scheme 时）

host 为裸 `host`/`host:port` 时，SDK 自动选择 scheme：浏览器 https 页面或 WebSocket 端口为 `8084` 时用 `wss`，其他端口的 Node/http 场景用 `ws`；也可用 `secure: true/false` 显式指定。`port` 默认 8084。

```typescript
const client = new Tier0MQClient({ host: 'broker.example.com', secure: true });
// → 连接 wss://broker.example.com:8084/mqtt
```

## Broker Address Resolution（浏览器 wss）

平台 `/openapi/v1/info` 返回的 `data.mqttBroker` **格式随环境变化，不保证统一**（enterprise 常见
`tcp://host:1883`，Cloud/SaaS 常见裸 `host` 或 `host:port`），且它是面向服务端/边缘客户端的连接串，
**浏览器 wss 客户端不能直接把它当 hostname 拼 URL**（`` `wss://${mqttBroker}` `` 会得到
`wss://tcp://...` 这类非法地址）。用 SDK 的 broker 工具归一：

```typescript
import { parseMqttBroker, toWebSocketUrl } from '@tier0/sdk/mq';

// 1) 结构化解析：任何形态都切成 { hostname, port?, scheme? }
parseMqttBroker('tcp://example.tier0.dev:1883');
// → { hostname: 'example.tier0.dev', port: 1883, scheme: 'tcp' }

// 2) 一步到位推导 WebSocket URL（推荐）：tcp 端口不会被误沿用
const wsUrl = toWebSocketUrl(info.data.mqttBroker, { secure: true });
// → 'wss://example.tier0.dev:8084/mqtt'；无法解析时返回 undefined（走回退/报错，勿硬拼）

const client = new Tier0MQClient({ host: wsUrl, password: apiKey });
```

规则：

- 输入已是 `ws(s)://` URL：原样直通（自动补 `/mqtt` 路径，端口保留）；
- 输入 `tcp://host:1883` / `host:port` / 裸 `host`：scheme 按 `secure`（缺省浏览器 https 或 WebSocket 端口 8084 → wss），
  **端口一律用 `wssPort`（默认 8084）**，1883 是 tcp 端口不能给浏览器用；
- 输入为空/无法解析：返回 `undefined`，调用方必须回退或报错。

## Subscribe

### Basic Subscribe

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  console.log(topic, payload);
});
```

### Wildcards

```typescript
// # matches multiple levels
client.subscribe('Plant/Line1/#', (topic, payload) => {
  // matches Plant/Line1/Metric/Temperature
  // matches Plant/Line1/State/DeviceStatus
});

// + matches one level
client.subscribe('Plant/+/Metric/Temperature', (topic, payload) => {
  // matches Plant/Line1/Metric/Temperature
  // matches Plant/Line2/Metric/Temperature
  // does not match Plant/Site1/Line1/Metric/Temperature
});
```

### Backpressure (consumer stalled or gone)

A handler may return `false` to signal "downstream is backpressured" — e.g. the queue it feeds is full, or the browser consumer has disconnected. With `maxBackpressuredDeliveries` configured, the SDK counts consecutive `false` returns and automatically removes the subscription (broker unsubscribe included) once the threshold is hit, emitting `subscriptionDropped`:

```typescript
const client = new Tier0MQClient({
  host: process.env.TIER0_MQTT_HOST,
  password: process.env.TIER0_API_KEY,
  maxBackpressuredDeliveries: 100, // 0 or unset = disabled (default)
});

client.on('subscriptionDropped', ({ topic, reason }) => {
  console.warn('subscription auto-removed:', topic, reason);
});

client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  if (downstreamQueueIsFull()) return false; // counted as backpressured
  downstreamQueue.push(payload);
  return true; // any non-false return resets the counter
});
```

This is a safety net, not a substitute for lifecycle cleanup: always unsubscribe/disconnect when the consumer ends (see below).

### Forwarding to a browser (SSE)

One MQTT client per SSE connection, and cleanup MUST run on both teardown paths — the request abort signal AND the stream `cancel()`. Check `desiredSize` before `enqueue` so messages can never pile up in the stream's internal queue after the consumer stalls or leaves:

```typescript
return new ReadableStream<Uint8Array>({
  async start(controller) {
    const close = () => {
      client.unsubscribe(topicFilter, onMessage);
      client.disconnect();
      try { controller.close(); } catch { /* already closed */ }
    };
    const onMessage = (topic: string, payload: string) => {
      if ((controller.desiredSize ?? 0) <= 0) return false; // drop + report backpressure
      controller.enqueue(toSse(payload));
      return true;
    };
    request.signal.addEventListener('abort', close, { once: true }); // client disconnect
    await client.connect();
    client.subscribe(topicFilter, onMessage);
  },
  cancel() {
    client.disconnect(); // stream cancelled by the server bridge
  },
});
```

> Never `enqueue` unconditionally in a message handler: after the consumer is gone, every message is retained in the stream queue and grows process memory without bound (this caused a production OOM). The app server must also propagate socket close to `request.signal`/`cancel()` — if you hand-roll a `node:http` → fetch bridge, abort the request signal on `res` `'close'` and pipe the response with `stream/promises` `pipeline()`.

### Multiple Handlers for One Topic

```typescript
const handler1 = (topic: string, payload: string) => {
  console.log('handler1:', payload);
};

const handler2 = (topic: string, payload: string) => {
  console.log('handler2:', JSON.parse(payload));
};

client.subscribe('Plant/Line1/Metric/Temperature', handler1);
client.subscribe('Plant/Line1/Metric/Temperature', handler2);
// Both handlers run when the topic receives a message.
```

## Publish

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

// Publish an object; the SDK JSON.stringify()s it.
// Commands/requests go to an Action topic.
await client.publish('Plant/Line1/Action/SetSpeed', {
  speed: 120,
  operator: 'op-01',
});

// Custom qos and retain. Status snapshots go to a State topic.
await client.publish('Plant/Line1/State/DeviceStatus', { status: 'online' }, {
  qos: 2,
  retain: true,
});
```

String payloads are also supported (`client.publish(topic, 'START')`), but UNS-ingested topics expect a JSON object matching the topic's `fields` schema — prefer objects.

### Publishing to a UNS-ingested topic

Only use this when the target topic already exists in UNS and you know the topic schema. The payload is the business object itself; do not wrap it in a generic `value` object unless `value` is actually a schema field.

```typescript
// Existing UNS topic schema:
// Plant/Line1/Metric/Temperature
// fields: [{ name: 'temperature', type: 'float', unit: 'C' }]

await client.publish('Plant/Line1/Metric/Temperature', {
  temperature: 26.4,
});
```

## Unsubscribe

```typescript
// Remove a specific handler.
client.unsubscribe('Plant/Line1/Metric/Temperature', handler1);

// Remove all handlers for a topic.
client.unsubscribe('Plant/Line1/Metric/Temperature');
```

## Events

```typescript
const client = new Tier0MQClient();

client.on('connect', () => {
  console.log('MQ connected');
});

client.on('disconnect', () => {
  console.log('MQ disconnected');
});

client.on('error', (err) => {
  console.error('MQ error:', err);
});

// Fired when a subscription is auto-removed after sustained backpressure
// (only when maxBackpressuredDeliveries is configured).
client.on('subscriptionDropped', ({ topic, reason }) => {
  console.warn('dropped:', topic, reason);
});
```

## Disconnect

```typescript
client.disconnect();
```

## State

```typescript
console.log(client.isConnected);      // boolean
console.log(client.subscribedTopics); // string[]
```
