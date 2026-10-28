import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/index.js';

const vectors = JSON.parse(readFileSync(new URL('../../contracts/capability-discovery/vectors.json', import.meta.url), 'utf8')) as {
  name: string; valid: boolean; response: unknown;
}[];
const client = () => createClient({ apiHost: 'https://platform.example', apiKey: 'test-fixture' }).capabilities;
afterEach(() => vi.unstubAllGlobals());

describe('shared Cloud and Enterprise discovery vectors', () => {
  it.each(vectors)('$name', async ({ valid, response }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal('fetch', fetch);
    if (valid) expect(await client().discover()).toEqual(response);
    else await expect(client().discover()).rejects.toMatchObject({ errorCode: 'CAPABILITY_PROTOCOL_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://platform.example/openapi/v2/capabilities/discover');
  });

  it('ignores unknown operations and projects safe fields without inventing readiness', async () => {
    const response = structuredClone(vectors.find(v => v.name === 'read-available-while-execution-unavailable')!.response) as {
      capabilities: { operations: Record<string, unknown>[] }[];
    };
    response.capabilities[0].operations.push({ operation: 'future', privateEndpoint: 'redacted-fixture' });
    response.capabilities[0].operations[0].internal = 'not-public';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
    const actual = await client().discover();
    expect(actual.capabilities[0].enabled).toBe(false);
    expect(actual.capabilities[0].operations).toHaveLength(2);
    expect(actual.capabilities[0].operations?.[0]).not.toHaveProperty('internal');
    expect(actual.capabilities[0].operations?.[0].enabled).toBe(true);
  });
});
