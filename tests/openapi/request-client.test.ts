import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTier0Client, configureClient, systemApi, uploadFile } from '../../src/index.js';

describe('request-scoped client', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); configureClient({}); });

  it('keeps interleaved API and all file operations bound to each workspace', async () => {
    const calls: { url: string; key: string | null; authorization: string | null }[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let initStarted!: () => void;
    const started = new Promise<void>((resolve) => { initStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, key: headers.get('X-API-Key'), authorization: headers.get('Authorization') });
      const key = headers.get('X-API-Key');
      if (url.includes('/multipart/init')) {
        initStarted();
        await gate;
        return Response.json({ fileKey: 'file-a', filePath: 'ws-a/file', uploadId: 'up-a' });
      }
      if (url.includes('/multipart/part-urls')) return Response.json({ partUrls: [{ partNumber: 1, url: 'https://storage.test/part' }] });
      if (url.includes('/multipart/complete')) return Response.json({ filePath: 'ws-a/file' });
      if (url === 'https://storage.test/part') return new Response('', { headers: { etag: 'etag' } });
      if (url === 'https://storage.test/post') return new Response('ok');
      if (url.endsWith('/assets/files')) return Response.json({ filePath: 'ws-b/file', postUrl: 'https://storage.test/post' });
      if (url.includes('/files/url')) return Response.json({ fileUrl: 'https://storage.test/file' });
      if (url.includes('/files/download')) return new Response('download');
      if (url.includes('/files/delete')) return Response.json({ deleted: true });
      return Response.json({ identity: key });
    }));
    const a = createTier0Client({ apiHost: 'https://a.test', apiKey: 'ws-a-key' });
    const b = createTier0Client({ apiHost: 'https://b.test', apiKey: 'ws-b-key' });
    const file = new File(['data'], 'test.txt');
    const uploadA = a.files.uploadFile(file, { multipart: {} });
    await started;
    configureClient({ apiHost: 'https://global.test', apiKey: 'global-key' });
    await Promise.all([
      a.systemApi.openapiv1authwhoami(), b.systemApi.openapiv1authwhoami(),
      b.files.uploadFile(file), b.files.getFileUrl({ filePath: 'ws-b/file' }),
      a.files.downloadFile({ filePath: 'ws-a/file' }), b.files.deleteFile({ filePath: 'ws-b/file' }),
      systemApi.openapiv1authwhoami(),
    ]);
    release();
    await uploadA;
    await a.files.resumeMultipartUpload(file, { fileKey: 'file-a', uploadId: 'up-a', partSize: 8 * 1024 * 1024, completedParts: [{ partNumber: 1, etag: 'etag' }] });
    for (const call of calls) {
      const expected = call.url.startsWith('https://a.test') ? 'ws-a-key'
        : call.url.startsWith('https://b.test') ? 'ws-b-key'
          : call.url.startsWith('https://global.test') ? 'global-key' : null;
      if (!call.url.includes('/files/download')) expect(call.key, call.url).toBe(expected);
      else expect([expected, null]).toContain(call.key);
      expect(call.authorization, call.url).toBe(expected ? `Bearer ${expected}` : null);
    }
    expect(calls.filter(c => c.url.includes('/multipart/complete'))).toHaveLength(2);
    expect(calls.some(c => c.url.includes('/files/download'))).toBe(true);
    expect(calls.some(c => c.url === 'https://storage.test/post')).toBe(true);
  });

  it('keeps the legacy multipart operation on its initial client during failure cleanup', async () => {
    let release!: () => void;
    let signalStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const requests: { url: string; key: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, key: new Headers(init?.headers).get('X-API-Key') });
      if (url.endsWith('/multipart/init')) {
        signalStarted();
        await gate;
        return Response.json({ fileKey: 'a', filePath: 'a', uploadId: 'a' });
      }
      if (url.endsWith('/multipart/part-urls')) return new Response('denied', { status: 403 });
      return Response.json({});
    }));
    configureClient({ apiHost: 'https://a.test', apiKey: 'a-key' });
    const pending = uploadFile(new File(['data'], 'test.txt'), { multipart: {} });
    await started;
    configureClient({ apiHost: 'https://b.test', apiKey: 'b-key' });
    release();
    await expect(pending).rejects.toThrow();
    expect(requests.map(r => new URL(r.url).pathname)).toEqual([
      '/openapi/v1/assets/files/multipart/init',
      '/openapi/v1/assets/files/multipart/part-urls',
      '/openapi/v1/assets/files/multipart/abort',
    ]);
    expect(requests.every(r => r.url.startsWith('https://a.test/') && r.key === 'a-key')).toBe(true);
  });

  it('rejects missing explicit keys even when a process key exists', () => {
    vi.stubEnv('TIER0_API_KEY', 'process-key');
    expect(() => createTier0Client({ apiKey: '' })).toThrow('non-empty apiKey');
    expect(() => createTier0Client({ apiKey: undefined as unknown as string })).toThrow('non-empty apiKey');
  });
});
