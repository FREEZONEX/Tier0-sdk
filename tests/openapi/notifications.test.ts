import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsApi } from '../../src/openapi/api.js';
import { configureClient } from '../../src/openapi/client.js';
import type { components } from '../../src/openapi/types.js';
import { useOpenapiv1notificationssend as useReactSend } from '../../src/openapi/react.js';
import { useOpenapiv1notificationssend as useVueSend } from '../../src/openapi/vue.js';

// Capture React Query's mutation function; exercise the real API and HTTP client.
vi.mock('@tanstack/react-query', () => ({ useMutation: (options: unknown) => options }));
type Request = components['schemas']['SendNotificationReq'];
const response = { messageId: '123', status: 'accepted', createdAt: '2026-09-07T00:00:00Z' };
const base: Request = {
  recipientUserId: '9007199254740993', type: 'inbox', title: 'Title', content: 'Content',
  idempotencyKey: 'event-123', mode: 'test', link: '/orders/123',
};

beforeEach(() => {
  configureClient({ apiHost: 'api.example.com' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response }));
});
afterEach(() => vi.unstubAllGlobals());

const cases: [string, Partial<Request>, string[]][] = [
  ['omitted', {}, ['web', 'mobile']],
  ['undefined', { channels: undefined }, ['web', 'mobile']],
  ['all', { channels: ['web', 'mobile'] }, ['web', 'mobile']],
  ['web and desktop', { channels: ['web'] }, ['web']],
  ['mobile', { channels: ['mobile'] }, ['mobile']],
  ['silent', { channels: [] }, []],
  ['duplicates', { channels: ['mobile', 'web', 'mobile'] }, ['mobile', 'web']],
  ['single-channel duplicates', { channels: ['web', 'web'] }, ['web']],
];
const entrypoints: [string, () => (body: Request) => Promise<unknown>][] = [
  ['native', () => notificationsApi.openapiv1notificationssend],
  ['React', () => (useReactSend() as unknown as { mutationFn: (body: Request) => Promise<unknown> }).mutationFn],
  ['Vue', () => useVueSend().execute],
];
for (const [name, createSend] of entrypoints) {
  describe(name, () => {
    it.each(cases)('serializes %s channels without mutating input', async (_label, fields, expected) => {
      const body = { ...base, ...fields };
      const before = structuredClone(body);
      if (body.channels) Object.freeze(body.channels);
      Object.freeze(body);
      expect(await createSend()(body)).toEqual(response);
      expect(fetch).toHaveBeenCalledExactlyOnceWith('http://api.example.com/openapi/v1/notifications/send',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...body, channels: expected }) }));
      expect(body).toEqual(before);
    });
    it.each([['desktop'], ['email'], ['web', 'desktop'], null, 'web', [1], new Array(1)].map(channels => [channels]))('rejects invalid runtime channels %j before sending', async (channels) => {
      await expect(Promise.resolve().then(() => createSend()({ ...base, channels } as Request))).rejects.toThrow(TypeError);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
}
