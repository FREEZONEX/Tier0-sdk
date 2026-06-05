import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, configureClient, getClient } from '../../src/openapi/client.js';

describe('HttpClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureClient({});
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should throw error when apiHost is not provided', async () => {
    const client = new HttpClient();
    await expect(client.get('/test')).rejects.toThrow('Tier0 SDK: apiHost is required');
  });

  it('should use apiHost from config', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'ok' }),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/test',
      expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should not duplicate protocol when apiHost includes http scheme', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'ok' }),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'https://api.example.com/' });
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('should inject Authorization header with apiKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({
      apiHost: 'api.example.com',
      apiKey: 'test-api-key',
    });
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
      })
    );
  });

  it('should use getApiKey function', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({
      apiHost: 'api.example.com',
      getApiKey: () => 'dynamic-key',
    });
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer dynamic-key',
        }),
      })
    );
  });

  it('should prioritize apiKey over getApiKey', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({
      apiHost: 'api.example.com',
      apiKey: 'direct-key',
      getApiKey: () => 'dynamic-key',
    });
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer direct-key',
        }),
      })
    );
  });

  it('should send POST request with body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1 }),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    const body = { name: 'test' };
    await client.post('/items', body);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  });

  it('should send PUT request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    await client.put('/items/1', { name: 'updated' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/items/1',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('should send PATCH request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    await client.patch('/items/1', { name: 'patched' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/items/1',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('should send DELETE request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    await client.delete('/items/1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/items/1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('should throw error on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    await expect(client.get('/missing')).rejects.toThrow('HTTP 404: Not Found');
  });

  it('should handle 204 No Content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    const result = await client.delete('/items/1');
    expect(result).toBeUndefined();
  });

  it('should return parsed JSON on success', async () => {
    const mockData = { id: 1, name: 'test' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    const result = await client.get('/items/1');
    expect(result).toEqual(mockData);
  });

  it('should use environment variable for apiHost', async () => {
    const originalEnv = process.env.TIER0_API_HOST;
    process.env.TIER0_API_HOST = 'env.example.com';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient();
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://env.example.com/test',
      expect.any(Object)
    );

    process.env.TIER0_API_HOST = originalEnv;
  });

  it('should use environment variable for apiKey', async () => {
    const originalEnv = process.env.TIER0_API_KEY;
    process.env.TIER0_API_KEY = 'env-api-key';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    const client = new HttpClient({ apiHost: 'api.example.com' });
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer env-api-key',
        }),
      })
    );

    process.env.TIER0_API_KEY = originalEnv;
  });
});

describe('configureClient / getClient', () => {
  it('should configure and return default client', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);
    globalThis.fetch = mockFetch;

    configureClient({ apiHost: 'configured.example.com' });
    const client = getClient();
    await client.get('/test');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://configured.example.com/test',
      expect.any(Object)
    );
  });
});
