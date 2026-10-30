# Public OpenAPI v2 clients

Read [configuration](configuration.md) before calls. Cloud endpoints use /openapi/v2 only; missing or denied operations must not trigger a prefix or credential fallback.

The generated platform clients are systemApi, appsApi, platformApi and notificationsApi. Files use @tier0/sdk/files. Data uses unsV2 from @tier0/sdk/cloud. Stream requests and messages use client.streams. There are no exported Flow, legacy Namespace or gateway-reload clients.

```typescript
import { systemApi } from '@tier0/sdk/openapi';
const info = await systemApi.openapiV2Info({});
```

For credential diagnostics read [system info](../tier0-sdk-system/references/info.md) and the whoami reference. App business credentials do not identify a human user.

```typescript
import { unsV2 } from '@tier0/sdk/cloud';
const records = await unsV2.recordFind({ collectionId: verifiedCollectionId, filter: {}, limit: 20 });
```

Keep verified IDs and data access in the service layer; map response records into business objects for UI. Handle actual HTTP/business errors and mutation receipts; an uncertain mutation must be read back before retrying with the same idempotency key.

unsV2.streamRuntimeCapabilitiesGet is retired. Capability discovery uses contract 2.0 state, reasonCode and operations; ready does not authorize an arbitrary resource or prove a run completed, and namespace readiness_unknown / READINESS_NOT_ASSESSED is not a permission denial.
