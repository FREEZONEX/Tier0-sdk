---
name: tier0-sdk-mq-quickstart
version: 0.1.0
description: "MQ module quickstart: configuration, subscribe, publish, unsubscribe, events"
---

# MQ Quickstart

## Configuration

In Node.js, the SDK can read `TIER0_*` environment variables.

| Variable | Required | Description |
|------|------|------|
| `TIER0_MQTT_HOST` | Yes | MQTT WebSocket host. Use a full `wss://host:port/mqtt` URL for TLS/cloud brokers. |
| `TIER0_MQTT_PORT` | No | MQTT WebSocket port, default `8084`, used only when host has no `ws://` or `wss://` scheme. For `mqtt.pre.tier0.dev`, plain WebSocket is `8083` and TLS WebSocket is `8084`. |
| `TIER0_API_KEY` | Yes | API key used as MQTT password |

For browser/Vite projects, pass values explicitly from `import.meta.env`; do not rely on automatic `VITE_*` lookup.

### .env Example

```bash
# Node.js
TIER0_MQTT_HOST=wss://mqtt.pre.tier0.dev:8084/mqtt
TIER0_API_KEY=your-api-key
```

### Runtime Configuration

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  host: 'wss://mqtt.pre.tier0.dev:8084/mqtt',
  password: 'your-api-key',
});
```

> Use `unsApi.openapiv1unswrite()` when you need the API to validate and write a UNS topic current value. If publishing to a UNS-ingested MQTT topic directly, the MQTT topic must already exist in UNS and the JSON payload keys must match that topic's `fields` schema exactly. For example, a topic with field `temperature` must receive `{"temperature":26.4}`, not `{"value":26.4,"unit":"C"}` unless `value` and `unit` are the actual field names in that topic schema.

## Subscribe

### Basic Subscribe

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

client.subscribe('app/events/temperature', (topic, payload) => {
  console.log(topic, payload);
});
```

### Wildcards

```typescript
// # matches multiple levels
client.subscribe('app/events/#', (topic, payload) => {
  // matches app/events/temperature
  // matches app/events/line1/status
});

// + matches one level
client.subscribe('app/+/temperature', (topic, payload) => {
  // matches app/line1/temperature
  // matches app/line2/temperature
  // does not match app/site/line1/temperature
});
```

### Multiple Handlers for One Topic

```typescript
const handler1 = (topic: string, payload: string) => {
  console.log('handler1:', payload);
};

const handler2 = (topic: string, payload: string) => {
  console.log('handler2:', JSON.parse(payload));
};

client.subscribe('sensor/temp', handler1);
client.subscribe('sensor/temp', handler2);
// Both handlers run when the topic receives a message.
```

## Publish

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

// Publish a string.
await client.publish('app/device/cmd', 'START');

// Publish an object; the SDK JSON.stringify()s it.
await client.publish('app/device/cmd', {
  action: 'setSpeed',
  params: { speed: 120 },
});

// Custom qos and retain.
await client.publish('app/device/status', 'online', { qos: 2, retain: true });
```

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
client.unsubscribe('sensor/temp', handler1);

// Remove all handlers for a topic.
client.unsubscribe('sensor/temp');
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
