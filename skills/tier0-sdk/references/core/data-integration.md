---
name: tier0-sdk-data-integration
version: 0.1.0
description: "Application data-integration shapes with Tier0 UNS: when app-owned data syncs outbound to UNS topics, when to read inbound from UNS, and command round-trips. Read when deciding what data flows through UNS vs the app database."
---

# Data Integration Shapes

Read this when deciding how an app's data relates to UNS — especially when the app owns business data (orders, work orders, quality results) that should be shared with the platform.

The app (MonoApp/template) has its own database and is the **system of record** for the business entities it owns. UNS is the platform-wide **integration bus** for operational data shared across apps, devices, and Flows. Integration direction is a **per-data-element decision**, not an app-wide mode: one app is commonly inbound for some data and outbound for other data at the same time.

## Three Directions

### 1. Inbound — UNS → app (consume)

Two sub-cases with **opposite** persistence rules:

- **Live / reference state** (device telemetry, upstream line status, current values another system owns): read / history / subscribe on demand. Do **not** persist it as the app's source of truth — copying continuously-changing shared state into the app DB causes drift. Cache only if a feature needs it. This is the default "UNS is a data source" case (see `concepts.md`).
- **Ingested events / records** (a discrete business message delivered to the app — a new order, a dispatched work order, an inbound instruction): the app consumes the message, persists it (落库), and owns its lifecycle from then on. Here UNS/MQTT is the **transport** and the app DB **becomes** the source of truth for that record. Subscribe or read the event, dedupe by message/business key (deliveries can repeat), then write it in a normal service transaction. If the app later mutates the record and the platform needs the result, mirror it back out (direction 2).

### 2. Outbound — app → UNS (publish/sync)

Data the app **owns** in its DB: orders, work orders, inspection results, KPIs it computes. After the local write commits, sync the current business state to a UNS topic so the rest of the platform can consume it. The app DB stays the source of truth; the UNS topic is an integration **mirror**.

Example: the app has an Orders table. On create or status change, publish the order's current state to a UNS `State` topic keyed by order id.

### 3. Command round-trip — app → UNS `Action` → device/Flow → `State`/`Metric` → app

The app issues a command to an `Action` topic (or via MQ), a device/Flow executes, and the result returns on a `State`/`Metric` topic the app reads or subscribes to. Model the request and the result as separate topics.

## What Lives Where

| | App database | UNS |
|---|---|---|
| Role | System of record for app-owned entities | Cross-app integration + realtime + history |
| Guarantees | Relational integrity, transactions, audit | Current value (VQT) + history per topic |
| Put here | Orders, BOM, internal workflow state | Operational data other systems/devices need |

- Continuously-changing shared/live state you don't own: read it from UNS; don't copy it into the app DB as source of truth (drift risk).
- Discrete inbound events/records the app is responsible for (e.g. an order arriving as a message): ingest and persist them — the app becomes the source of truth for that record's lifecycle; UNS/MQTT was the transport.
- Don't use UNS as the app's primary transactional database.
- Only sync business-meaningful fields and state transitions outbound, not internal-only columns.

## Outbound Sync Pattern (order example)

Keep sync in the service layer (matches the template's three-layer architecture). Sync **after** the DB transaction commits, and make it **best-effort**: a UNS outage must not fail the user's operation, because the DB — not UNS — is the source of truth.

Topic modeling for app-produced data:

- Namespace under the app/business area (resolve the app name from the spec, not `package.json`).
- Pick the type folder by semantics: `State` for entity snapshots/status, `Metric` for quantities/measurements/time-series, `Action` for commands.
- Carry a stable business key in the `value` and set `timeStamp`.

```typescript
// src/services/order-uns-sync.ts
import { getTier0UnsApi } from '@/lib/tier0';
import type { Order } from '@/db/schema';

// Best-effort mirror of an order's current state into UNS.
export async function syncOrderToUns(order: Order): Promise<void> {
  try {
    const unsApi = await getTier0UnsApi();
    await unsApi.openapiv1unswrite({
      writes: [
        {
          topic: 'Acme/Sales/State/Order',
          value: {
            orderId: order.id,
            status: order.status,
            customer: order.customerName,
            total: order.total,
          },
          timeStamp: Date.now(),
        },
      ],
    });
  } catch (err) {
    // UNS is a mirror, not the source of truth: log and move on (or enqueue a retry).
    console.error('UNS order sync failed', order.id, err);
  }
}
```

```typescript
// src/services/orders.ts (excerpt)
export async function advanceOrder(id: string, toStatus: string, actorId: string) {
  const order = await db.transaction(async (tx) => {
    // ... validate transition, update row, write audit event ...
    return updated;
  });

  // After commit: mirror to UNS for the rest of the platform. Non-blocking on failure.
  await syncOrderToUns(order);
  return order;
}
```

Notes:

- Per-event write-through (on each mutation) keeps the UNS value fresh. Add a periodic reconciliation/backfill job if correctness across missed writes matters.
- The current-value topic is last-write-wins; include `updatedAt`/version in the `value` if consumers must detect ordering.
- For high-frequency or fan-out publishing, use `@tier0/sdk/mq` from a server worker instead of per-request writes (see `references/mq/quickstart.md`).

## Still Not A UI

Outbound sync is backend plumbing. Users still see the domain screen (the Orders page); they never see the UNS topic, the sync, or the topic path. The data-source rule in `SKILL.md` applies to **both** directions.
