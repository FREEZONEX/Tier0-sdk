---
name: tier0-sdk-data-integration
version: 0.3.0
description: "Application data-integration shapes with Tier0 UNS: when app-owned data syncs outbound to UNS topics, when to read inbound from UNS, topic granularity design (merge/split criteria, anti-patterns), and async request–response (Action/State round-trip) design: correlation ids, shared topic as event stream, timeouts, idempotency. Read when deciding what data flows through UNS vs the app database, or how many topics to model."
---

# Data Integration Shapes

Read this when deciding how an app's data relates to UNS — especially when the app owns business data (orders, work orders, quality results) that should be shared with the platform.

The app (MonoApp/template) has its own database and is the **system of record** for the business entities it owns. UNS is the platform-wide **integration bus** for operational data shared across apps, devices, and Flows. Integration direction is a **per-data-element decision**, not an app-wide mode: one app is commonly inbound for some data and outbound for other data at the same time.

## Three Directions

### 1. Inbound — UNS → app (consume)

Two sub-cases with **opposite** persistence rules:

- **Live / reference state** (device telemetry, upstream line status, current values another system owns): read / history / subscribe on demand. Do **not** persist it as the app's source of truth — copying continuously-changing shared state into the app DB causes drift. Cache only if a feature needs it. This is the default "UNS is a data source" case (see `concepts.md`).
- **Ingested events / records** (a discrete business message delivered to the app — a new order, a dispatched work order, an inbound instruction): the app consumes the message, persists it into the app database, and owns its lifecycle from then on. Here UNS/MQTT is the **transport** and the app DB **becomes** the source of truth for that record. Subscribe or read the event, dedupe by message/business key (deliveries can repeat), then write it in a normal service transaction. If the app later mutates the record and the platform needs the result, mirror it back out (direction 2).

### 2. Outbound — app → UNS (publish/sync)

Data the app **owns** in its DB: orders, work orders, inspection results, KPIs it computes. After the local write commits, sync the current business state to a UNS topic so the rest of the platform can consume it. The app DB stays the source of truth; the UNS topic is an integration **mirror**.

Example: the app has an Orders table. On create or status change, publish the order's current state to **one shared** UNS `State` topic for the entity type (e.g. `.../State/Order`), carrying the order id **inside the payload**. Do not create one topic per record.

### 3. Command round-trip — app → UNS `Action` → device/Flow → `State`/`Metric` → app

The app issues a command to an `Action` topic (or via MQ), a device/Flow/system executes, and the result returns on a `State`/`Metric` topic the app reads or subscribes to. Model the request and the result as separate topics — never try to "read back" a result from the `Action` topic itself.

This asynchronous request–response is the most design-sensitive UNS pattern. Read "Async Request–Response Design" below before modeling one.

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

## Topic Granularity

The unit of design: **one topic = one schema = one subscription decision = one
business meaning.** A consumer either needs a topic's payload as a whole or
does not subscribe to it. Apply these as judgment tests, not formulas:

**Fields belong in the same topic when** (batch what belongs together):

- They come from the same business entity or the same measurement point and
  always change together (temperature + humidity from one sensor → one `Metric`
  topic with two fields).
- Consumers always need them at the same time.
- They share one update cadence and one lifecycle.

**Split into separate topics when**:

- Different entity types (`State/Order` vs `State/Shipment`) — never merge.
- Different type semantics — measurements, commands, and statuses already
  belong to different `Metric`/`Action`/`State` topics by contract.
- Different consumer sets — if some consumers want only alarms and not
  telemetry, merging forces every subscriber to process noise.
- Update rates differ by an order of magnitude (1 s telemetry and daily KPIs
  do not share a stream).

**Anti-patterns** (each one has broken real integrations):

| Anti-pattern | Why it fails |
|---|---|
| Topic per record (`State/<uuid>`) | Namespace mirrors table rows; forbidden — see the naming rule in `uns/create.md` |
| Topic per scalar (`Metric/Temp`, `Metric/TempUnit`, …) | Consumers must stitch N subscriptions to reconstruct one object |
| Mega-topic (`State/AppData` carrying everything) | Schema loses meaning, no selective subscription, namespace loses discoverability — UNS reduced to a message pipe |
| Mirroring the DB schema 1:1 into topics | The namespace should be designed from the **consumer's** viewpoint, not the storage layout |

**Count signal (review trigger, not a quota)**: a typical application publishes
single digits to about a dozen topics — one shared `State` per entity type, a
`Metric` per genuinely independent measurement, an `Action` per command type.
A publish list well beyond that is a signal to re-check each topic against the
split/merge tests above — not a limit to contort a genuinely large integration
surface into. Per-instance topics for small, long-lived named sets (equipment,
stations) are legitimate and sit outside this signal.

Declare the outcome of these decisions in the app's integration manifest —
see `references/core/integration-manifest.md`.

## Outbound Sync Pattern (order example)

Keep sync in the service layer (matches the template's three-layer architecture). Sync **after** the DB transaction commits, and make it **best-effort**: a UNS outage must not fail the user's operation, because the DB — not UNS — is the source of truth.

Topic modeling for app-produced data:

- Namespace under the app/business area (resolve the app name from the spec, not `package.json`).
- Pick the type folder by semantics: `State` for entity snapshots/status, `Metric` for quantities/measurements/time-series, `Action` for commands.
- **One shared topic per entity type** (`CRM/Sales/State/Order`), created once as schema. The entity id (`orderId`) is a payload field, not a path segment. Never create one topic per DB row, and never use a UUID/primary key as a node name — the namespace is a fixed schema, not a mirror of table rows. Per-instance topics are acceptable only for small, long-lived, named sets (equipment, stations, lines), and even then the leaf is a business name (`Packer01`), not an id. See "Shared topic is an event stream" below.
- Carry a stable business key in the `value` and set `timeStamp`.
- Consumers answer "what is the state of instance X" from their own DB (after ingesting the stream), not by reading the shared topic.

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

## Async Request–Response Design (Action → State)

MQTT is not HTTP: writing to an `Action` topic has no response channel. The result arrives asynchronously on a **different** topic. Four decisions must be made explicitly; skipping any of them produces integrations that look correct but cannot be operated.

Running example — a CRM requests a stock transfer from a WMS:

| Data | Direction | Topic | Source of truth |
|---|---|---|---|
| Order snapshot sync | CRM → platform (outbound mirror) | `CRM/Sales/State/Order` | CRM DB |
| Transfer request (command) | CRM → WMS | `WMS/Inventory/Action/TransferRequest` | — (message in flight) |
| Transfer order status | WMS → platform (outbound mirror) | `WMS/Inventory/State/TransferOrder` | WMS DB |

### 1. Correlate by request id

MQTT has no request/response pairing. The `Action` payload must carry a stable business key (`requestId`); the responder echoes it in every `State` update; the requester matches results on it.

```jsonc
// Action: WMS/Inventory/Action/TransferRequest
{ "requestId": "TR-2026-0042", "sku": "SKU-1", "qty": 20, "toWarehouse": "WH-2" }

// State: WMS/Inventory/State/TransferOrder
{ "requestId": "TR-2026-0042", "status": "processing", "updatedAt": 1782108520121 }
```

When creating these topics, declare the payload keys as `fields` (`requestId`, `status`, …) — `Action`/`State` topics without `fields` have no visible schema in UNS, and consumers cannot discover the contract. Cover nested parts with an example payload in `description`. See `references/openapi/uns/create.md`.

### 2. Shared topic is an event stream, not a state table

A UNS topic's current value is last-write-wins. `read` on a shared `State/TransferOrder` topic returns only the **most recently updated** order — not "the status of order X". Choose the topic granularity deliberately:

- **Shared topic as event stream** (default for business entities like orders): all instances flow through one topic. Consumers subscribe, dedupe by business key, and persist per-instance status **in their own DB**. Per-instance current state lives in databases; the topic's current value has no business meaning.
- **Per-instance topics** (one leaf per entity id): clean `read` semantics, but the namespace grows with entity count and needs creation/cleanup policy. Reserve for small, long-lived sets (equipment, stations) — not orders.

Never `read` a shared event-stream topic to answer "what is the status of instance X"; query the consumer's DB.

### 3. Both sides persist; UNS is transport plus replay buffer

- **Responder (WMS)**: ingests the `Action`, dedupes by `requestId` (MQTT deliveries can repeat), persists a transfer order in its DB, and owns its lifecycle from then on. After each local status transition commits, it mirrors the snapshot to the `State` topic (outbound sync, direction 2).
- **Requester (CRM)**: persists its request locally, subscribes to the `State` topic, and updates its local record keyed by `requestId`. It answers "what is the status of TR-0042" from its own DB, never from the topic.
- **UNS**: provides realtime delivery plus a replay buffer. If a consumer was down, it backfills by querying `history` for the gap and deduping by business key.

This is the "discrete business event" case from direction 1: consumers persist events they are responsible for. The "don't copy shared state into your DB" rule applies to continuous telemetry, not to these events.

### 4. Status machine, timeout, idempotency

- `write` success means the broker accepted the message, not that the responder executed it.
- Define an explicit status machine advanced only by the owner, e.g. `requested → accepted → processing → completed | failed`, carried in the `State` payload.
- The requester sets a timeout: no `accepted` or terminal status within the deadline → mark the request timed-out, then alert or retry.
- Retries re-send the **same** `requestId`; the responder treats duplicates idempotently.
- Guard against out-of-order delivery: ignore a `State` event whose `updatedAt` is older than the locally stored one.

### Transport selection: HTTP to send, MQTT to receive

The SDK's two channels converge on the same broker and topics: `openapiv1unswrite` is a **validated publish** — the message reaches MQTT subscribers in realtime and updates current value + history, exactly like a direct MQTT publish. Pick per direction:

| Direction | Default | Why |
|---|---|---|
| Send (Action command, State mirror) | HTTP `openapiv1unswrite` | Schema validation against `fields`, per-item success feedback, no long-lived connection; fits low-frequency, after-commit writes |
| Receive (State results, event streams) | MQTT `subscribe` (`@tier0/sdk/mq`) | HTTP can only poll `read`; on a shared event-stream topic, polling **loses intermediate messages** (last-write-wins). Subscribe for realtime, `history` for backfill |
| High-frequency / fan-out send (telemetry) | MQTT `publish` | Lower overhead, but no validation — payload must match the topic's `fields` schema exactly |

Do not poll `read` as a substitute for subscribing to an event stream, and do not open an MQTT connection just to send one command when an HTTP write does the job with validation.

### Minimal requester flow (CRM side)

```typescript
// 1. Persist the request locally, then publish the command.
await db.transferRequests.insert({ id: 'TR-2026-0042', status: 'requested' /* ... */ });
await unsApi.openapiv1unswrite({
  writes: [{
    topic: 'WMS/Inventory/Action/TransferRequest',
    value: { requestId: 'TR-2026-0042', sku: 'SKU-1', qty: 20, toWarehouse: 'WH-2' },
    timeStamp: Date.now(),
  }],
});

// 2. A long-lived server-side subscriber updates local status as State events arrive.
client.subscribe('WMS/Inventory/State/TransferOrder', async (_topic, payload) => {
  const evt = JSON.parse(payload);
  // Idempotent, ordering-safe update keyed by requestId.
  await db.transferRequests.updateStatusIfNewer(evt.requestId, evt.status, evt.updatedAt);
});

// 3. UI reads status from the app DB — never from the UNS topic.
```

## Still Not A UI

Outbound sync is backend plumbing. Users still see the domain screen (the Orders page); they never see the UNS topic, the sync, or the topic path. The data-source rule in `SKILL.md` applies to **both** directions.
