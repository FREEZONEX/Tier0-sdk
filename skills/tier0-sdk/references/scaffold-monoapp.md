---
name: tier0-sdk-monoapptemplate
version: 0.1.0
description: "Using @tier0/sdk safely inside the MonoApp TanStack Start scaffold, including mandatory MQTT subscriptions for continuously changing or realtime data."
---

# MonoApp Template Integration

Use this reference when the app is based on `monoapptemplate`, TanStack Start, or a scaffold that provides `src/lib/tier0.ts`.

The template already includes `@tier0/sdk` and server-side lazy loaders. Prefer those helpers over direct SDK imports in app code.

## Contents

- Required integration pattern and prohibited replacements
- Runtime configuration and application UX boundaries
- Service-layer examples
- SDK-managed file upload and persistence
- Safe Flow deployment and realtime/MQ transport selection
- Platform resource naming

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
- `TIER0_PROJECT_ID`
- `TIER0_MQTT_HOST`
- `TIER0_MQTT_PORT`

Generated MonoApp applications must not:

- add `TIER0_*` values to `.env.example`
- create user-facing API key, token, OpenAPI host, MQTT host, or workspace binding settings pages
- store Tier0 SDK credentials in app database tables
- hard-code a project name or ID; use `getCurrentProjectId()` in server/runtime code

If browser-side `VITE_TIER0_*` values are needed, the platform/runtime must inject them and the app should pass them explicitly. Do not assume the SDK automatically reads `VITE_*`.

## App UX Model

For generated applications, treat UNS as the backend data center, not as the visible information architecture.

Default UI behavior:

- Build screens around the user's business workflow, such as equipment status, production orders, alarms, KPIs, commands, or history.
- Use known UNS topic paths inside service-layer code to read/write the data each feature needs.
- Do not render a UNS tree, path explorer, or namespace breadcrumb as the primary UI unless the user explicitly asks for browsing or managing the UNS hierarchy.
- Avoid making users choose from raw `Metric` / `State` / `Action` folders unless the app is specifically an admin, diagnostics, or data-modeling tool.

The app DB is the system of record for app-owned entities; UNS is the platform integration bus. Before wiring UNS I/O, decide the direction per data element (read external data inbound vs sync app-owned data outbound) using [`../tier0-sdk-uns/references/data-integration.md`](../tier0-sdk-uns/references/data-integration.md).

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

## File Upload and Persistence (Required)

When a user asks for an upload, attachment, avatar, image, import, or other upload-and-save feature, default to `@tier0/sdk/files`. It stores content in platform-managed object storage (Cloud AWS S3 or enterprise RustFS). Do not persist uploads on the scaffold server's local filesystem, in the repository or `public/uploads`, or as database blobs.

Receive the browser `File` through a server action or API route, call `uploadFile` in a service, and save only the returned `filePath` in the business record. Resolve access with `getFileUrl`, download with `downloadFile`, and remove with `deleteFile`. Never persist an expiring presigned URL. Local temporary files are allowed only for short-lived processing before the SDK upload.

If `src/lib/tier0.ts` does not yet expose a files loader, extend it with the same server-only lazy-load pattern used by `loadTier0OpenApi()` and `loadTier0Mq()`. Do not use the missing helper as a reason to fall back to local storage or a handwritten S3 client. Read [`../tier0-sdk-files/SKILL.md`](../tier0-sdk-files/SKILL.md) and [`../tier0-sdk-files/references/upload.md`](../tier0-sdk-files/references/upload.md) before implementing the feature.

## Browser Attachment Downloads

Treat attachment download as an authenticated app feature, not as navigation to
object storage. The safe MonoApp flow is:

```text
business record ID
  -> authenticated same-origin app route
  -> server resolves the stored filePath
  -> Tier0 downloadFile
  -> streamed Response body
  -> browser Blob
  -> <a download="original-name">
```

Do not implement attachment download with `getFileUrl()` followed by
`window.open()`, `location.href`, or an `<a target="_blank">`. Private presigned
URLs may open an inline PDF viewer, be blocked by browser policy/extensions, and
expose a temporary storage URL to browser history. `responseContentDisposition`
is not a substitute for the browser-side `download` attribute.

Keep `@tier0/sdk` server-only. If the scaffold does not already expose the files
loader, add the complete loader below to `src/lib/tier0.ts`. Derive the module
type from the SDK export instead of hand-writing individual function signatures,
so upload/download/URL/delete types stay synchronized with SDK releases:

```typescript
export type Tier0FilesModule = typeof import('@tier0/sdk/files');

export async function loadTier0Files(): Promise<Tier0FilesModule> {
  assertServerOnly('Tier0 Files SDK');
  return require('@tier0/sdk/files') as Tier0FilesModule;
}
```

Call the SDK from a service:

```typescript
// src/services/attachment-files.ts
import { loadTier0Files } from '@/lib/tier0';

export async function downloadAttachment(filePath: string) {
  const { downloadFile } = await loadTier0Files();
  return downloadFile({ filePath });
}
```

The app route must accept a business record ID, load the record after
authentication, and use the server-owned `filePath`. Never accept an arbitrary
`filePath` from a query string or request body:

```typescript
GET: withErrors(async ({ params }) => {
  await requireAuth();
  const attachment = await getAttachmentById(params.id);
  const result = await downloadAttachment(attachment.filePath);

  return new Response(result.response.body, {
    status: 200,
    headers: {
      'Content-Type': result.contentType || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
    },
  });
});
```

Pass `response.body` through directly. Do not call `blob()` or `arrayBuffer()`
on the server first, because that buffers the whole file in application memory.

The browser calls only the same-origin app route and chooses the saved filename:

```typescript
const response = await fetch(apiUrl(`/api/attachments/${attachment.id}/download`));
if (!response.ok) {
  throw new Error((await response.text().catch(() => '')) || 'Download failed');
}

const blob = await response.blob();
const objectUrl = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = objectUrl;
link.download = attachment.fileName || 'download';
document.body.appendChild(link);
link.click();
link.remove();
window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
```

This pattern keeps the Tier0 API key and storage URL on the server, preserves
business authorization, works for PDFs and other binary files, and lets the UI
control the filename consistently.

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

## Realtime Data Transport (Required)

Choose the receive transport before implementing a MonoApp feature:

| Data need | Required SDK path |
|---|---|
| Read the current value once, including an initial page snapshot | Use `getTier0UnsApi()` and OpenAPI `read` |
| Receive continuously changing, realtime, monitoring, watch, or always-listening data | Use `loadTier0Mq()` and MQTT `subscribe` |
| Fill a gap after MQTT reconnect | Use OpenAPI `history` only when the Topic has `enableHistory` enabled, then resume the MQTT subscription |

MQTT `subscribe` is the default and required receive path for realtime scaffold features. Never add `setInterval`, `refetchInterval`, a polling loop, or repeated OpenAPI `read`/`history` calls to simulate realtime. OpenAPI `history` is reconnect backfill, not a live transport.

An initial OpenAPI `read` may seed the screen, but all subsequent updates must come from the MQTT subscription. Own long-lived subscriptions in a server runtime or worker that can manage reconnect, unsubscribe, and shutdown; do not start them from React render paths or route loaders. Push normalized business-domain updates to the UI through the app's own realtime channel instead of exposing raw MQTT topics.

Read [`../tier0-sdk-mq/SKILL.md`](../tier0-sdk-mq/SKILL.md) and [`../tier0-sdk-mq/references/quickstart.md`](../tier0-sdk-mq/references/quickstart.md) before implementing the subscription. For reconnect backfill, also read [`../tier0-sdk-uns/references/history.md`](../tier0-sdk-uns/references/history.md).

## MQ Publish and Lifecycle

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

Disconnect short-lived publisher clients after use. Keep durable subscriber lifecycle in the server runtime or worker described above.

## Naming Platform Resources

Do not derive UNS or Flow namespaces from `package.json` `name`; the scaffold default is usually `scaffold`. Resolve the human app name from the user request, app branding, or `/api/manifest` `appId` when a machine identifier is needed.
