---
name: tier0-sdk-monoapptemplate
version: 0.2.0
description: "Using @tier0/sdk safely inside the MonoApp TanStack Start scaffold: lazy loaders, service-layer patterns, long-lived MQTT subscriber lifecycle, delivering realtime data to the UI."
---

# MonoApp Template Integration

Use this reference when the app is based on `monoapptemplate`, TanStack Start, or a scaffold that provides `src/lib/tier0.ts`.

The template already includes `@tier0/sdk` and server-side lazy loaders. Prefer those helpers over direct SDK imports in app code.

## Required Pattern

Import lazy helper functions from `@/lib/tier0`, then call them inside the concrete server-side action/service that needs Tier0 I/O.

```typescript
import { getTier0UnsApi } from '@/lib/tier0';

export async function readMachineStatus(topic: string) {
  const unsApi = await getTier0UnsApi();
  const result = await unsApi.openapiv1unsread({ topics: [topic] });
  const item = result.data.results?.[0];

  if (!item?.success) {
    throw new Error(item?.error?.message ?? `Failed to read ${topic}`);
  }
  return item.result;
}
```

It is safe to top-level import these helper functions. Do not invoke them at module top level.

## Do Not Do This

Do not top-level import SDK submodules from pages, route loaders, services, or other modules loaded during SSR startup:

```typescript
// Avoid in monoapptemplate app code.
import { unsApi } from '@tier0/sdk/openapi';
import { Tier0MQClient } from '@tier0/sdk/mq';
```

Do not hand-write replacement REST/MQ clients or fallback fetch wrappers. If SSR fails with a package format error, move SDK access behind `@/lib/tier0` helpers and keep the scaffold Vite SSR policy:

```typescript
ssr: {
  external: ['pg', '@tier0/sdk', 'mqtt'],
}
```

## Configuration

The platform injects Tier0 SDK runtime values:

- `TIER0_API_HOST`
- `TIER0_API_KEY`
- `TIER0_MQTT_HOST`
- `TIER0_MQTT_PORT`

Generated MonoApp applications must not:

- add `TIER0_*` values to `.env.example`
- create user-facing API key, token, OpenAPI host, MQTT host, or workspace binding settings pages
- store Tier0 SDK credentials in app database tables

If browser-side `VITE_TIER0_*` values are needed, the platform/runtime must inject them and the app should pass them explicitly. Do not assume the SDK automatically reads `VITE_*`.

## App UX Model

For generated applications, treat UNS as the backend data center, not as the visible information architecture.

Default UI behavior:

- Build screens around the user's business workflow, such as equipment status, production orders, alarms, KPIs, commands, or history.
- Use known UNS topic paths inside service-layer code to read/write the data each feature needs.
- Do not render a UNS tree, path explorer, or namespace breadcrumb as the primary UI unless the user explicitly asks for browsing or managing the UNS hierarchy.
- Avoid making users choose from raw `Metric` / `State` / `Action` folders unless the app is specifically an admin, diagnostics, or data-modeling tool.

The app DB is the system of record for app-owned entities; UNS is the platform integration bus. Before wiring UNS I/O, decide the direction per data element (read external data inbound vs sync app-owned data outbound) using `references/core/data-integration.md`.

## Recommended Service-Layer Examples

### UNS Write From a Service

Put Tier0 platform side effects in `src/services/**`, not directly in React components.

```typescript
// src/services/equipment-telemetry.ts
import { getTier0UnsApi } from '@/lib/tier0';

export async function publishEquipmentCommand(input: {
  topic: string;
  command: string;
  operatorId: string;
}) {
  const unsApi = await getTier0UnsApi();
  const result = await unsApi.openapiv1unswrite({
    writes: [
      {
        topic: input.topic,
        value: {
          command: input.command,
          operatorId: input.operatorId,
        },
        timeStamp: Date.now(),
      },
    ],
  });

  const item = result.data.results?.[0];
  if (!result.data.success || !item?.success) {
    throw new Error(item?.error?.message ?? 'UNS write failed');
  }
}
```

### API Route Delegates to Service

Keep `src/routes/api/**` thin.

```typescript
// src/routes/api/equipment/command.ts
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { withErrors } from '@/lib/route-handlers';
import { publishEquipmentCommand } from '@/services/equipment-telemetry';

const schema = z.object({
  topic: z.string().min(1),
  command: z.string().min(1),
});

export const Route = createFileRoute('/api/equipment/command')({
  server: {
    handlers: {
      POST: withErrors(async ({ request }) => {
        const user = await requireAuth();
        const body = schema.parse(await request.json());
        await publishEquipmentCommand({ ...body, operatorId: user.id });
        return Response.json({ ok: true });
      }),
    },
  },
});
```

### UI Calls Local API, Not Tier0 Directly

Client pages should call app API routes with `apiUrl()`.

```typescript
import { apiUrl } from '@/lib/utils';

await fetch(apiUrl('/api/equipment/command'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic: 'Plant/Line1/Action/Start',
    command: 'START',
  }),
});
```

## Flow Deploy Safely

Before deploying, get a backup and preserve existing config nodes.

```typescript
import { getTier0FlowApi } from '@/lib/tier0';

export async function deployFlowPatch(flowId: number, buildNodes: (current: any[]) => any[]) {
  const flowApi = await getTier0FlowApi();

  const current = await flowApi.openapiv1flowflowdata({ id: flowId });
  const currentNodes = current.data.flows ?? [];
  const mqttBroker = currentNodes.find((node: any) => node.type === 'mqtt-broker');

  if (!mqttBroker) {
    throw new Error('Flow is missing the system MQTT broker config node');
  }

  const nextNodes = buildNodes(currentNodes);
  if (!nextNodes.some((node: any) => node.id === mqttBroker.id)) {
    throw new Error('Refusing to deploy: MQTT broker config node was not preserved');
  }

  return flowApi.openapiv1flowdeploy({
    id: flowId,
    flowsJson: JSON.stringify(nextNodes),
  });
}
```

Flow deploy/delete are high-risk operations. Require explicit user confirmation before calling the service.

## MQ Usage

Use MQ from a server-side action or service when publishing device commands or subscribing to backend-side events.

```typescript
import { loadTier0Mq } from '@/lib/tier0';

export async function publishDeviceMessage(topic: string, payload: unknown) {
  const { Tier0MQClient } = await loadTier0Mq();
  const client = new Tier0MQClient();
  await client.publish(topic, payload);
  client.disconnect();
}
```

### Long-Lived Subscriber Pattern

Durable subscriptions (event ingestion, Action→State result tracking) must be owned by the server process — never started from React render paths, route loaders, or client code. In this scaffold, use a `globalThis`-guarded singleton started lazily from the service layer (the same idiom as `bootstrapModule` in `src/services/bootstrap.ts`):

```typescript
// src/services/transfer-events-subscriber.ts
import { loadTier0Mq } from '@/lib/tier0';
import { updateTransferStatusIfNewer } from '@/services/transfers';

// Module state is re-created when the dev server re-evaluates modules;
// globalThis survives, preventing duplicate subscribers on hot reload/SSR.
const GLOBAL_KEY = Symbol.for('app.transferEventsSubscriber');

export function ensureTransferEventsSubscriber(): Promise<void> {
  const g = globalThis as Record<symbol, Promise<void> | undefined>;
  return (g[GLOBAL_KEY] ??= start());
}

async function start(): Promise<void> {
  const { Tier0MQClient } = await loadTier0Mq();
  const client = new Tier0MQClient();

  client.subscribe('WMS/Inventory/State/TransferOrder', async (_topic, payload) => {
    try {
      const evt = JSON.parse(payload);
      // Idempotent, ordering-safe update keyed by the business key.
      await updateTransferStatusIfNewer(evt.requestId, evt.status, evt.updatedAt);
    } catch (err) {
      console.error('transfer event ingest failed', err);
    }
  });

  client.on('error', (err) => console.error('MQ error', err));

  // Graceful shutdown: stop the MQTT connection when the server exits.
  const shutdown = () => client.disconnect();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
```

Rules:

- Call `ensureTransferEventsSubscriber()` at the start of the service entrypoints that depend on ingested events (mirroring the `bootstrapModule` call convention). It is safe to call repeatedly — the promise memo runs `start()` once per process.
- The handler persists into the app DB (dedupe/ordering by business key) — see the ingest rules in `references/core/data-integration.md`. The subscriber is transport; the DB is what the UI reads.
- The client auto-reconnects and re-subscribes on its own (see `references/mq/quickstart.md` → "Reliability and Reconnect Semantics"); pair the `connect` event with a `history` backfill if missed events matter.

### Delivering Realtime Data to the UI

The browser never opens an MQTT connection (that would expose the API key). Realtime flows through the server:

1. **Server-side subscriber → app DB** (pattern above) for event streams and command results.
2. **UI polls the app's own API route** with TanStack Query `refetchInterval` (2–10 s for live telemetry, 30 s+ for KPIs). The route reads from the app DB, or performs an on-demand UNS `read` for current-value snapshots.
3. Reserve SSE/WebSocket push from an app API route for cases where sub-second latency is a stated requirement; polling is the default because it needs no extra connection lifecycle handling.

Never render raw topic paths or VQT in components regardless of transport — map to domain objects in the service/route layer.

## Naming Platform Resources

Do not derive UNS or Flow namespaces from `package.json` `name`; the scaffold default is usually `scaffold`. Resolve the human app name from the user request, app branding, or `/api/manifest` `appId` when a machine identifier is needed.
