import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const subscription = { dispose: vi.fn().mockResolvedValue(undefined) };
  const subscribe = vi.fn().mockResolvedValue(subscription);
  const publish = vi.fn().mockResolvedValue(undefined);
  const invoke = vi.fn().mockResolvedValue({ status: 'completed' });
  const describe = vi.fn().mockResolvedValue({ code: 'orders.approve' });
  const off = vi.fn();
  const sdk = {
    streams: {
      messages: { onError: vi.fn(() => off), use: vi.fn(() => ({ subscribe, publish })) },
      requests: { use: vi.fn(() => ({ invoke, describe })) },
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  return { sdk, subscription, subscribe, publish, invoke, off };
});
vi.mock('@tier0/sdk/cloud', () => ({ createClient: () => fixture.sdk }));
// Runnable JavaScript caller deliberately has no TypeScript-only dependency.
// @ts-expect-error example JavaScript has no declaration file
import { openOrderInteractions } from '../examples/app-streams/client.mjs';

// Tests example behavior with a stub API; native broker coverage is separate.
describe('shipped App/Stream examples', () => {
  it('preserves caller intent and reuses the publisher, and always tears down', async () => {
    const app = await openOrderInteractions(vi.fn(), vi.fn());
    await app.approve('order-1', 'saved-business-intent');
    expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith({ orderId: 'order-1' }, { idempotencyKey: 'saved-business-intent' });
    const before = fixture.sdk.streams.messages.use.mock.calls.length;
    await app.publish('order-1');
    await app.publish('order-2');
    expect(fixture.sdk.streams.messages.use.mock.calls).toHaveLength(before);
    fixture.subscription.dispose.mockRejectedValueOnce(new Error('teardown failure'));
    await expect(app.dispose()).rejects.toThrow('teardown failure');
    expect(fixture.off).toHaveBeenCalledOnce();
    expect(fixture.sdk.dispose).toHaveBeenCalledOnce();
    await app.dispose();
    expect(fixture.sdk.dispose).toHaveBeenCalledOnce();
  });

  it('registers paired request and logical topic handlers in its v3 script', async () => {
    const require = createRequire(import.meta.url);
    const program = require('../examples/app-streams/stream-v3.cjs');
    const publish = vi.fn().mockResolvedValue(undefined);
    const use = vi.fn();
    const onRequest = vi.fn();
    const subscribe = vi.fn();
    program({ stream: { onRequest, messages: { publish, use, subscribe } } });
    expect(use).toHaveBeenCalledExactlyOnceWith({ topic: 'orders/accepted', access: 'publish' });
    const [request, handler] = onRequest.mock.calls[0];
    expect(request.request).toMatchObject({ code: 'orders.approve', sideEffect: 'write', idempotency: 'required' });
    expect(request.control).toBeUndefined();
    expect(await handler({ input: { orderId: 'order-1' } })).toEqual({ accepted: true });
    const [consumer, consume] = subscribe.mock.calls[0];
    expect(consumer.topic).toBe('orders/created');
    await consume({ input: { orderId: 'order-2' } });
    expect(publish.mock.calls).toEqual([
      [{ topic: 'orders/accepted', payload: { orderId: 'order-1' } }],
      [{ topic: 'orders/accepted', payload: { orderId: 'order-2' } }],
    ]);
  });

  it('ships and routes the Streams skill and examples', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.agents.skills).toContainEqual({ name: 'tier0-sdk-streams', path: './skills/tier0-sdk/tier0-sdk-streams' });
    expect(manifest.files).toContain('examples/app-streams/**');
    const root = readFileSync(new URL('../skills/tier0-sdk/SKILL.md', import.meta.url), 'utf8');
    expect(root).toContain('tier0-sdk-streams/SKILL.md');
  });
});
