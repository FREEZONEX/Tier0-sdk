---
name: tier0-sdk-mq-quickstart
version: 0.2.1
description: "MQ module quickstart: configuration, subscribe, publish, unsubscribe, events. All topics follow the UNS naming contract: <business path>/<Metric|Action|State>/<leaf>."
---

# MQ Quickstart

> UNS/MQTT topics are integration plumbing, not UI. Subscribe/publish from server-side actions, services, or workers, map payloads into business domain objects, and push those to the UI. Never render topic strings, wildcards, or `subscribedTopics` to end users, and never build a "MQTT topics" list/monitor page unless the user explicitly asks for a diagnostics/admin tool.

## Contents

- Topic naming and configuration
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
| `TIER0_MQTT_PORT` | No | MQTT WebSocket port, used only when host has no `ws://` or `wss://` scheme |
| `TIER0_API_KEY` | Yes | API key used as MQTT password |

For browser/Vite projects, pass values explicitly from `import.meta.env`; do not rely on automatic `VITE_*` lookup.

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
