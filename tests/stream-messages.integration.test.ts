import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jwtAuthenticator, wsconnect, type NatsConnection } from '@nats-io/nats-core';
import { createUser } from '@nats-io/nkeys';
import { createClient } from '../src/client.js';
import type { AppRuntime } from '../src/runtime.js';
import type { StreamMessage } from '../src/streams/messages.js';

// Fixture HTTP adapter: POST /openapi/v2/stream-messages/connect uses the production Go issuer.
// Fixed fixture Authority; this does not exercise SYS Connect RPC, SQL roles/App policy,
// Gateway authentication, production topic-policy checks, or browser end-to-end flows.
// Request: {appId, topics:[{topic,publish,subscribe}],clientPublicKey}; response:
// unwrapped stream-messages/v1 ticket with a trusted WSS URL, RFC3339 expiry,
// scoped permissions and maxPayloadBytes. No client seed is supplied to the server.
// Optional CONTROL_URL enables native stop/start and monitoring acceptance tests.
// `npm run test:streams:nats` provisions both using the production Go issuer.
const fixture = process.env.TIER0_STREAM_MESSAGES_FIXTURE_URL;
const control = process.env.TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL;
const topic = process.env.TIER0_STREAM_MESSAGES_FIXTURE_TOPIC ?? 'sdk/contract';
const runtimeKey = Symbol.for('tier0.sdk.app-runtime.v1');
const runtimeGlobal = globalThis as typeof globalThis & { [runtimeKey]?: AppRuntime };
type Stats = {
  connections: number;
  subscriptions: number;
  issued: { clientPublicKey: string; expiresAt: string; issuedAt: string }[];
};
interface NativeTicket {
  url: string;
  userJwt: string;
  expiresAt: string;
  permissions: { publishSubject: string }[];
}

async function mintNativeTicket(publicKey: string): Promise<NativeTicket> {
  const response = await fetch(new URL('/openapi/v2/stream-messages/connect', fixture!), {
    method: 'POST', signal: AbortSignal.timeout(3_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: runtimeGlobal[runtimeKey]!.appId, clientPublicKey: publicKey,
      topics: [{ topic, publish: true, subscribe: false }],
    }),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<NativeTicket>;
}

async function fixtureControl(path: string, method = 'GET'): Promise<Stats> {
  const response = await fetch(new URL(path, control!), { method, signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Fixture control ${path}: ${response.status}`);
  return response.json() as Promise<Stats>;
}

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(40);
  }
  throw new Error('Native NATS acceptance deadline exceeded.');
}

describe.skipIf(!fixture).sequential('Stream messages production Go issuer + native NATS Core contract', () => {
  let publisher: ReturnType<typeof createClient>;
  let subscriber: ReturnType<typeof createClient>;
  let previousRuntime: AppRuntime | undefined;
  let errors: string[];
  let tickets: { clientPublicKey: string; expiresAt: string; userJwt: string }[];

  beforeEach(async () => {
    if (control) await fixtureControl('/__fixture/broker/start', 'POST');
    publisher = createClient({ transportTimeoutMs: 3_000 });
    subscriber = createClient({ transportTimeoutMs: 3_000 });
    errors = []; tickets = [];
    publisher.streams.messages.onError(error => errors.push(error.errorCode));
    subscriber.streams.messages.onError(error => errors.push(error.errorCode));
    previousRuntime = runtimeGlobal[runtimeKey];
    // Exact SWE bridge behavior: symbol injection before App calls, no installAppRuntime.
    runtimeGlobal[runtimeKey] = {
      appId: process.env.TIER0_STREAM_MESSAGES_FIXTURE_APP_ID ?? '73ed9aae-8526-46ca-a70e-a70eef87c456',
      request: async (path, body, { signal }) => {
        const response = await fetch(new URL(path, fixture!), {
          method: 'POST', redirect: 'manual', signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (response.ok) {
          const ticket = await response.clone().json() as { expiresAt: string; userJwt: string };
          tickets.push({ clientPublicKey: (body as { clientPublicKey: string }).clientPublicKey, ...ticket });
        }
        return response;
      },
    };
  });
  afterEach(async () => {
    await Promise.all([publisher?.dispose(), subscriber?.dispose()]);
    if (previousRuntime) runtimeGlobal[runtimeKey] = previousRuntime;
    else delete runtimeGlobal[runtimeKey];
    if (control) {
      await fixtureControl('/__fixture/broker/start', 'POST');
      await until(() => fixtureControl('/__fixture/stats'), stats => stats.connections === 0 && stats.subscriptions === 0);
    }
  });

  it('autodetects the SWE symbol and delivers via real TLS, JWT and independent nonce-auth keys', async () => {
    const received: StreamMessage[] = [];
    const sub = await subscriber.streams.messages.use({ topic }).subscribe(message => { received.push(message); });
    const sent = await publisher.streams.messages.use({ topic }).publish({ text: 'SDK contract' }, { correlationId: 'sdk-native-wss' });
    await until(async () => received, values => values.length === 1);
    expect(received).toEqual([sent]);
    expect(tickets).toHaveLength(2);
    expect(tickets[0].clientPublicKey).not.toBe(tickets[1].clientPublicKey);
    for (const ticket of tickets) {
      const claims = JSON.parse(Buffer.from(ticket.userJwt.split('.')[1], 'base64url').toString());
      expect(claims.sub).toBe(ticket.clientPublicKey);
      expect(claims.exp * 1_000).toBe(Date.parse(ticket.expiresAt));
    }
    await sub.dispose();
    await publisher.streams.messages.use({ topic }).publish({ text: 'after disposal' });
    await delay(150);
    expect(received).toEqual([sent]);
    expect(errors).toEqual([]);
  }, 15_000);

  it.skipIf(!control)('refreshes short-lived real JWTs before expiry and restores subscriptions without replay', async () => {
    const received: StreamMessage[] = [];
    await subscriber.streams.messages.use({ topic }).subscribe(message => { received.push(message); });
    const out = publisher.streams.messages.use({ topic });
    const first = await out.publish({ stage: 'before expiry' });
    await until(async () => received, values => values.length === 1);
    const originals = tickets.slice();
    // Fixture TTL is the production issuer's minimum 10s, never a fake clock.
    const originalExpiry = Math.max(...originals.map(ticket => Date.parse(ticket.expiresAt)));
    await until(async () => tickets, values => values.length >= 4 &&
      values.slice(2).every(ticket => Date.parse(ticket.expiresAt) > originalExpiry), 15_000);
    await until(() => fixtureControl('/__fixture/stats'), stats => stats.connections === 2 && stats.subscriptions === 1);
    await delay(Math.max(0, originalExpiry - Date.now()) + 150);
    const second = await out.publish({ stage: 'after original JWT expired' });
    await until(async () => received, values => values.length === 2);
    expect(received).toEqual([first, second]);
    expect(new Set(tickets.map(ticket => ticket.clientPublicKey)).size).toBe(tickets.length);
    expect(tickets.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tickets.map(ticket => ticket.clientPublicKey)).size).toBe(tickets.length);
    expect(errors).toEqual([]);
  }, 25_000);

  it.skipIf(!control)('rejects disconnected writes, restores after native broker restart, and leaves no sockets or retries', async () => {
    const received: StreamMessage[] = [];
    await subscriber.streams.messages.use({ topic }).subscribe(message => { received.push(message); });
    const out = publisher.streams.messages.use({ topic });
    const first = await out.publish({ stage: 'before stop' });
    await until(async () => received, values => values.length === 1);
    await fixtureControl('/__fixture/broker/stop', 'POST');
    // A native graceful shutdown can close WSS without an error. The failed
    // refresh dial proves the SDK observed the disconnect and surfaced failure.
    await until(async () => errors, values => values.includes('STREAM_MESSAGE_CONNECT_FAILED'));
    const beforeWrite = tickets.length;
    await expect(out.publish({ stage: 'must never replay' })).rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_DISCONNECTED' });
    expect(tickets.length).toBe(beforeWrite);
    await fixtureControl('/__fixture/broker/start', 'POST');
    await until(() => fixtureControl('/__fixture/stats'), stats => stats.connections === 2 && stats.subscriptions === 1, 8_000);
    const after = await out.publish({ stage: 'after restart' });
    await until(async () => received, values => values.length === 2);
    await delay(200);
    expect(received).toEqual([first, after]);
    expect(tickets.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tickets.map(ticket => ticket.clientPublicKey)).size).toBe(tickets.length);
    await Promise.all([publisher.dispose(), subscriber.dispose()]);
    await until(() => fixtureControl('/__fixture/stats'), stats => stats.connections === 0 && stats.subscriptions === 0);
    const disposedStats = await fixtureControl('/__fixture/stats');
    await delay(1_100);
    const settledStats = await fixtureControl('/__fixture/stats');
    expect(settledStats.connections).toBe(0);
    expect(settledStats.subscriptions).toBe(0);
    expect(settledStats.issued.length).toBe(disposedStats.issued.length);
  }, 20_000);

  it.skipIf(!control)('has the real broker expire a non-refreshing JWT and reject that expired ticket on reconnect', async () => {
    // Independent auth probe: the SDK's own private keys remain inaccessible.
    const key = createUser();
    let nc: NatsConnection | undefined;
    let reconnected: NatsConnection | undefined;
    try {
      const ticket = await mintNativeTicket(key.getPublicKey());
      const options = {
        servers: [ticket.url], reconnect: false, ignoreClusterUpdates: true, timeout: 2_000,
        authenticator: jwtAuthenticator(ticket.userJwt, () => key.getSeed()),
      };
      nc = await wsconnect(options);
      await nc.flush();
      await until(async () => Date.now(), now => now > Date.parse(ticket.expiresAt) + 100, 12_000);
      await until(async () => nc!.isClosed(), closed => closed, 2_000);
      const expired = await nc.closed();
      expect(expired).toBeInstanceOf(Error);
      expect(expired!.message).toMatch(/expired/i);
      // NATS JWT validation uses Unix seconds and now > exp. A reconnect in
      // the expiry second can pass validation even after the expiry timer fired.
      await until(async () => Math.floor(Date.now() / 1_000),
        now => now > Math.floor(Date.parse(ticket.expiresAt) / 1_000), 2_000);
      let rejected = false;
      try { reconnected = await wsconnect(options); }
      catch { rejected = true; }
      // Avoid dumping the connection (including its fixture JWT) on failure.
      expect(rejected).toBe(true);
    } finally {
      await reconnected?.close();
      await nc?.close();
      key.clear();
    }
  }, 18_000);

  it('rejects forged identity in a real broker frame on the exact authorized subject', async () => {
    const received: StreamMessage[] = [];
    await subscriber.streams.messages.use({ topic }).subscribe(message => { received.push(message); });
    const key = createUser();
    let nc: NatsConnection | undefined;
    try {
      const ticket = await mintNativeTicket(key.getPublicKey());
      nc = await wsconnect({
        servers: [ticket.url], reconnect: false, ignoreClusterUpdates: true, timeout: 2_000,
        authenticator: jwtAuthenticator(ticket.userJwt, () => key.getSeed()),
      });
      const message = {
        version: 'stream-messages/v1', messageId: crypto.randomUUID(),
        payload: { principal: 'opaque business data' },
      };
      const subject = ticket.permissions[0].publishSubject;
      // NATS Core authorizes the physical subject, not the JSON body. The SDK
      // must still reject injected envelope identity fields in that delivery.
      nc.publish(subject, new TextEncoder().encode(JSON.stringify({ ...message, principal: 'forged-identity' })));
      await nc.flush();
      await until(async () => errors, values => values.includes('STREAM_MESSAGE_INVALID_ENVELOPE'));
      expect(received).toEqual([]);
      nc.publish(subject, new TextEncoder().encode(JSON.stringify(message)));
      await nc.flush();
      await until(async () => received, values => values.length === 1);
      expect(received).toEqual([message]);
      expect(Object.keys(received[0]).sort()).toEqual(['messageId', 'payload', 'version']);
    } finally {
      await nc?.close();
      key.clear();
    }
  }, 10_000);
});
