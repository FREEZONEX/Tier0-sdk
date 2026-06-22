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
| `TIER0_MQTT_HOST` | Yes | MQTT WebSocket host. Use `wss://.../mqtt` for TLS/cloud brokers. |
| `TIER0_MQTT_PORT` | No | MQTT WebSocket port, default `8084`, used only when host has no `ws://` or `wss://` scheme |
| `TIER0_API_KEY` | Yes | API key used as MQTT password |

For browser/Vite projects, pass values explicitly from `import.meta.env`; do not rely on automatic `VITE_*` lookup.

### .env Example

```bash
# Node.js
TIER0_MQTT_HOST=wss://mqtt.example.com/mqtt
TIER0_API_KEY=your-api-key
```

### Runtime Configuration

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient({
  host: 'wss://mqtt.example.com/mqtt',
  password: 'your-api-key',
});
```

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
  // matches Plant/Line1/State/MachineStatus
});

// + matches one level
client.subscribe('Plant/+/Metric/Temperature', (topic, payload) => {
  // matches Plant/Line1/Metric/Temperature
  // matches Plant/Line2/Metric/Temperature
  // does not match Plant/Line1/Living/Metric/Temperature
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
await client.publish('Device/Cmd', 'START');

// Publish an object; the SDK JSON.stringify()s it.
await client.publish('Device/Cmd', {
  action: 'setSpeed',
  params: { speed: 120 },
});

// Custom qos and retain.
await client.publish('Device/Status', 'online', { qos: 2, retain: true });
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
