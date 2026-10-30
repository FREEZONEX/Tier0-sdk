# Create a target Collection or record

Builder metadata uses unsV2.metadataInsertOne with kind:"collection", data containing name and recordSchema, and a stable idempotencyKey. App-owned schema provisioning uses the declared App collection operations. Reuse a matching target when possible, then write records with recordInsertOne.

Read the generated UnsV2Request type and the current operation contract before supplying payloads. Authentication, current scope and resource checks remain authoritative.
