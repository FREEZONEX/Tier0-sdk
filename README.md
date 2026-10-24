# Tier0 SDK

TypeScript/JavaScript clients for Cloud data, files, notifications, MQTT and App/Stream interactions. For an unpublished App/Stream unit, deploy the reviewed commit and SHA-256 pinned artifact/source pack; the package version alone is insufficient.

```js
import { createClient } from '@tier0/sdk/cloud';

const sdk = createClient();
const request = sdk.streams.requests.use({ code: 'orders.approve' });
await request.describe();
await request.invoke({ orderId }, { idempotencyKey: savedIntentId });

const subscription = await sdk.streams.messages.use({ topic: 'orders/accepted' })
  .subscribe(message => updateOrder(message.payload));
// At teardown:
await subscription.dispose();
await sdk.dispose();
```

The trusted SWE App runtime automatically supplies the SDK connection provider before App code runs. Business App code supplies no broker URLs, physical subjects, keys, credentials or identity headers. Node services retain their existing server HTTP/App configuration. Requests preserve caller idempotency and frozen-version receipts with no write retries. Messages have disposable subscriptions, asynchronous error handlers, fresh in-memory keys on renewal, no offline buffering/replay and no receiver acknowledgement guarantee.

See the complete [paired App and Stream v3 example](examples/app-streams/README.md) and [SDK Skills index](skills/tier0-sdk/SKILL.md). Stream scripts declare `sdkVersion: 'tier0-stream/v3'`. Existing Cloud data, file, notification and runtime helpers remain available; this unit does not migrate the separately pinned UNS data baseline.

Validation:

- `npm run typecheck` and `npm test`
- `npm run check:uns-v2-contract` and `npm run check:stream-contract`
- `npm run test:streams:artifact`: production Go issuer + native TLS NATS tests, offline ESM/CJS delivery and browser bundle dependency checks. Requires Go, `nats-server`, Node 22+ and a backend checkout (`TIER0_STREAM_MESSAGES_BACKEND_DIR`). This fixture uses fixed authority and does not exercise SYS Connect RPC, SQL roles/App policy, GW authentication or browser E2E.
- `npm run test:cloud-app`: offline App packaging and retained Cloud behavior using local HTTP fixtures.
