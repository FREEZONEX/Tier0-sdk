import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { systemApi, flowApi, launchpadApi, unsApi } from '../../src/openapi/api.js';
import { configureClient } from '../../src/openapi/client.js';

describe('API modules', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    configureClient({ apiHost: 'api.example.com' });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockResponse(data: unknown, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response);
  }

  describe('systemApi', () => {
    it('gwreload should call GET /gw/reload', async () => {
      mockResponse({ success: true });
      const result = await systemApi.gwreload();
      expect(result).toEqual({ success: true });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/gw/reload',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('openapiv1info should call POST /openapi/v1/info with body', async () => {
      mockResponse({ message: 'ok' });
      const body = {};
      const result = await systemApi.openapiv1info(body);
      expect(result).toEqual({ message: 'ok' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v1/info',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('flowApi', () => {
    it('openapiv1flowcreate should call POST /openapi/v1/flow/create', async () => {
      mockResponse({ id: 1 });
      const body = { flowName: 'test', flowType: 'type' };
      const result = await flowApi.openapiv1flowcreate(body);
      expect(result).toEqual({ id: 1 });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v1/flow/create',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('openapiv1flowlist should call POST /openapi/v1/flow/list', async () => {
      mockResponse({ list: [] });
      const body = { flowType: 'type' };
      const result = await flowApi.openapiv1flowlist(body);
      expect(result).toEqual({ list: [] });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v1/flow/list',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('openapiv1flowdelete should call POST /openapi/v1/flow/delete', async () => {
      mockResponse({ success: true });
      const body = { ids: [1, 2] };
      const result = await flowApi.openapiv1flowdelete(body);
      expect(result).toEqual({ success: true });
    });

    it('openapiv1flowdeploy should call POST /openapi/v1/flow/deploy', async () => {
      mockResponse({ flowId: 'abc' });
      const body = { id: 1, flowsJson: '{}' };
      const result = await flowApi.openapiv1flowdeploy(body);
      expect(result).toEqual({ flowId: 'abc' });
    });

    it('openapiv1flowget should call POST /openapi/v1/flow/get', async () => {
      mockResponse({ id: 1 });
      const body = { id: 1 };
      const result = await flowApi.openapiv1flowget(body);
      expect(result).toEqual({ id: 1 });
    });

    it('openapiv1flowflowdata should call POST /openapi/v1/flow/flowdata', async () => {
      mockResponse({ flows: [], rev: '1' });
      const body = { id: 1 };
      const result = await flowApi.openapiv1flowflowdata(body);
      expect(result).toEqual({ flows: [], rev: '1' });
    });

    it('openapiv1flowupdate should call POST /openapi/v1/flow/update', async () => {
      mockResponse({ success: true });
      const body = { id: 1, flowName: 'updated' };
      const result = await flowApi.openapiv1flowupdate(body);
      expect(result).toEqual({ success: true });
    });
  });

  describe('launchpadApi', () => {
    it('getMembers should encode the project path and send filters in the body', async () => {
      const response = {
        code: 200,
        data: { list: [], total: 0, page: 1, size: 20 },
      };
      mockResponse(response);
      const body = {
        roles: ['builder'],
        updatedAtStart: '2026-07-01T00:00:00Z',
        updatedAtEnd: '2026-07-20T23:59:59Z',
        page: 1,
        size: 20,
      };

      const result = await launchpadApi.openapiv1launchpadgetmembers({
        projectName: 'Factory / Operations',
        body,
      });

      expect(result).toEqual(response);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v1/launchpad/Factory%20%2F%20Operations/getMembers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('unsApi', () => {
    it('openapiv1unsbrowse should call POST /openapi/v1/uns/browse', async () => {
      mockResponse([]);
      const body = { path: '/test' };
      const result = await unsApi.openapiv1unsbrowse(body);
      expect(result).toEqual([]);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v1/uns/browse',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('openapiv1unscreate should call POST /openapi/v1/uns/create', async () => {
      mockResponse({ success: true });
      const body = { namespace: [] };
      const result = await unsApi.openapiv1unscreate(body);
      expect(result).toEqual({ success: true });
    });

    it('openapiv1unsdelete should call POST /openapi/v1/uns/delete', async () => {
      mockResponse({ success: true });
      const body = { topics: ['a/b'] };
      const result = await unsApi.openapiv1unsdelete(body);
      expect(result).toEqual({ success: true });
    });

    it('openapiv1unshistory should call POST /openapi/v1/uns/history', async () => {
      mockResponse([]);
      const body = { topics: ['a/b'], start_time: '2024-01-01', end_time: '2024-01-02' };
      const result = await unsApi.openapiv1unshistory(body);
      expect(result).toEqual([]);
    });

    it('openapiv1unsread should call POST /openapi/v1/uns/read', async () => {
      mockResponse([]);
      const body = { topics: ['a/b'] };
      const result = await unsApi.openapiv1unsread(body);
      expect(result).toEqual([]);
    });

    it('openapiv1unsrestore should call POST /openapi/v1/uns/restore', async () => {
      mockResponse({ success: true });
      const body = { path: '/a/b' };
      const result = await unsApi.openapiv1unsrestore(body);
      expect(result).toEqual({ success: true });
    });

    it('openapiv1unssearch should call POST /openapi/v1/uns/search', async () => {
      mockResponse([]);
      const body = { keyword: 'test' };
      const result = await unsApi.openapiv1unssearch(body);
      expect(result).toEqual([]);
    });

    it('openapiv1unsupdate should call POST /openapi/v1/uns/update', async () => {
      mockResponse({ success: true });
      const body = { path: '/a/b', alias: 'new' };
      const result = await unsApi.openapiv1unsupdate(body);
      expect(result).toEqual({ success: true });
    });

    it('openapiv1unswrite should call POST /openapi/v1/uns/write', async () => {
      mockResponse({ success: true });
      const body = { writes: [{ topic: 'a/b' }] };
      const result = await unsApi.openapiv1unswrite(body);
      expect(result).toEqual({ success: true });
    });
  });
});
