import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/index.js';

const vectors = JSON.parse(readFileSync(new URL('../../contracts/capability-discovery/vectors.json', import.meta.url), 'utf8')) as {
  name: string; valid: boolean; schemaValid?: boolean; expectedErrorCode?: string; response: unknown; expectedCapabilities?: unknown[];
}[];
const client = () => createClient({ apiHost: 'https://platform.example', apiKey: 'test-fixture' }).capabilities;
afterEach(() => vi.unstubAllGlobals());

const schema = JSON.parse(readFileSync(new URL('../../contracts/capability-discovery/response.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

describe('shared Cloud and Enterprise discovery vectors', () => {
  it.each(vectors)('structural schema: $name', ({ valid, schemaValid, response }) => {
    expect(validateSchema(response), JSON.stringify(validateSchema.errors)).toBe(schemaValid ?? valid);
  });
  it.each(vectors)('$name', async ({ valid, response, expectedCapabilities, expectedErrorCode }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal('fetch', fetch);
    const expected = expectedCapabilities === undefined ? response : {
      ...(response as Record<string, unknown>), capabilities: expectedCapabilities,
    };
    if (valid) expect(await client().discover()).toEqual(expected);
    else await expect(client().discover()).rejects.toMatchObject({ errorCode: expectedErrorCode ?? 'CAPABILITY_PROTOCOL_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://platform.example/openapi/v2/capabilities/discover');
  });

  it('ignores unknown operations and projects safe fields without inventing readiness', async () => {
    const response = structuredClone(vectors.find(v => v.name === 'read-available-while-execution-unavailable')!.response) as {
      capabilities: { operations: Record<string, unknown>[] }[];
    };
    response.capabilities[0].operations.push({ operation: 'future', privateEndpoint: 'redacted-fixture' });
    response.capabilities[0].operations[0].internal = 'not-public';
    expect(validateSchema(response), JSON.stringify(validateSchema.errors)).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
    const actual = await client().discover();
    expect(actual.capabilities[0].enabled).toBe(false);
    expect(actual.capabilities[0].operations).toHaveLength(2);
    expect(actual.capabilities[0].operations?.[0]).not.toHaveProperty('internal');
    expect(actual.capabilities[0].operations?.[0].enabled).toBe(true);
  });
});
