/** Native v5 data consumer. Pass client.unsV2 from @tier0/sdk/cloud. */
export async function readTelemetry(uns, { collectionId, recordIds, from, to, cursor }) {
  const records = await uns.recordGet({ collectionId, ids: recordIds });
  const history = await uns.sampleFind({ collectionId, recordIds, from, to, limit: 20,
    ...(cursor ? { cursor } : {}) });
  const latest = await uns.sampleLatestValues({ collectionId, recordIds });
  return { records: records.data, history: history.data, latest: latest.data.series };
}

/** Caller owns the stable intent key; the returned outcome describes storage, not device ACK. */
export function appendTelemetry(uns, { collectionId, recordId, time, data, idempotencyKey }) {
  return uns.sampleAppend({ collectionId, recordId, dryRun: false, idempotencyKey,
    items: [{ time, data }] });
}

/** Read the post-write document in the same server transaction, with current read authority. */
export function updateRecord(uns, { collectionId, id, expectedRevision, changes, idempotencyKey }) {
  return uns.recordUpdateOne({ collectionId, filter: { _id: id }, expectedRevision,
    update: { $set: changes }, upsert: false, returnDocument: 'after', idempotencyKey });
}
