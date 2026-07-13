import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureClient } from '../../src/openapi/client.js';
import { uploadFile, getFileUrl, downloadFile, deleteFile } from '../../src/files.js';

describe('files module', () => {
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

  describe('uploadFile', () => {
    it('should reject non-File input', async () => {
      await expect(uploadFile(null as unknown as File)).rejects.toThrow('uploadFile requires a File object');
    });

    it('should reject forbidden file extension', async () => {
      const file = new File(['x'], 'evil.html', { type: 'text/html' });
      await expect(uploadFile(file)).rejects.toThrow('forbidden file extension: .html');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject files larger than 10MB before any request', async () => {
      const file = { name: 'big.bin', size: 11 * 1024 * 1024, type: 'application/octet-stream' } as File;
      await expect(uploadFile(file)).rejects.toThrow('exceeds the 10MB limit');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should request presigned URL then PUT file content', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              fileId: 123,
              filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
              fileUrl: '',
              uploadUrl: 'https://bucket.s3.amazonaws.com/put?X-Amz-Signature=sig',
              expiresAt: 1751892400000,
            },
          })
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const file = new File(['a,b\n1,2'], 'report.csv', { type: 'text/csv' });
      const result = await uploadFile(file, {
        business: 'attachment',
        useBy: 'workspace',
        visibility: 'private',
        appInstanceId: 'app-123',
        sessionId: 'sess-456',
      });

      // 第一步：申请 presigned URL
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.example.com/openapi/v1/assets/files',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'X-API-Key': 'test-key',
          }),
        })
      );
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        fileName: 'report.csv',
        contentType: 'text/csv',
        size: file.size,
        business: 'attachment',
        useBy: 'workspace',
        visibility: 'private',
        appInstanceId: 'app-123',
        sessionId: 'sess-456',
      });

      // 第二步：直传存储
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://bucket.s3.amazonaws.com/put?X-Amz-Signature=sig',
        expect.objectContaining({
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': 'text/csv' },
        })
      );

      expect(result).toEqual({
        fileId: '123',
        filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
        fileUrl: '',
        uploadUrl: 'https://bucket.s3.amazonaws.com/put?X-Amz-Signature=sig',
        expiresAt: 1751892400000,
      });
    });

    it('should default contentType to application/octet-stream', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ filePath: 'p/f.bin', fileUrl: 'https://cdn/f.bin', uploadUrl: 'https://s3/put' })
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const file = new File(['data'], 'f.bin');
      const result = await uploadFile(file, { visibility: 'public' });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).contentType).toBe('application/octet-stream');
      expect(mockFetch.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/octet-stream' });
      expect(result.fileUrl).toBe('https://cdn/f.bin');
    });

    it('should throw when presign response misses uploadUrl or filePath', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ filePath: 'p/f.csv' }));

      const file = new File(['x'], 'report.csv', { type: 'text/csv' });
      await expect(uploadFile(file)).rejects.toThrow('invalid upload response');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw when direct PUT to storage fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ filePath: 'p/f.csv', uploadUrl: 'https://s3/put' }))
        .mockResolvedValueOnce(new Response('AccessDenied', { status: 403 }));

      const file = new File(['x'], 'report.csv', { type: 'text/csv' });
      await expect(uploadFile(file)).rejects.toThrow('direct upload to storage failed: 403');
    });
  });

  describe('getFileUrl', () => {
    it('should require filePath', async () => {
      await expect(getFileUrl({ filePath: '' })).rejects.toThrow('getFileUrl requires filePath');
    });

    it('should build query and return url with expiresAt', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ fileUrl: 'https://bucket.s3.amazonaws.com/get?sig', expiresAt: 1751892400000 })
      );

      const result = await getFileUrl({
        filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
        expiredSec: 3600,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.example.com/openapi/v1/assets/files/url?filePath=workspace%2F10086%2Fattachment%2F20260706%2Fabcdef-report.csv&expiredSec=3600'
      );
      expect(result).toEqual({
        fileUrl: 'https://bucket.s3.amazonaws.com/get?sig',
        expiresAt: 1751892400000,
      });
    });

    it('should throw when response misses fileUrl', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await expect(getFileUrl({ filePath: 'p/f.csv' })).rejects.toThrow('missing fileUrl');
    });
  });

  describe('downloadFile', () => {
    it('should require filePath', async () => {
      await expect(downloadFile({ filePath: '' })).rejects.toThrow('downloadFile requires filePath');
    });

    it('should fetch download endpoint with auth headers and return raw response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('file-content', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment;filename=report.csv',
          },
        })
      );

      const result = await downloadFile({
        filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
        responseContentDisposition: 'attachment;filename=report.csv',
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.example.com/openapi/v1/assets/files/download?filePath=workspace%2F10086%2Fattachment%2F20260706%2Fabcdef-report.csv&responseContentDisposition=attachment%3Bfilename%3Dreport.csv'
      );
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('follow');
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key',
        'X-API-Key': 'test-key',
      });

      expect(result.contentType).toBe('text/csv');
      expect(result.contentDisposition).toBe('attachment;filename=report.csv');
      expect(await result.response.text()).toBe('file-content');
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
      await expect(downloadFile({ filePath: 'p/missing.csv' })).rejects.toThrow('download failed: 404');
    });
  });

  describe('deleteFile', () => {
    it('should require filePath', async () => {
      await expect(deleteFile({ filePath: '' })).rejects.toThrow('deleteFile requires filePath');
    });

    it('should post filePath and return deleted flag', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));

      const result = await deleteFile({ filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/openapi/v1/assets/files/delete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv' }),
        })
      );
      expect(result).toEqual({ deleted: true });
    });

    it('should treat empty success response as deleted', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const result = await deleteFile({ filePath: 'p/f.csv' });
      expect(result).toEqual({ deleted: true });
    });
  });
});
