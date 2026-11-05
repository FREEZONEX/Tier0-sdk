import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTier0Client, configureClient, systemApi, uploadFile, getFileUrl, downloadFile, deleteFile } from '../../src/index.js';

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
    // List every operation's intended destination and principal; never infer the
    // expected identity from the host that the implementation actually used.
    const expectedCalls = [
      ['https://a.test/openapi/v1/assets/files/multipart/init', 'ws-a-key'],
      ['https://a.test/openapi/v1/auth/whoami', 'ws-a-key'],
      ['https://b.test/openapi/v1/auth/whoami', 'ws-b-key'],
      ['https://global.test/openapi/v1/auth/whoami', 'global-key'],
      ['https://b.test/openapi/v1/assets/files', 'ws-b-key'],
      ['https://storage.test/post', null],
      ['https://b.test/openapi/v1/assets/files/url?filePath=ws-b%2Ffile', 'ws-b-key'],
      ['https://a.test/openapi/v1/assets/files/download?filePath=ws-a%2Ffile', 'ws-a-key'],
      ['https://b.test/openapi/v1/assets/files/delete', 'ws-b-key'],
      ['https://a.test/openapi/v1/assets/files/multipart/part-urls', 'ws-a-key'],
      ['https://storage.test/part', null],
      ['https://a.test/openapi/v1/assets/files/multipart/complete', 'ws-a-key'],
      ['https://a.test/openapi/v1/assets/files/multipart/complete', 'ws-a-key'],
    ].map(([url, key]) => {
      const whoami = url!.endsWith('/auth/whoami');
      return JSON.stringify({ url, key: whoami ? key : null, authorization: key && !whoami ? `Bearer ${key}` : null });
    }).sort();
    expect(calls.map(call => JSON.stringify(call)).sort()).toEqual(expectedCalls);
  });

  it('keeps the legacy multipart operation on its initial client during failure cleanup', async () => {
    let release!: () => void;
    let signalStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const requests: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
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
    expect(requests.every(r => r.url.startsWith('https://a.test/') && r.authorization === 'Bearer a-key')).toBe(true);
  });

  it('preserves legacy file helpers as Array.map callbacks', async () => {
    configureClient({ apiHost: 'https://legacy.test', apiKey: 'legacy-key' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer legacy-key');
      calls.push(url);
      if (url.includes('/files/url')) return Response.json({ fileUrl: 'https://storage.test/a' });
      if (url.includes('/files/download')) return new Response('file');
      return Response.json({ deleted: true });
    }));
    const options = [{ filePath: 'a' }, { filePath: 'b' }];
    expect(await Promise.all(options.map(getFileUrl))).toHaveLength(2);
    expect(await Promise.all(options.map(downloadFile))).toHaveLength(2);
    expect(await Promise.all(options.map(deleteFile))).toEqual([{ deleted: true }, { deleted: true }]);
    expect(calls).toHaveLength(6);
  });

  it('rejects missing explicit keys even when a process key exists', () => {
    vi.stubEnv('TIER0_API_KEY', 'process-key');
    expect(() => createTier0Client({ apiKey: '' })).toThrow('non-empty apiKey');
    expect(() => createTier0Client({ apiKey: undefined as unknown as string })).toThrow('non-empty apiKey');
  });
});
