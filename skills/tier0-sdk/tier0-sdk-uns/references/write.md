# Persist records

Use unsV2.recordInsertOne, recordUpdateOne or recordReplaceOne for business records and sampleAppend for samples. Supply verified Collection IDs, valid fields and required revision/idempotency/lock values. Check the committed outcome and read back records; do not use raw MQTT publish as evidence of persistence.

Read the generated UnsV2Request type and the current operation contract before supplying payloads. Authentication, current scope and resource checks remain authoritative.
