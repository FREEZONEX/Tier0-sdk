import { describe, it, expect, beforeAll } from 'vitest';
import { configureClient } from '../../src/openapi/client.js';
import { systemApi, flowApi, unsApi } from '../../src/openapi/api.js';

const apiHost = process.env.TIER0_API_HOST;
const apiKey = process.env.TIER0_API_KEY;

const shouldRun = apiHost && apiKey;

const run = shouldRun ? describe : describe.skip;

run('OpenAPI Integration Tests', () => {
  beforeAll(() => {
    configureClient({ apiHost, apiKey });
  });

  it('should call info and return service info', async () => {
    const result = await systemApi.openapiv1info({});
    expect(result).toBeDefined();
    expect(result.code).toBe(200);
  });

  it('should call whoami and return user info', async () => {
    const result = await systemApi.openapiv1authwhoami();
    expect(result).toBeDefined();
    expect(result.code).toBe(200);
    expect(result.data).toBeDefined();
    expect(result.data.userID).toBeGreaterThan(0);
  });

  it('should browse root namespace', async () => {
    const result = await unsApi.openapiv1unsbrowse({});
    expect(result).toBeDefined();
    expect(result.code).toBe(200);
    expect(Array.isArray(result.data?.tree)).toBe(true);
  });

  it('should list flows', async () => {
    const result = await flowApi.openapiv1flowlist({});
    expect(result).toBeDefined();
    expect(result.code).toBe(200);
    expect(Array.isArray(result.data?.list || result.data)).toBe(true);
  });

  it('should get flow nodes', async () => {
    const result = await flowApi.openapiv1flownodes({ flowType: 'SourceFlow' });
    expect(result).toBeDefined();
    expect(result.code).toBe(200);
    expect(Array.isArray(result.data?.nodes || result.data)).toBe(true);
  });
});
