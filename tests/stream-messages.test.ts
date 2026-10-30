import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, fromPublic } from '@nats-io/nkeys';
import { jwtAuthenticator, wsconnect } from '@nats-io/nats-core';
import { createClient } from '../src/client.js';
import { installAppRuntime } from '../src/runtime.js';

vi.mock('@nats-io/nats-core', async importOriginal => ({
  ...await importOriginal<typeof import('@nats-io/nats-core')>(), wsconnect: vi.fn(),
}));

const id = '62fcfca2-4103-4fbf-989d-c26a913869ba';
const topic = 'chat/room-1';
const subject = 'appmsg.v1.w7.tY2hhdC9yb29tLTE.p.dXNlcjox';
const incoming = { version: 'stream-messages/v1', messageId: id, payload: { hello: 'world' } };
const tick = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const clients: ReturnType<typeof createClient>[] = [];
let uninstall: (() => void) | undefined;

function connection() {
  let callback: (error: Error | null, msg: { data: Uint8Array; subject: string }) => void;
  let end!: () => void;
  let push!: (status: unknown) => void;
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let stopped = false;
  const closed = new Promise<void>(resolve => { end = resolve; });
  const subscription = { unsubscribe: vi.fn() };
  const nc = {
    publish: vi.fn(), flush: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn(() => stopped), closed: () => closed,
    close: vi.fn(async () => { stopped = true; wake?.(); end(); }),
    subscribe: vi.fn((_subject: string, options: { callback: typeof callback }) => { callback = options.callback; return subscription; }),
    status: async function* () {
      while (!stopped) {
        if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
        while (queue.length) yield queue.shift();
      }
    },
  };
  push = value => { queue.push(value); wake?.(); };
  return {
    nc, subscription, push,
    deliver: (value: unknown, physical = subject) => callback(null, { data: new TextEncoder().encode(JSON.stringify(value)), subject: physical }),
    raw: (data: Uint8Array) => callback(null, { data, subject }),
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const connections: ReturnType<typeof connection>[] = [];
  vi.mocked(wsconnect).mockImplementation(async () => {
    const item = connection(); connections.push(item); return item.nc as never;
  });
  const request = vi.fn(async (_path: string, body: unknown) => {
    const b = body as { topics: { publish: boolean }[] };
    return Response.json({
      contractVersion: 'stream-messages/v1', url: 'wss://broker.example/ws', userJwt: 'fixture-user-jwt',
      expiresAt: new Date(Date.now() + 60_000).toISOString(), maxPayloadBytes: 60 * 1024,
      permissions: [{ topic, ...(b.topics[0].publish ? { publishSubject: subject } : { subscribeSubject: subject.replace(/[^.]+$/, '*') }) }],
      ...overrides,
    });
  });
  uninstall = installAppRuntime({ appId: '8a5b05e5-13a0-4985-b23d-6a1e1e87ba70', request });
  const client = createClient(); clients.push(client);
  return { client, request, connections, handle: client.streams.messages.use({ topic }) };
}

beforeEach(() => { vi.useFakeTimers(); vi.mocked(wsconnect).mockReset(); });
afterEach(async () => {
  for (const client of clients.splice(0)) await client.dispose();
  uninstall?.(); uninstall = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('Stream messages trusted runtime and NATS Core lifecycle', () => {
  it('automatically bootstraps a browser App with a public user nkey only', async () => {
    vi.stubGlobal('window', {});
    const { handle, request, connections } = setup();
    const result = await handle.publish({ hello: 'world' }, { messageId: id, correlationId: 'intent-1' });
    expect(request).toHaveBeenCalledOnce();
    const [path, body] = request.mock.calls[0];
    expect(path).toBe('/openapi/v2/stream-messages/connect');
    expect(body).toEqual({ appId: expect.any(String), topics: [{ topic, publish: true, subscribe: false }], clientPublicKey: expect.stringMatching(/^U[A-Z2-7]{55}$/) });
    expect(JSON.stringify(body)).not.toMatch(/seed|private|apiKey|subject/i);
    const options = vi.mocked(wsconnect).mock.calls[0][0]!;
    expect(options).toMatchObject({ servers: ['wss://broker.example/ws'], reconnect: false, ignoreClusterUpdates: true });
    const auth = (options.authenticator as ReturnType<typeof jwtAuthenticator>)('nonce') as { jwt: string; sig: string; nkey?: string };
    expect(auth.jwt).toBe('fixture-user-jwt');
    const publicKey = fromPublic((body as { clientPublicKey: string }).clientPublicKey);
    const signature = Uint8Array.from(atob(auth.sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    expect(publicKey.verify(new TextEncoder().encode('nonce'), signature)).toBe(true);
    publicKey.clear();
    expect(result).toEqual({ ...incoming, correlationId: 'intent-1' });
    expect(connections[0].nc.publish).toHaveBeenCalledExactlyOnceWith(subject, new TextEncoder().encode(JSON.stringify(result)));
  });

  it('generates UUIDs and never treats payload identity as authoritative envelope metadata', async () => {
    const { handle, connections } = setup();
    const value = await handle.publish({ userId: 'business data' });
    expect(value.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(value).sort()).toEqual(['messageId', 'payload', 'version']);
    expect(connections[0].nc.publish).toHaveBeenCalledOnce();
  });

  it('subscribes, validates incoming envelopes and disposes without delivery or timer leaks', async () => {
    const { handle, connections } = setup();
    const onError = vi.fn(); const handler = vi.fn();
    const sub = await handle.subscribe(handler, { onError });
    connections[0].deliver(incoming);
    expect(handler).toHaveBeenCalledExactlyOnceWith(incoming);
    connections[0].deliver({ ...incoming, principal: 'spoofed' });
    connections[0].deliver({ ...incoming, version: 'v0' });
    connections[0].deliver(incoming, 'other.topic');
    connections[0].raw(new Uint8Array([255]));
    connections[0].raw(new Uint8Array(64 * 1024 + 1));
    expect(onError).toHaveBeenCalledTimes(5);
    await sub.dispose(); await sub.dispose();
    connections[0].deliver(incoming);
    expect(handler).toHaveBeenCalledOnce();
    expect(sub.disposed).toBe(true);
    expect(connections[0].subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rotates the key and JWT after closure, wipes the prior key, and restores subscriptions without replay', async () => {
    const { client, handle, request, connections } = setup();
    const handler = vi.fn(); const errors = vi.fn(); client.streams.messages.onError(errors);
    await handle.subscribe(handler);
    const oldAuthenticator = vi.mocked(wsconnect).mock.calls[0][0]!.authenticator as ReturnType<typeof jwtAuthenticator>;
    expect(() => oldAuthenticator('nonce')).not.toThrow();
    await connections[0].nc.close(); await tick();
    expect(() => oldAuthenticator('nonce')).toThrow();
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledTimes(2);
    expect((request.mock.calls[0][1] as { clientPublicKey: string }).clientPublicKey).not.toBe((request.mock.calls[1][1] as { clientPublicKey: string }).clientPublicKey);
    expect(connections[0].nc.isClosed()).toBe(true);
    const currentAuthenticator = vi.mocked(wsconnect).mock.calls[1][0]!.authenticator as ReturnType<typeof jwtAuthenticator>;
    expect(() => currentAuthenticator('nonce')).not.toThrow();
    expect(connections[1].nc.subscribe).toHaveBeenCalledOnce();
    connections[1].deliver(incoming);
    expect(handler).toHaveBeenCalledOnce();
    expect(connections[1].nc.publish).not.toHaveBeenCalled();
  });

  it('fails disconnected writes immediately, without buffering, rebootstrap or replay', async () => {
    const { handle, request, connections } = setup();
    await handle.publish(null);
    await connections[0].nc.close(); await tick();
    await expect(handle.publish({ write: 1 })).rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_DISCONNECTED' });
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(connections[1].nc.publish).not.toHaveBeenCalled();
    await handle.publish({ write: 2 });
    expect(connections[1].nc.publish).toHaveBeenCalledOnce();
  });

  it('rotates credentials before expiry and surfaces asynchronous broker failures', async () => {
    const { client, handle, request, connections } = setup(); const onError = vi.fn();
    const remove = client.streams.messages.onError(onError);
    await handle.publish(null);
    connections[0].push({ type: 'error', error: new Error('secret broker detail') }); await tick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STREAM_MESSAGE_BROKER_ERROR' }));
    expect(onError.mock.calls[0][0].message).not.toContain('secret');
    await vi.advanceTimersByTimeAsync(55_500);
    expect(request).toHaveBeenCalledTimes(2);
    remove();
  });

  it('reports flush failures as unknown and never retries the publish', async () => {
    const { handle, connections } = setup(); await handle.publish(null);
    connections[0].nc.flush.mockRejectedValueOnce(new Error('failure'));
    await expect(handle.publish({ write: 1 })).rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_RESULT_UNKNOWN', retryable: false });
    expect(connections[0].nc.publish).toHaveBeenCalledTimes(2);
  });

  it.each(['issuer', 'dial', 'flush'])('recovers the same publisher handle after initial %s failure without replay', async stage => {
    const { client, handle, request, connections } = setup();
    client.streams.messages.onError(vi.fn());
    if (stage === 'issuer') request.mockRejectedValueOnce(new Error('issuer unavailable'));
    if (stage === 'dial') vi.mocked(wsconnect).mockRejectedValueOnce(new Error('dial unavailable'));
    if (stage === 'flush') vi.mocked(wsconnect).mockImplementationOnce(async () => {
      const item = connection();
      item.nc.flush.mockRejectedValueOnce(new Error('initial flush unavailable'));
      connections.push(item);
      return item.nc as never;
    });
    await expect(handle.publish({ intent: 'failed' })).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledOnce();
    expect(connections.every(item => item.nc.isClosed())).toBe(true);
    const recovered = await handle.publish({ intent: 'new-explicit-operation' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(connections.flatMap(item => item.nc.publish.mock.calls)).toEqual([
      [subject, new TextEncoder().encode(JSON.stringify(recovered))],
    ]);
    expect((request.mock.calls[0][1] as { clientPublicKey: string }).clientPublicKey)
      .not.toBe((request.mock.calls[1][1] as { clientPublicKey: string }).clientPublicKey);
    await client.dispose();
    await expect(handle.publish({ intent: 'after-disposal' })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('bounds an initial subscription flush that never receives PONG and closes its connection', async () => {
    const { client, handle, connections } = setup();
    vi.mocked(wsconnect).mockImplementationOnce(async () => {
      const item = connection();
      item.nc.flush.mockImplementation(() => new Promise<void>(() => {}));
      connections.push(item);
      return item.nc as never;
    });
    const pending = handle.subscribe(vi.fn()).catch(error => error);
    await tick();
    expect(connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ errorCode: 'STREAM_MESSAGE_CONNECT_FAILED' });
    expect(connections[0].nc.isClosed()).toBe(true);
    const auth = vi.mocked(wsconnect).mock.calls[0][0]!.authenticator as ReturnType<typeof jwtAuthenticator>;
    expect(() => auth('nonce')).toThrow();
    await client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a published message flush as unknown, closes the socket and never replays its payload', async () => {
    const { client, handle, request, connections } = setup();
    client.streams.messages.onError(vi.fn());
    await handle.publish({ intent: 'before-blackhole' });
    connections[0].nc.flush.mockImplementationOnce(() => new Promise<void>(() => {}));
    const pending = handle.publish({ intent: 'unknown' }).catch(error => error);
    await tick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ errorCode: 'STREAM_MESSAGE_RESULT_UNKNOWN', retryable: false });
    expect(connections[0].nc.isClosed()).toBe(true);
    expect(connections[0].nc.publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledTimes(2);
    expect(connections[1].nc.publish).not.toHaveBeenCalled();
    const next = await handle.publish({ intent: 'after-reconnect' });
    expect(connections[1].nc.publish).toHaveBeenCalledExactlyOnceWith(subject, new TextEncoder().encode(JSON.stringify(next)));
  });

  it('rejects late subscriber frames after ticket expiry even before a delayed close timer runs', async () => {
    const expiresAt = Date.now() + 1_000;
    const { handle, connections } = setup({ expiresAt: new Date(expiresAt).toISOString() });
    const handler = vi.fn();
    await handle.subscribe(handler);
    vi.setSystemTime(expiresAt + 1);
    connections[0].deliver(incoming);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['bootstrap', 'dispose'], ['bootstrap', 'expiry'], ['publish', 'dispose'], ['publish', 'expiry'],
  ])('settles a blackholed %s flush on %s without retaining a socket or timer', async (phase, stop) => {
    const { client, handle, connections } = setup({ expiresAt: new Date(Date.now() + 1_000).toISOString() });
    client.streams.messages.onError(vi.fn());
    if (phase === 'publish') {
      await handle.publish({ intent: 'established' });
      connections[0].nc.flush.mockImplementationOnce(() => new Promise<void>(() => {}));
    } else vi.mocked(wsconnect).mockImplementationOnce(async () => {
      const item = connection();
      item.nc.flush.mockImplementation(() => new Promise<void>(() => {}));
      connections.push(item);
      return item.nc as never;
    });
    const pending = handle.publish({ intent: 'pending' }).catch(error => error);
    await tick();
    expect(connections).toHaveLength(1);
    if (stop === 'dispose') await client.dispose();
    else await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;
    expect(error).toMatchObject({ errorCode: phase === 'publish' ? 'STREAM_MESSAGE_RESULT_UNKNOWN' :
      stop === 'dispose' ? 'STREAM_MESSAGE_DISPOSED' : 'STREAM_MESSAGE_CONNECT_FAILED' });
    expect(connections[0].nc.isClosed()).toBe(true);
    expect(connections[0].nc.publish).toHaveBeenCalledTimes(phase === 'publish' ? 2 : 0);
    await client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces handler rejection without an unhandled promise rejection', async () => {
    const { handle, connections } = setup(); const onError = vi.fn();
    await handle.subscribe(async () => { throw new Error('handler error'); }, { onError });
    connections[0].deliver(incoming); await tick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STREAM_MESSAGE_HANDLER_FAILED' }));
  });

  it.each([
    { url: 'ws://broker.example' }, { url: 'wss://user:secret@broker.example' }, { url: 'wss://broker.example?token=secret' },
    { contractVersion: 'v0' }, { expiresAt: 123 }, { expiresAt: '2020-01-01T00:00:00Z' },
    { maxPayloadBytes: 60 * 1024 + 1 }, { permissions: [{ topic: 'wrong', publishSubject: subject }] },
    { permissions: [{ topic, publishSubject: '>' }] },
  ])('rejects unsafe or incompatible connection tickets %j', async overrides => {
    const { handle } = setup(overrides);
    await expect(handle.publish(null)).rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_CONNECT_PROTOCOL_ERROR' });
    expect(wsconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects oversized payloads, invalid metadata and unsupported options before connecting', async () => {
    const { handle, request } = setup();
    for (const [payload, options] of [
      ['x'.repeat(60 * 1024), {}], [NaN, {}], [undefined, {}], [null, { messageId: 'invalid' }],
      [null, { correlationId: 'x'.repeat(129) }], [null, { correlationId: '\n' }],
      [null, { principal: 'forged' }],
    ] as const) await expect(handle.publish(payload as never, options as never)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('disposes clients, subscriptions, listeners and pending reconnects', async () => {
    const { client, handle, connections } = setup();
    await handle.subscribe(vi.fn()); await handle.publish(null);
    await connections[0].nc.close(); await tick();
    await client.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await expect(handle.publish(null)).rejects.toThrow();
    await expect(handle.subscribe(vi.fn())).rejects.toThrow();
  });

  it('uses separate in-memory keys per connection scope', async () => {
    const { handle, request } = setup();
    await handle.publish(null); await handle.subscribe(vi.fn());
    expect((request.mock.calls[0][1] as { clientPublicKey: string }).clientPublicKey).not.toBe((request.mock.calls[1][1] as { clientPublicKey: string }).clientPublicKey);
    const key = createUser(); key.clear();
  });

  it('treats returned subjects as opaque and never derives a broker namespace', async () => {
    const { handle, connections } = setup({ permissions: [{ topic, publishSubject: 'opaque.authorized.destination' }] });
    await handle.publish(null);
    expect(connections[0].nc.publish.mock.calls[0][0]).toBe('opaque.authorized.destination');
  });

  it('accepts the exact UTF-8 payload boundary and rejects one byte over it', async () => {
    const { handle, connections } = setup();
    await handle.publish('x'.repeat(60 * 1024 - 2));
    await expect(handle.publish('x'.repeat(60 * 1024 - 1))).rejects.toThrow();
    expect(connections[0].nc.publish).toHaveBeenCalledOnce();
  });

  it('retries only connection refresh after a transient failure and remains disposable', async () => {
    const { client, handle, request, connections } = setup();
    const errors = vi.fn(); client.streams.messages.onError(errors);
    await handle.subscribe(vi.fn());
    request.mockRejectedValueOnce(new Error('issuer unavailable'));
    await connections[0].nc.close(); await tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STREAM_MESSAGE_CONNECT_FAILED' }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(new Set(request.mock.calls.map(([, body]) => (body as { clientPublicKey: string }).clientPublicKey)).size).toBe(3);
    expect(connections[1].nc.subscribe).toHaveBeenCalledOnce();
    await client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an in-flight issuer bridge and shares concurrent disposal completion', async () => {
    const { client, handle, request } = setup();
    request.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const pending = handle.subscribe(vi.fn()).catch(error => error);
    const first = client.dispose(); const second = client.dispose();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(await pending).toMatchObject({ errorCode: 'STREAM_MESSAGE_DISPOSED' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a synchronous handler throw as a handler failure', async () => {
    const { handle, connections } = setup(); const onError = vi.fn();
    await handle.subscribe(() => { throw new Error('failure'); }, { onError });
    connections[0].deliver(incoming);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STREAM_MESSAGE_HANDLER_FAILED' }));
  });

  it('rejects a publish when the broker reports an asynchronous error before flush completes', async () => {
    const { client, handle, connections } = setup(); client.streams.messages.onError(vi.fn());
    await handle.publish(null);
    connections[0].nc.flush.mockImplementationOnce(async () => {
      connections[0].push({ type: 'error', error: new Error('permission denied') });
      await tick();
    });
    await expect(handle.publish(null)).rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_BROKER_ERROR' });
    expect(connections[0].nc.publish).toHaveBeenCalledTimes(2);
  });

  it('automatically tears down connections when the trusted App runtime unmounts', async () => {
    const { handle, connections } = setup();
    const sub = await handle.subscribe(vi.fn());
    await handle.publish(null);
    uninstall!(); await tick();
    expect(sub.disposed).toBe(true);
    expect(connections.every(item => item.nc.isClosed())).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await expect(handle.publish(null)).rejects.toMatchObject({ errorCode: 'STREAM_MESSAGE_DISCONNECTED' });
  });
});
