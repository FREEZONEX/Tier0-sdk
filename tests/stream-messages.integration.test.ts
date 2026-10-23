import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '../src/client.js';
import { installAppRuntime } from '../src/runtime.js';

// Parent fixture serves the real SYS issuer contract and a locally trusted WSS
// NATS Core broker. Only public keys cross this bridge; no client seeds in env.
const fixture = process.env.TIER0_STREAM_MESSAGES_FIXTURE_URL;
describe.skipIf(!fixture)('Stream messages real SYS/NATS Core contract', () => {
  const publisher = createClient({ transportTimeoutMs: 3_000 });
  const subscriber = createClient({ transportTimeoutMs: 3_000 });
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installAppRuntime({
      appId: process.env.TIER0_STREAM_MESSAGES_FIXTURE_APP_ID ?? '73ed9aae-8526-46ca-a70e-a70eef87c456',
      request: (path, body, { signal }) => fetch(new URL(path, fixture!), {
        method: 'POST', redirect: 'manual', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
  });
  afterAll(async () => {
    await Promise.all([publisher.dispose(), subscriber.dispose()]);
    uninstall?.();
  });

  it('uses independently generated nonce-auth keys to deliver a typed envelope and dispose', async () => {
    const topic = process.env.TIER0_STREAM_MESSAGES_FIXTURE_TOPIC ?? 'sdk.contract';
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const received = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    // Register rejection handlers immediately, including during connection setup.
    void received.catch(() => undefined);
    const remove = subscriber.streams.messages.onError(reject);
    const timer = setTimeout(() => reject(new Error('NATS delivery deadline exceeded')), 5_000);
    let sub: Awaited<ReturnType<ReturnType<typeof subscriber.streams.messages.use>['subscribe']>> | undefined;
    try {
      sub = await subscriber.streams.messages.use({ topic }).subscribe(resolve);
      const sent = await publisher.streams.messages.use({ topic }).publish({ text: 'SDK contract' }, { correlationId: 'sdk-native-wss' });
      expect(await received).toEqual(sent);
      await sub.dispose();
      expect(sub.disposed).toBe(true);
    } finally {
      clearTimeout(timer);
      remove();
      await sub?.dispose();
    }
  }, 15_000);
});
