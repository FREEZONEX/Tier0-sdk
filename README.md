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

See the complete [paired App and Stream example](examples/app-streams/README.md) and [SDK Skills index](skills/tier0-sdk/SKILL.md). Current Cloud Source/Stream inputs omit `sdkVersion` and `configVersion` selectors. The Cloud UNS v5 data and single-model contracts remain independently pinned. New request/message APIs require the matching Backend and trusted App runtime integration; their presence in this SDK does not establish deployment readiness.

Validation:

- `npm run typecheck` and `npm test`
- `npm run check:uns-v2-contract`, `npm run check:stream-contract`, `npm run check:platform-contract` and `npm run check:capability-contract`
- `npm run test:streams:artifact`: production Go issuer + native TLS NATS tests, offline ESM/CJS delivery and browser bundle dependency checks. Requires Go, `nats-server`, Node 22+ and a backend checkout (`TIER0_STREAM_MESSAGES_BACKEND_DIR`). This fixture uses fixed authority and does not exercise SYS Connect RPC, SQL roles/App policy, GW authentication or browser E2E.
- `npm run test:cloud-app`: offline App packaging and retained Cloud behavior using local HTTP fixtures.

Sync a reviewed Backend commit with `npm run sync:platform-contract -- <backend-checkout> <commit>` (six platform routes and App-member projection), `npm run sync:stream-contract -- <backend-checkout> <commit>` and `npm run sync:capability-contract -- <backend-checkout> <commit>`. Then regenerate the platform and Stream types and run the checks above. Each sync command accepts `--worktree` instead of a commit for explicit local previews. Package and publish hooks reject preview provenance; re-sync the committed sources before release rather than editing provenance by hand. These platform changes leave the independently pinned UNS model unchanged.
