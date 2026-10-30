# Read business records and samples

Use unsV2.recordGet for exact record IDs or recordFind for bounded filters. Use sampleLatestValues for current sample values. A missing sample is not replaced with record data; use the schema and quality/time evidence actually returned.

Read the generated UnsV2Request type and the current operation contract before supplying payloads. Authentication, current scope and resource checks remain authoritative.
