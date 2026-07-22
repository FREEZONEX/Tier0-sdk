---
name: tier0-sdk-mq
version: 1.0.0
description: "Tier0 SDK MQTT/MQ over WebSocket for TypeScript/JavaScript. Use when data must be received continuously or in realtime, when subscribing to Tier0 UNS topics, when publishing high-frequency/fan-out messages, or when managing MQTT connection, wildcard, handler, unsubscribe, and shutdown lifecycle through @tier0/sdk/mq. Not for generic external brokers or implementing a broker."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — MQTT/MQ

**Before starting, read [`../tier0-sdk/SKILL.md`](../tier0-sdk/SKILL.md). For UNS topic schemas and ownership, also read [`../tier0-sdk-uns/SKILL.md`](../tier0-sdk-uns/SKILL.md).**

## Transport Rules

- Use MQTT `subscribe` for continuously changing, realtime, monitoring, watch, auto-refresh, or event-stream receive.
- Never poll OpenAPI `read` with a timer, refetch interval, or loop to simulate realtime.
- Default to HTTP/OpenAPI `write` for validated sends and MQTT `subscribe` for receive.
- Reserve direct MQTT `publish` for high-frequency or fan-out sending; its payload must match the modeled Topic schema exactly.
- Use OpenAPI `history` for reconnect backfill only when `enableHistory` is enabled.
- Own long-lived subscriptions in a server runtime, service, or worker with explicit disconnect/shutdown handling; do not create durable subscriptions in component render paths.

Read [`references/quickstart.md`](references/quickstart.md) before implementing connection, subscribe, publish, wildcard, handler, unsubscribe, event, or disconnect behavior.

## Final Checklist

1. The broker is the Tier0 endpoint and runtime configuration supplies its host/credentials.
2. Continuous receive uses `subscribe`, not polling.
3. Topic paths and payload fields match the UNS schema.
4. The connection has a clear owner and shutdown path.
