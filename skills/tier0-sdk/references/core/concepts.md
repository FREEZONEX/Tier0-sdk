---
name: tier0-sdk-concepts
version: 0.1.0
description: "Tier0 SDK domain concepts: Workspace, UNS, topics, VQT, topic types, and Flow relationships."
---

# Concepts

Use this file when an agent needs Tier0 domain context before selecting SDK APIs or modeling UNS/Flow resources.

## Core Terms

| Term | Meaning |
|---|---|
| Workspace | Tenant boundary for resources and permissions |
| UNS | Unified Namespace, a tree of paths and data-point topics |
| PATH | Folder node in the UNS tree |
| TOPIC | Leaf data-point node that can be read/written |
| Topic path | Full string path such as `Plant/Line1/Metric/Temperature` |
| VQT | Current/historical value shape: `value`, `quality`, `timeStamp` |
| SourceFlow | Node-RED flow for collecting or generating source data |
| EventFlow | Node-RED flow for subscribing to events and transforming/processing data |

Only TOPIC leaf nodes can be used with `read`, `write`, and `history`. PATH nodes are for `browse` and organization.

## UNS In Applications

When building an end-user application, treat UNS as a data center for operational values, commands, state, and history. The app UI should usually present domain objects and workflows, not the UNS path hierarchy.

Default application behavior:

- Read/write the specific topic paths needed by the feature.
- Shape screens around user tasks, equipment, orders, alerts, KPIs, or other business concepts.
- Hide namespace folders and path segments from ordinary users unless they are meaningful business labels.

Only expose the UNS hierarchy when the user explicitly asks for a namespace browser, topic administration, diagnostics, or data-modeling UI.

## UNS Topic Types

Topic paths must use a type folder immediately before the leaf:

```text
Plant/Line1/Metric/Temperature
Plant/MES/Action/StartWorkOrder
Plant/MES/State/WorkOrderStatus
```

| Type folder | Use | Data shape |
|---|---|---|
| `Metric` | Realtime/time-series measurements and operational values | Flat object fields; fields required for creation |
| `Action` | Downstream commands or integration requests | JSON object; nested structures allowed |
| `State` | Results, acknowledgements, or state snapshots | JSON object; nested structures allowed |

Do not rely on the SDK to insert `Metric`, `Action`, or `State`; include the segment in the path.

## VQT

Read/history results return values similar to:

```typescript
{
  value: { temperature: 27.5, unit: 'C' },
  quality: 'Good',
  timeStamp: 1782108520121
}
```

`quality` can indicate no data or bad data. Treat non-`Good` values carefully instead of assuming `value` is usable.

## Flow and UNS Relationship

Flow names and UNS topic paths are often related, but they are different resources:

- Use UNS APIs to inspect or manipulate data topics.
- Use Flow APIs to inspect or manipulate Node-RED runtime configuration.
- When a user asks about a device/data point and its source, query both UNS and Flow where relevant.

Flow REST APIs use integer `id`. The string `flowId` is a Node-RED internal ID and must not be used as the REST parameter.

## Batch Response Pattern

Many UNS endpoints return an outer success envelope plus per-item results:

```typescript
const apiOk = body.code === 200;
const businessOk =
  typeof body.data?.success === 'boolean'
    ? body.data.success
    : apiOk;

for (const item of body.data?.results ?? []) {
  if (!item.success) {
    // inspect item.topic and item.error?.message
  }
}
```

For batch endpoints, HTTP 200 and outer `code: 200` are not enough; inspect `data.success` and each result item.
