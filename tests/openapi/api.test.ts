import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { systemApi, appsApi, notificationsApi, platformApi } from '../../src/openapi/api.js';
import * as publicApi from '../../src/openapi/api.js';
import { ApiError, configureClient } from '../../src/openapi/client.js';

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
    it('does not export retired Flow, Namespace or gateway reload operations', () => {
      expect(Object.hasOwn(publicApi, 'flowApi')).toBe(false);
      expect(Object.hasOwn(publicApi, 'unsApi')).toBe(false);
      expect(Object.hasOwn(systemApi, 'gwreload')).toBe(false);
    });

    it('openapiV2Info should call POST /openapi/v2/info with body', async () => {
      mockResponse({ message: 'ok' });
      const body = {};
      const result = await systemApi.openapiV2Info(body);
      expect(result).toEqual({ message: 'ok' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v2/info',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('appsApi', () => {
    it('does not export or invoke the retired launchpad members endpoint', () => {
      globalThis.fetch = vi.fn();
      expect(Object.hasOwn(publicApi, 'launchpadApi')).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it('lists App access members by App ID with the current body filters', async () => {
      const data = {
        appId: 'app-owned-7', published: 1, allActiveMembers: 2, roles: [], list: [], total: 0, page: 1, size: 20,
      };
      const response = { code: 200, msg: 'success', data };
      mockResponse(response);
      const body = {
        appId: 'app-owned-7',
        roleKeys: ['builder'],
        grantedAtStart: 1782864000000,
        grantedAtEnd: 1784591999000,
        page: 1,
        size: 20,
      };

      const result = await appsApi.openapiV2AppsAccessMembersList(body);

      expect(result.data.appId).toBe(body.appId);
      expect(result).toEqual(response);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v2/apps/access-members/list',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('platformApi', () => {
    it('getMembers should send platform member filters in the body', async () => {
      const response = {
        code: 200,
        data: { list: [], total: 0, page: 1, size: 20 },
      };
      mockResponse(response);
      const body = {
        keyword: 'alice',
        roles: ['builder'],
        statuses: ['active'],
        updatedAtStart: '2026-07-01T00:00:00Z',
        updatedAtEnd: '2026-07-20T23:59:59Z',
        page: 1,
        size: 20,
      };

      const result = await platformApi.openapiV2PlatformGetmembers(body);

      expect(result).toEqual(response);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v2/platform/getMembers',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('notificationsApi', () => {
    // notifications 响应无 {code,msg,data} 信封：成功=裸 JSON，错误=真实 HTTP 状态码 + {errorCode,message}
    it('openapiV2NotificationsSend should call POST /openapi/v2/notifications/send and return bare JSON', async () => {
      const bare = { messageId: '7123456789012345', status: 'accepted', createdAt: '2026-08-25T00:00:00Z' };
      mockResponse(bare);
      const body = {
        recipientUserId: '333145365391552',
        type: 'inbox',
        title: 'Order shipped',
        content: 'Your order has shipped.',
        idempotencyKey: 'order-A1029-shipped-v1',
      };
      const result = await notificationsApi.openapiV2NotificationsSend(body);
      expect(result).toEqual(bare);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://api.example.com/openapi/v2/notifications/send',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...body, channels: ['web', 'mobile'] }) })
      );
    });

    it('openapiV2NotificationsGet should call POST /openapi/v2/notifications/get', async () => {
      const bare = { messageId: '7123456789012345', type: 'inbox', status: 'sent', createdAt: '2026-08-25T00:00:00Z' };
      mockResponse(bare);
      const result = await notificationsApi.openapiV2NotificationsGet({ messageId: '7123456789012345' });
      expect(result).toEqual(bare);
    });

    it('error responses throw ApiError with parseable {errorCode,message} in msg', async () => {
      const errBody = { errorCode: 'IDEMPOTENCY_KEY_CONFLICT', message: 'idempotency key conflict' };
      mockResponse(errBody, 409);
      const promise = notificationsApi.openapiV2NotificationsSend({
        recipientUserId: '1',
        type: 'inbox',
        title: 't',
        content: 'c',
        idempotencyKey: 'k',
      });
      const err = (await promise.catch((e: unknown) => e)) as ApiError;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(409);
      // notifications 错误体没有 {code,msg} 信封字段，原始 JSON 文本兜底落在 err.msg——skill 文档教的解析模式
      const parsed = JSON.parse(err.msg);
      expect(parsed.errorCode).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(parsed.message).toBe('idempotency key conflict');
    });
  });

});
