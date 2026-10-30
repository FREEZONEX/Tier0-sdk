# Delete selected data

Use metadataDeleteOne for an explicitly selected metadata object, recordDeleteOne for a record, or sampleDeleteRange for a bounded sample interval. Verify scope and references and obey current revision requirements. Deletion of one resource does not authorize a broad filter.

Read the generated UnsV2Request type and the current operation contract before supplying payloads. Authentication, current scope and resource checks remain authoritative.
