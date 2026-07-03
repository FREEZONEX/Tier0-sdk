---
name: tier0-sdk-concepts
version: 0.1.2
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

UNS is a backend data source for application pages, not a standalone frontend module. Think of it as the app's database / integration layer: the app reads from it, writes to it, and subscribes to it — it is never the product surface itself.

Mental model:

- A topic is an integration channel (like a DB table or a REST endpoint), not a UI object. A topic path such as `Plant/Line1/Metric/Temperature` is plumbing, not a label to show users.
- UNS APIs sit behind page-level data services: server actions, API routes, services, hooks, or stores that read/write/subscribe to the specific topic paths a screen needs.
- The UI presents domain objects and workflows (equipment, orders, alarms, KPIs); it does not present UNS as its own product surface.

Default application behavior:

- Use UNS to supply data to business pages: dashboards, forms, alarms, equipment views, order flows, KPI cards, and similar screens.
- Read/write/subscribe only the topic paths required by each feature, from a service/data layer.
- Shape screens around user tasks, equipment, orders, alerts, KPIs, or other business concepts.
- Never surface these to ordinary users: topic paths, MQTT topics, wildcards, `Metric`/`Action`/`State` folders, or the UNS tree hierarchy. Do not render raw VQT / `JSON.stringify(response)` as the UI.
- Do not create a dedicated UNS page, tree viewer, topic explorer, or "namespace module" as the main app experience.

Only expose the UNS hierarchy when the user explicitly asks for a namespace browser, topic administration, diagnostics, or data-modeling UI.

This section covers the inbound direction (app reads from UNS). When the app **owns** business data (orders, work orders, results) and must publish/sync it outbound to UNS, or when deciding what belongs in the app DB vs UNS, read `references/core/data-integration.md`.

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
