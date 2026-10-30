# Update metadata and schema

Use unsV2.metadataUpdateOne or metadataReplaceOne with the required kind, filter and expectedRevision. Data updates use recordUpdateOne. Read current schema and references before changing it; do not copy legacy topic update payloads.

Read the generated UnsV2Request type and the current operation contract before supplying payloads. Authentication, current scope and resource checks remain authoritative.
