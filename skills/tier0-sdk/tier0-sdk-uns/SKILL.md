---
name: tier0-sdk-uns
version: 2.0.0
description: "Use the current UNS v2 Collection, Record, Sample, metadata and App data contracts through @tier0/sdk. Read tier0-sdk first."
---

# UNS v2 data

Read [shared configuration](../references/configuration.md), then use unsV2 from @tier0/sdk/cloud or @tier0/sdk. Discover verified Collection and record IDs, inspect schemas, and apply current App or workspace grants. Never translate retired Namespace topic payloads into v2 calls.

Metadata discovery and editing are builder operations. App runtime credentials use dataAppContext and permitted Collection operations; a broad SDK export is not a resource grant. Keep IDs and transport details in the data layer and return business objects to UI.

- [Browse](references/browse.md) and [search](references/search.md) current metadata or permitted data.
- [Create](references/create.md), [update](references/update.md), [delete](references/delete.md) and [restore](references/restore.md) using explicit kind and stable IDs.
- [Read](references/read.md), [write](references/write.md) and [history](references/history.md) distinguish records from samples.
- [Data integration](references/data-integration.md) covers Source enable, Stream deployment and verified Collection writes.

Use exact generated UnsV2Request/UnsV2Response types and the current API docs. Inspect actual mutation outcomes and read back committed records; no catalog status or buffered script result proves persistence.
