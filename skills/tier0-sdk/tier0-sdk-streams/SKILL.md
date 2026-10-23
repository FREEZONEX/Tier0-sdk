---
name: tier0-sdk-streams
description: "Tier0 App/Stream requests and live business messages: client.streams.requests describe/invoke/discover, client.streams.messages publish/subscribe, trusted App runtime bootstrap and disposable subscriptions. Use for Stream v3 interactions; UNS history, device MQTT and persisted notifications have their own Skills."
---

# App / Stream Interactions

Read the root Skill's configuration reference first. These APIs require the reviewed SDK artifact/source pack: pin its commit and SHA-256, rather than replacing it with an older npm release having the same package version.

## Select the interaction

- A public request code with an input/output contract: `client.streams.requests.use({ code })`. Use `describe()` to inspect it; use `client.streams.requests.discover()` to find visible contracts.
- A live logical business topic: `client.streams.messages.use({ topic })`. Use `publish(payload)` or `subscribe(handler)` and dispose the returned subscription.
- Persisted business data belongs to UNS, device-topic MQTT belongs to the MQ Skill, and user-facing notification records belong to the Notifications Skill. Live Stream messages have no retention or replay.

Import `client` or `createClient` from `@tier0/sdk/cloud` (without MQTT) or `@tier0/sdk`. The Cloud factory retains `unsV2` and `capabilities`; file and notification entry points remain available separately.

## Trusted App bootstrap

The SWE host installs `globalThis[Symbol.for('tier0.sdk.app-runtime.v1')]` before the App script. The SDK detects it automatically; App business code must not install a replacement provider or resolve credentials itself. The host's provider returns a `Response` for its authenticated request bridge.

Browser App code knows only public request codes, logical topics and business payloads. Do not add broker URLs, physical subjects, API keys, JWTs, nkey seeds, workspace/principal headers or message identity claims to App configuration. `@tier0/sdk/runtime` is a trusted host integration entry point, not App setup.

For a standalone Node service, the deployment supplies its existing HTTP credential and real App context. Call `createClient()` without literals; never put these server credentials in a browser bundle.

## Public caller

```js
import { createClient } from '@tier0/sdk/cloud';

const sdk = createClient(); // automatically uses the trusted App runtime
const removeErrorHandler = sdk.streams.messages.onError(reportError);
const subscription = await sdk.streams.messages.use({ topic: 'orders/accepted' })
  .subscribe(message => renderOrderUpdate(message.payload));

const request = sdk.streams.requests.use({ code: 'orders.approve' });
await request.describe();
await request.invoke({ orderId }, { idempotencyKey: savedIntentId });

// On view/service teardown:
await subscription.dispose();
removeErrorHandler();
await sdk.dispose();
```

Persist one caller-owned idempotency key per business intent. A deliberate reconciliation/replay reuses that key. The SDK never generates a request idempotency key, selects deployment versions or retries a write. An unknown result means execution may have happened; reconcile the returned run metadata before any further business action.

## Live message lifecycle

Messages use a versioned `{ version, messageId, correlationId?, payload }` envelope. Caller-supplied identity in a payload is business data, not authenticated publisher metadata; authorized broker subjects establish identity internally.

The SDK uses native Core NATS over WSS. Each initial connection, reconnect and renewal gets a new in-memory user key and a public-key-bound JWT. The old socket closes and its private key is wiped before replacement. No private key leaves the SDK. A successful publish means broker flush, not receiver acknowledgement.

Register `messages.onError` (or subscription `onError`) to handle asynchronous broker, decoding and handler failures. After an established session disconnects, publish fails immediately: no offline buffering, write retry or message replay. Credential refresh and reconnection restore subscriptions only. Dispose subscriptions and the owned client when the view/service stops.

## Stream-side code

Current Stream documents declare `sdkVersion: 'tier0-stream/v3'`. Request registration uses `api.stream.onRequest({ id, request }, handler)`; message consumers use `api.stream.messages.subscribe({ id, topic, inputSchema }, handler)`. Declare each outgoing logical topic with `api.stream.messages.use({ topic, access: 'publish' })` before calling `api.stream.messages.publish({ topic, payload })`.

The shipped `examples/app-streams/stream-v3.cjs`, `client.mjs` and README contain the complete paired example. Historical v2 documents may be displayed as immutable history; do not submit them as current write/validation fixtures.
