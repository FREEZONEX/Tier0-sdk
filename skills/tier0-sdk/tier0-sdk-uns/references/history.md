# Bounded sample history and trends

Use unsV2.sampleFind for sample rows and unsV2.sampleAggregate for server-side aggregation. Supply verified Collection and record IDs, explicit from/to timestamps, and a bounded limit; follow the returned pageInfo/cursor instead of treating a partial page as complete. Never reuse old topic-history payloads or countMode.

```typescript
import { unsV2 } from '@tier0/sdk/cloud';
const response = await unsV2.sampleFind({
  collectionId: verifiedCollectionId,
  recordIds: [verifiedRecordId],
  from: rangeStartMs,
  to: rangeEndMs,
  limit: 200,
});
```

Keep authorization and resource selection in the service layer and map samples into chart data with explicit units, quality and timestamps. Live updates use the declared subscription contract; history is a bounded query, not a connectivity or Source-health check.
