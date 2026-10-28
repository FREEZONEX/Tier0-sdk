import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`../../contracts/openapi/${name}`, import.meta.url), 'utf8');
const raw = read('streams.swagger.json');
const source = JSON.parse(raw);
const provenance = JSON.parse(read('streams-provenance.json'));

describe('committed public Stream contract projection', () => {
  it('pins the public contract and independently reviewed trust commit', () => {
    expect(provenance.revision).toBe('310bd513fd91efee78a1bf38fcce0b4128e70996');
    expect(provenance.trustRevision).toMatch(/^5eecd2188[0-9a-f]+$/);
    expect(provenance.snapshotSHA256).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(provenance.sourceSHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('projects only neutral direct request, connection and capability POST routes', () => {
    expect(Object.keys(source.paths)).toEqual([
      '/openapi/v1/stream-requests/discover',
      '/openapi/v1/stream-requests/{requestCode}/describe',
      '/openapi/v1/stream-requests/{requestCode}/invoke',
      '/openapi/v1/stream-messages/connect',
      '/openapi/v2/capabilities/discover',
    ]);
    for (const route of Object.values(source.paths) as { post?: unknown }[]) expect(route.post).toBeDefined();
  });
  it('matches the direct invocation and credential response fields without UNS v2 wrappers', () => {
    const schemas = source.components.schemas;
    expect(Object.keys(schemas.StreamRequestInvokeReq.properties).sort()).toEqual(['idempotencyKey', 'input']);
    expect(Object.keys(schemas.StreamRequestInvokeResp.properties).sort()).toEqual([
      'code', 'contractVersion', 'replayed', 'result', 'runID', 'status',
    ]);
    expect(Object.keys(schemas.StreamMessagesConnectReq.properties).sort()).toEqual(['appId', 'clientPublicKey', 'topics']);
    expect(Object.keys(schemas.StreamMessagesConnectResp.properties).sort()).toEqual([
      'contractVersion', 'expiresAt', 'maxPayloadBytes', 'permissions', 'url', 'userJwt',
    ]);
  });
  it('keeps current Cloud UNS v5 data and single-model provenance separate from request/message routes', () => {
    const data = JSON.parse(readFileSync(new URL('../../contracts/uns-v2/provenance.json', import.meta.url), 'utf8'));
    expect(data.revision).toBe('310bd513fd91efee78a1bf38fcce0b4128e70996');
    expect(data.version).toBe('5.0.0');
    expect(data.cloudContractRevision).toContain('source-stream-single-model');
    expect(provenance.scope).toContain('UNS v5 data and single-model inputs are pinned separately');
  });
});
