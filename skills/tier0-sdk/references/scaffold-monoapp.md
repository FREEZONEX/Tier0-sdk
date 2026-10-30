# MonoApp integration

Use the official @tier0/sdk entry points inside server actions or services. If a scaffold helper still returns a retired Namespace or Flow client, update that helper to expose the current unsV2 client; do not keep an HTTP fallback. Resolve trusted runtime identity and resource IDs before use.

```typescript
export async function readInventory(collectionId: string) {
  const { unsV2 } = await import('@tier0/sdk/cloud');
  return unsV2.recordFind({ collectionId, filter: {}, limit: 20 });
}
```

Validate collectionId against the authenticated user's business scope before calling this service. Return business DTOs to the UI. For charts read [sample history](../tier0-sdk-uns/references/history.md): sampleFind is for bounded time-range queries and sampleAggregate for aggregation; live subscriptions use the actual declared data/message contract.

Business files use @tier0/sdk/files. Persist stable filePath values, resolve authorization server-side, stream downloadFile().response.body through a same-origin route and save the browser Blob with an anchor download action. Do not persist expiring URLs or expose service keys in browser bundles.

For collection pipelines use Source/Stream: enable the Source, declare a target Collection write, deploy, verify a real run and read back records. A successful HTTP fetch is not completed ingestion.
