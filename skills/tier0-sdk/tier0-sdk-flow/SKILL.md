---
name: tier0-sdk-flow
version: 1.0.0
description: "Tier0 SDK Flow management for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use it to create, list, inspect, rename/update, read Node-RED nodes or flowdata, deploy canvas JSON, and delete SourceFlow/EventFlow resources through Tier0 OpenAPI. Use for @tier0/sdk Flow or Node-RED lifecycle tasks."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Flow

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md).**

## Guardrails

- Read the matching reference before every Flow operation.
- Before editing/deploying Node-RED JSON, fetch the existing flowdata and preserve the system-created `mqtt-broker` config node and its ID.
- Treat deploy as a full-canvas replacement; retain required system nodes and validate the complete JSON before sending.
- Use the Tier0 CLI Skill protocol references when constructing SourceFlow/EventFlow Node-RED protocol JSON.

## References

| Task | Read |
|---|---|
| Create | [`references/create.md`](references/create.md) |
| List | [`references/list.md`](references/list.md) |
| Get metadata | [`references/get.md`](references/get.md) |
| Update metadata | [`references/update.md`](references/update.md) |
| Get nodes | [`references/nodes.md`](references/nodes.md) |
| Get canvas flowdata | [`references/flowdata.md`](references/flowdata.md) |
| Deploy canvas | [`references/deploy.md`](references/deploy.md) |
| Delete | [`references/delete.md`](references/delete.md) |

## Final Checklist

1. Existing flowdata was inspected before canvas changes.
2. The system MQTT broker node and ID are preserved.
3. Deploy sends the intended full canvas.
