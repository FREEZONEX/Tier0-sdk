import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureClient, ApiError } from '../../src/openapi/client.js';
import {
  uploadFile,
  uploadFileMultipart,
  shouldUseMultipart,
  DEFAULT_MULTIPART_PART_SIZE,
  MULTIPART_THRESHOLD_BYTES,
  type MultipartProgress,
} from '../../src/files.js';

describe('files multipart module', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // 隔离外部环境变量，避免本机配置影响单元测试
    vi.stubEnv('TIER0_API_HOST', undefined);
    vi.stubEnv('TIER0_API_KEY', undefined);
    configureClient({ apiHost: 'https://api.example.com', apiKey: 'test-key' });
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const FILE_KEY = 'm/f-key-1';
  const UPLOAD_ID = 'upload-1';
  const FILE_PATH = 'workspace/10086/attachment/20260706/abcdef-big.bin';

  /** 按 partNumber 构造分片直传 URL */
  function partUrl(n: number): string {
    return `https://bucket.example.com/multipart/${n}?uploadId=${UPLOAD_ID}`;
  }

  /** 构造 init 成功响应（multipart 契约） */
  function initResp(overrides: Record<string, unknown> = {}): Response {
    return jsonResponse({
      fileKey: FILE_KEY,
      filePath: FILE_PATH,
      uploadId: UPLOAD_ID,
      partSize: DEFAULT_MULTIPART_PART_SIZE,
      partCount: 1,
      expiresAt: 1751892400000,
      ...overrides,
    });
  }

  function partUrlsResp(partNumbers: number[]): Response {
    return jsonResponse({
      partUrls: partNumbers.map((n) => ({ partNumber: n, url: partUrl(n), expiresAt: 1751892400000 })),
    });
  }

  function completeResp(overrides: Record<string, unknown> = {}): Response {
    return jsonResponse({
      filePath: FILE_PATH,
      fileUrl: 'https://cdn/big.bin',
      sizeBytes: 3 * 1024 * 1024,
      expiresAt: 1751892400000,
      ...overrides,
    });
  }

  /** 从分片直传 URL 中解析 partNumber，便于按片构造 ETag / 计数 */
  function partNumberFromUrl(url: string): number {
    return Number(new URL(url).pathname.split('/').pop());
  }

  describe('shouldUseMultipart', () => {
    it('should auto-switch only for files larger than threshold', () => {
      expect(shouldUseMultipart(MULTIPART_THRESHOLD_BYTES + 1)).toBe(true);
      expect(shouldUseMultipart(MULTIPART_THRESHOLD_BYTES)).toBe(false);
      expect(shouldUseMultipart(1024)).toBe(false);
    });

    it('should use multipart when multipart option is provided even for small files', () => {
      expect(shouldUseMultipart(1024, {})).toBe(true);
    });
  });

  describe('uploadFileMultipart', () => {
    it('should run init -> part-urls -> PUT parts -> complete and return aligned result', async () => {
      const file = new File([new Uint8Array(3 * 1024 * 1024).fill(7)], 'big.bin', { type: 'application/octet-stream' });
      const partSize = 1024 * 1024;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ partSize, partCount: 3 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1, 2, 3]);
        if (url.includes('/multipart/complete')) return completeResp({ sizeBytes: 3 * 1024 * 1024 });
        // PUT 直传分片：按 URL 中的 partNumber 返回对应 ETag
        return new Response(null, { status: 200, headers: { etag: `"etag-${partNumberFromUrl(url)}"` } });
      });

      const progress: MultipartProgress[] = [];
      const result = await uploadFileMultipart(file, {
        partSize,
        concurrency: 2,
        onProgress: (p) => progress.push(p),
      });

      const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;

      // 调用序列：init -> part-urls -> 3 次 PUT -> complete
      expect(calls[0][0]).toBe('https://api.example.com/openapi/v1/assets/files/multipart/init');
      expect(calls[1][0]).toBe('https://api.example.com/openapi/v1/assets/files/multipart/part-urls');
      const putCalls = calls.filter(([, init]) => init.method === 'PUT');
      expect(putCalls).toHaveLength(3);
      expect(calls[calls.length - 1][0]).toBe('https://api.example.com/openapi/v1/assets/files/multipart/complete');

      // init body：分片参数 + 既有业务字段
      expect(JSON.parse(calls[0][1].body as string)).toEqual({
        fileName: 'big.bin',
        contentType: 'application/octet-stream',
        size: file.size,
        partSize,
        business: undefined,
        useBy: undefined,
        visibility: undefined,
        appInstanceId: undefined,
        sessionId: undefined,
      });

      // part-urls body
      expect(JSON.parse(calls[1][1].body as string)).toEqual({
        fileKey: FILE_KEY,
        uploadId: UPLOAD_ID,
        partNumbers: [1, 2, 3],
      });

      // 每片 body 是 size 正确的 Blob 切片（file.slice）
      const putBodies = putCalls.map(([, init]) => init.body as Blob);
      for (const body of putBodies) {
        expect(body).toBeInstanceOf(Blob);
      }
      expect(putBodies.map((b) => b.size).sort((a, b) => a - b)).toEqual([1024 * 1024, 1024 * 1024, 1024 * 1024]);

      // complete body：按 partNumber 升序上报全部 parts
      expect(JSON.parse(calls[calls.length - 1][1].body as string)).toEqual({
        fileKey: FILE_KEY,
        uploadId: UPLOAD_ID,
        parts: [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 2, etag: '"etag-2"' },
          { partNumber: 3, etag: '"etag-3"' },
        ],
      });

      // 进度回调：doneParts 单调递增到总分片数
      expect(progress.map((p) => p.doneParts)).toEqual([1, 2, 3]);
      expect(progress[progress.length - 1].totalParts).toBe(3);
      expect(progress[progress.length - 1].uploadedBytes).toBe(file.size);
      expect(progress[progress.length - 1].percent).toBe(100);

      // 返回结构与 uploadFile 对齐（postUrl/postFields 恒为空）
      expect(result).toEqual({
        fileId: undefined,
        filePath: FILE_PATH,
        fileUrl: 'https://cdn/big.bin',
        postUrl: '',
        postFields: {},
        uploadId: UPLOAD_ID,
        sizeBytes: 3 * 1024 * 1024,
        expiresAt: 1751892400000,
      });
    });

    it('should slice the last part to the remaining size', async () => {
      const file = new File([new Uint8Array(2.5 * 1024 * 1024).fill(1)], 'big.bin', {
        type: 'application/octet-stream',
      });
      const partSize = 1024 * 1024; // 2.5MB / 1MB -> 3 片

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ partSize, partCount: 3 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1, 2, 3]);
        if (url.includes('/multipart/complete')) return completeResp({ sizeBytes: file.size });
        return new Response(null, { status: 200, headers: { etag: '"e"' } });
      });

      await uploadFileMultipart(file, { partSize, concurrency: 1 });

      const putCalls = (mockFetch.mock.calls as Array<[string, RequestInit]>).filter(([, init]) => init.method === 'PUT');
      expect(putCalls).toHaveLength(3);
      const sizes = putCalls.map(([, init]) => (init.body as Blob).size).sort((a, b) => a - b);
      expect(sizes).toEqual([0.5 * 1024 * 1024, 1024 * 1024, 1024 * 1024]);
    });

    it('should retry a failed part with backoff and keep other parts untouched', async () => {
      const file = new File([new Uint8Array(2 * 1024 * 1024).fill(2)], 'big.bin', {
        type: 'application/octet-stream',
      });
      const partSize = 1024 * 1024; // 2 片
      let part1Attempts = 0;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ partSize, partCount: 2 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1, 2]);
        if (url.includes('/multipart/complete')) return completeResp({ sizeBytes: 2 * 1024 * 1024 });
        if (init.method === 'PUT' && partNumberFromUrl(url) === 1) {
          part1Attempts += 1;
          if (part1Attempts === 1) {
            return new Response('part failed', { status: 500 });
          }
        }
        return new Response(null, { status: 200, headers: { etag: `"etag-${partNumberFromUrl(url)}"` } });
      });

      const result = await uploadFileMultipart(file, { partSize, concurrency: 1 });

      // 分片 1 首次失败 + 1 次重试成功；分片 2 只传一次
      expect(part1Attempts).toBe(2);
      const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
      const completeBody = JSON.parse(calls[calls.length - 1][1].body as string);
      expect(completeBody.parts).toEqual([
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ]);
      expect(result.sizeBytes).toBe(2 * 1024 * 1024);
    });

    it('should abort session and throw structured ApiError when a part keeps failing', async () => {
      const file = new File([new Uint8Array(1024 * 1024).fill(3)], 'big.bin', {
        type: 'application/octet-stream',
      });
      const partSize = 1024 * 1024;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ partSize, partCount: 1 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1]);
        if (url.includes('/multipart/complete')) return completeResp();
        if (init.method === 'PUT') {
          // 网关风格 JSON 错误体，status/code/msg 应被保留
          return jsonResponse({ code: 50001, msg: 'part upload failed' }, 500);
        }
        if (url.includes('/multipart/abort')) return jsonResponse({ aborted: true });
        return new Response(null, { status: 200 });
      });

      const err = await uploadFileMultipart(file, { partSize }).catch((e) => e);

      // 分片重试仍失败后调用 abort，携带 fileKey/uploadId
      const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
      const abortCall = calls.find(([url]) => url.includes('/multipart/abort'));
      expect(abortCall).toBeDefined();
      expect(JSON.parse(abortCall![1].body as string)).toEqual({ fileKey: FILE_KEY, uploadId: UPLOAD_ID });

      // 结构化 ApiError：status/code/msg 均可机读
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(500);
      expect(err.code).toBe(50001);
      expect(err.msg).toBe('part upload failed');
      expect(err.message).toBe('HTTP 500: part upload failed');
    });

    it('should fall back to raw text for non-JSON part error body', async () => {
      const file = new File([new Uint8Array(1024)], 'big.bin', { type: 'application/octet-stream' });
      const partSize = 1024;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ partSize, partCount: 1 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1]);
        if (url.includes('/multipart/complete')) return completeResp();
        if (init.method === 'PUT') {
          // S3/RustFS 风格 XML 错误体，保留原文
          return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
        }
        if (url.includes('/multipart/abort')) return jsonResponse({ aborted: true });
        return new Response(null, { status: 200 });
      });

      const err = await uploadFileMultipart(file, { partSize }).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(403);
      expect(err.code).toBe(0);
      expect(err.msg).toBe('<Error><Code>AccessDenied</Code></Error>');
    });

    it('should reject non-File input and empty file', async () => {
      await expect(uploadFileMultipart(null as unknown as File)).rejects.toThrow(
        'uploadFile requires a File object'
      );
      const empty = new File([], 'empty.bin', { type: 'application/octet-stream' });
      await expect(uploadFileMultipart(empty)).rejects.toThrow('non-empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should pass signal through init/part-urls/complete', async () => {
      const controller = new AbortController();
      const file = new File([new Uint8Array(2 * 1024 * 1024).fill(4)], 'sig.bin', {
        type: 'application/octet-stream',
      });
      const partSize = 1024 * 1024;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ partSize, partCount: 2 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1, 2]);
        if (url.includes('/multipart/complete')) return completeResp({ sizeBytes: 2 * 1024 * 1024 });
        return new Response(null, { status: 200, headers: { etag: '"e"' } });
      });

      await uploadFileMultipart(file, { partSize, signal: controller.signal });

      const calls = mockFetch.mock.calls as Array<[string, RequestInit]>;
      expect(calls[0][1].signal).toBe(controller.signal);
      expect(calls[1][1].signal).toBe(controller.signal);
      expect(calls[calls.length - 1][1].signal).toBe(controller.signal);
    });
  });

  describe('uploadFile multipart routing', () => {
    it('should keep single POST path for small files without multipart option', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            filePath: 'p/f.csv',
            postUrl: 'https://bucket.s3.amazonaws.com/upload',
            postFields: { key: 'p/f.csv', policy: 'p' },
          })
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      const file = new File(['a'], 'f.csv', { type: 'text/csv' });
      const result = await uploadFile(file);

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/openapi/v1/assets/files');
      expect(result.filePath).toBe('p/f.csv');
    });

    it('should route to multipart endpoints when multipart option provided for small file', async () => {
      const file = new File([new Uint8Array(2 * 1024 * 1024).fill(5)], 'small-but-multipart.bin', {
        type: 'application/octet-stream',
      });
      const partSize = 1024 * 1024;
      const onProgress = vi.fn();

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/multipart/init')) return initResp({ filePath: 'm/small.bin', partSize, partCount: 2 });
        if (url.includes('/multipart/part-urls')) return partUrlsResp([1, 2]);
        if (url.includes('/multipart/complete'))
          return completeResp({ filePath: 'm/small.bin', sizeBytes: 2 * 1024 * 1024 });
        return new Response(null, { status: 200, headers: { etag: `"e${partNumberFromUrl(url)}"` } });
      });

      const result = await uploadFile(file, { multipart: { partSize, concurrency: 2, onProgress } });

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.example.com/openapi/v1/assets/files/multipart/init');
      expect(onProgress).toHaveBeenCalled();
      expect(result.filePath).toBe('m/small.bin');
      expect(result.uploadId).toBe(UPLOAD_ID);
    });
  });
});
