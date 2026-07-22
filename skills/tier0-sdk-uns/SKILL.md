---
name: tier0-sdk-uns
version: 1.0.0
description: "Tier0 SDK UNS operations and modeling for TypeScript/JavaScript: browse/search namespace nodes, create/update/delete/restore modeled topics, read current VQT values, write data, query history, design topic schemas, integrate app-owned data, and choose UNS versus an app database. Use for any @tier0/sdk task involving UNS paths or topic data. Continuous/realtime receive routes to tier0-sdk-mq."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — UNS

**Before starting, read [`../tier0-sdk/SKILL.md`](../tier0-sdk/SKILL.md) for shared version, configuration, runtime, and layering rules.**

## Core Rules

- Treat UNS as a backend data/integration layer, not a user interface. Keep topic paths, wildcards, VQT, and the namespace tree out of ordinary UI.
- Every topic path must match `^.+/(Metric|Action|State)/[^/]+$`.
- Create modeled topics explicitly before writing or publishing. Never rely on lazy creation.
- Never guess request payload shapes or field values. Read the matching endpoint reference before composing a body.
- Inspect both the outer batch result and every item-level `success` value.

## Receive Strategy

- **Read once**: use OpenAPI `read` for a one-time current-value snapshot.
- **Continuously changing, realtime, or always listening**: read [`../tier0-sdk-mq/SKILL.md`](../tier0-sdk-mq/SKILL.md) and use MQTT `subscribe`; never poll OpenAPI `read`.
- **Reconnect backfill**: use OpenAPI `history` only when the Topic was created with `enableHistory` enabled.

## References

| Task | Read |
|---|---|
| Concepts, application boundary, topic types, VQT | [`references/concepts.md`](references/concepts.md) |
| App DB ownership, inbound/outbound sync, event streams, Action → State | [`references/data-integration.md`](references/data-integration.md) |
| Browse or discover paths | [`references/browse.md`](references/browse.md) |
| Create modeled nodes/topics and schemas | [`references/create.md`](references/create.md) |
| Read a current snapshot | [`references/read.md`](references/read.md) |
| Write values | [`references/write.md`](references/write.md) |
| Query history | [`references/history.md`](references/history.md) |
| Search nodes | [`references/search.md`](references/search.md) |
| Update metadata/schema | [`references/update.md`](references/update.md) |
| Delete or restore nodes | [`references/delete.md`](references/delete.md), [`references/restore.md`](references/restore.md) |

## Final Checklist

1. Topic paths follow the `Metric|Action|State` contract.
2. Topics are explicitly modeled before write/publish.
3. Continuous receive uses MQTT, not OpenAPI polling.
4. History is used only when enabled.
5. Batch item failures are handled.
