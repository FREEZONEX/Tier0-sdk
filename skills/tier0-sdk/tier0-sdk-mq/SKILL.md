---
name: tier0-sdk-mq
version: 1.0.0
description: "Tier0 SDK MQTT/MQ over WebSocket for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. When any MQTT subscribe, publish, or wildcard targets Tier0 UNS topics, reading tier0-sdk-uns first is mandatory because UNS topic paths, modeling, ownership, and payload schemas are constrained. Use for continuously changing or realtime data, high-frequency/fan-out messages, and MQTT connection, wildcard, handler, unsubscribe, and shutdown lifecycle through @tier0/sdk/mq. Not for generic external brokers or implementing a broker."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — MQTT/MQ

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md). If MQTT will subscribe to, publish to, or match any Tier0 UNS Topic, you must then read [`../tier0-sdk-uns/SKILL.md`](../tier0-sdk-uns/SKILL.md) before designing the Topic or writing code.**

## UNS MQTT Prerequisite

- Treat reading the UNS Skill as mandatory for every MQTT operation involving UNS data, including wildcard subscriptions that match UNS Topics.
- Use the UNS Skill to confirm the concrete Topic path, `Metric|Action|State` type folder, explicit Topic creation, ownership, `fields` schema, and whether `enableHistory` is enabled.
- MQTT accepts arbitrary valid Topic filters, but that protocol capability does not waive UNS rules. A wildcard filter may contain `+` or `#`; every concrete UNS Topic it is intended to match must still follow the UNS contract.
- Before direct MQTT `publish`, confirm that the UNS Topic already exists and that the JSON payload keys match its modeled `fields` exactly.

## Transport Rules

- Use MQTT `subscribe` for continuously changing, realtime, monitoring, watch, auto-refresh, or event-stream receive.
- Never poll OpenAPI `read` with a timer, refetch interval, or loop to simulate realtime.
- Default to HTTP/OpenAPI `write` for validated sends and MQTT `subscribe` for receive.
- Reserve direct MQTT `publish` for high-frequency or fan-out sending; its payload must match the modeled Topic schema exactly.
- Use OpenAPI `history` for reconnect backfill only when `enableHistory` is enabled.
- Own long-lived subscriptions in a server runtime, service, or worker with explicit disconnect/shutdown handling; do not create durable subscriptions in component render paths.

Read [`references/quickstart.md`](references/quickstart.md) before implementing connection, subscribe, publish, wildcard, handler, unsubscribe, event, or disconnect behavior.

## Final Checklist

1. For any UNS MQTT operation, the UNS Skill was read first.
2. The broker is the Tier0 endpoint and runtime configuration supplies its host/credentials.
3. Continuous receive uses `subscribe`, not polling.
4. Concrete UNS Topic paths and payload fields match the modeled UNS schema, including when the subscription uses wildcards.
5. The connection has a clear owner and shutdown path.
