import { describe, it, expect, beforeAll } from 'vitest';
import { configureClient, ApiError } from '../../src/openapi/client.js';
import { systemApi, flowApi, notificationsApi, unsApi } from '../../src/openapi/api.js';

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

  // notifications 端到端：发给 Key 主人自己 + test 模式 + 静默（无 channels），不打扰任何真实用户
  it('should send a silent test notification to self and reach a terminal status', async () => {
    const who = await systemApi.openapiv1authwhoami();
    expect(who.code).toBe(200);
    const recipientUserId = String(who.data.userID);

    const sendResp = await notificationsApi.openapiv1notificationssend({
      recipientUserId,
      type: 'inbox',
      title: 'SDK integration check',
      content: 'Silent test notification sent by tier0-sdk integration tests. Safe to ignore.',
      idempotencyKey: `sdk-integration-${Date.now()}`,
      mode: 'test',
      // no channels = silent: inbox only
    });
    expect(sendResp.messageId).toMatch(/^\d+$/);
    expect(['accepted', 'sent', 'failed']).toContain(sendResp.status);

    // 轮询到终态（worker 异步建信，通常秒级）
    let status = sendResp.status;
    for (let i = 0; i < 10 && status === 'accepted'; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const got = await notificationsApi.openapiv1notificationsget({ messageId: sendResp.messageId });
      expect(got.messageId).toBe(sendResp.messageId);
      status = got.status;
    }
    expect(status).toBe('sent');
  }, 30_000);

  it('should return structured 404 for a foreign messageId', async () => {
    const err = await notificationsApi
      .openapiv1notificationsget({ messageId: '1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect(JSON.parse((err as ApiError).msg).errorCode).toBe('MESSAGE_NOT_FOUND');
  });
});
