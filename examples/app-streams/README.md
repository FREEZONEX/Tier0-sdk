# App / Stream v3 example

Use the reviewed SDK artifact/source pack pinned by commit and SHA-256. The package version alone does not identify this un-published SDK unit. The existing Cloud SDK data, files, notifications and identity helpers remain available; the Stream schema pin is separate from the retained UNS data baseline.

`stream-v3.cjs` is the complete Stream program. Create the current single-model Stream document without a `sdkVersion` or `configVersion` selector; its `script`/`script.code` is the file's text according to the native or Cloud DTO. It registers public request `orders.approve`, consumes logical topic `orders/created`, and publishes `orders/accepted`. It does not perform a device operation or prove receiver processing.

`client.mjs` is shared App caller code for browser bundles and Node. In a browser App, the trusted SWE host injects `Symbol.for('tier0.sdk.app-runtime.v1')` before App execution; the SDK detects it without manual installation. A standalone Node deployment supplies the existing SDK HTTP/App runtime context on the server. Browser App configuration contains no broker URL, raw subject, JWT, nkey seed or API key. Server HTTP credentials remain confined to the Node deployment.

```js
import { openOrderInteractions } from './client.mjs';

const interactions = await openOrderInteractions(
  message => updateOrder(message.payload),
  error => reportError(error),
);
await interactions.describe();
await interactions.approve(orderId, savedIntentId);

// On component/service teardown:
await interactions.dispose();
```

Save one `savedIntentId` for each approved business intent. Do not automatically invoke again after an unknown execution result; reconcile the server's run information. Replaying the same intent deliberately uses the same key and frozen version semantics.

Live messages use Core NATS WSS and have no offline buffer, retention or replay. Each renewal/reconnect closes the old socket, wipes its key and generates a new key/JWT. Only subscriptions are restored. Publishing while disconnected fails immediately; flush is not receiver acknowledgement. Payload identity fields are business data, not authenticated publisher identity. Always dispose the subscription and its owned client.

The source-pack helper vendors the exact locked NATS dependency closure and integrity metadata for offline App builds. `npm run test:streams:nats` exercises production Go issuer + native TLS NATS with fixed fixture authority; it does not test SYS Connect RPC, SQL roles/App policy, Gateway authentication or browser end-to-end authorization.

Run `npm run test:streams:artifact` to verify packaged ESM/CJS delivery against the native fixture and the offline browser dependency build. Browser execution and actual SYS/GW policy acceptance remain separate E2E work.

These request/message APIs require the coordinated Backend and trusted App runtime integration. The historical example filename is not a runtime version selector; existing Cloud deployments must not be inferred to support these APIs.
