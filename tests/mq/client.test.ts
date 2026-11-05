import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tier0MQClient } from '../../src/mq/client.js';

// Mock mqtt module
vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(),
  },
}));

import mqtt from 'mqtt';

describe('Tier0MQClient', () => {
  let mockMqttClient: any;
  let eventHandlers: Record<string, Function[]>;
  let subscribeCallbacks: Array<{ topic: string; opts: any; cb: Function }>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 隔离外部环境变量，避免本机配置影响单元测试
    vi.stubEnv('TIER0_MQTT_HOST', undefined);
    vi.stubEnv('TIER0_MQTT_PORT', undefined);
    vi.stubEnv('TIER0_API_KEY', undefined);
    eventHandlers = {};
    subscribeCallbacks = [];

    mockMqttClient = {
      connected: false,
      subscribe: vi.fn((topic: string, opts: any, cb: Function) => {
        subscribeCallbacks.push({ topic, opts, cb });
        if (typeof cb === 'function') cb(null);
      }),
      publish: vi.fn(),
      unsubscribe: vi.fn((topic: string, cb: Function) => {
        if (typeof cb === 'function') cb(null);
      }),
      end: vi.fn((_force: boolean, cb?: Function) => {
        if (cb) cb();
      }),
      on: vi.fn((event: string, handler: Function) => {
        if (!eventHandlers[event]) {
          eventHandlers[event] = [];
        }
        eventHandlers[event].push(handler);
      }),
    };

    (mqtt.connect as any).mockReturnValue(mockMqttClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function emit(event: string, ...args: any[]) {
    const handlers = eventHandlers[event] || [];
    handlers.forEach((h) => h(...args));
  }

  it.each(['connected', 'connecting', 'reconnecting'] as const)(
    'rejects a credential change while %s without changing the original connection', async (state) => {
      const client = new Tier0MQClient({ host: 'broker', password: 'sk-per-ws1_a' });
      const pending = client.connect();
      if (state !== 'connecting') {
        emit('connect');
        await pending;
      }
      if (state === 'reconnecting') emit('close');
      await expect(client.connect({ password: 'sk-per-ws2_b' })).rejects.toThrow(/disconnect/i);
      expect(mqtt.connect).toHaveBeenCalledTimes(1);
      if (state === 'connecting') {
        emit('connect');
        await pending;
      }
      expect((mqtt.connect as any).mock.calls[0][1].password).toBe('sk-per-ws1_a');
    },
  );

  it('cancels an in-flight connection and ignores callbacks from its old socket', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'sk-per-ws1_a' });
    const pending = client.connect();
    const oldConnect = eventHandlers.connect[0];
    const oldClose = eventHandlers.close[0];
    client.disconnect();
    await expect(pending).rejects.toThrow(/cancelled/);
    (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
    const next = client.connect({ password: 'sk-per-ws2_b' });
    eventHandlers.connect[1]();
    await next;
    oldConnect();
    oldClose();
    expect(client.isConnected).toBe(true);
    expect((mqtt.connect as any).mock.calls[1][1].password).toBe('sk-per-ws2_b');
  });

  it('does not report a successful connection if a connect listener disconnects', async () => {
    const client = new Tier0MQClient({ host: 'broker' });
    client.on('connect', () => client.disconnect());
    const pending = client.connect();
    emit('connect');
    await expect(pending).rejects.toThrow(/connection changed/);
  });

  it.each([{ host: 'other' }, { username: 'other' }, { clientId: 'other' },
    { password: undefined }, { clean: false }])('rejects changed connection options %j', async (options) => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const pending = client.connect();
    emit('connect');
    await pending;
    await expect(client.connect(options)).rejects.toThrow();
    await expect(client.connect({ password: 'key-a' })).resolves.toBeUndefined();
    expect(mqtt.connect).toHaveBeenCalledTimes(1);
  });

  it('reads a changing credential getter only once', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const pending = client.connect();
    emit('connect');
    await pending;
    let reads = 0;
    await client.connect({ get password() { return ++reads === 1 ? 'key-a' : 'key-b'; } });
    expect(reads).toBe(1);
    expect((mqtt.connect as any).mock.calls[0][1].password).toBe('key-a');
  });

  it('can reconnect without losing subscriptions when automatic reconnect is disabled', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    const first = client.connect();
    emit('connect');
    await first;
    const handler = vi.fn();
    client.subscribe('topic', handler);
    eventHandlers.close[0]();
    expect(client.subscribedTopics).toEqual(['topic']);
    await expect(client.connect({ password: 'new-key' })).rejects.toThrow(/disconnect/i);
    const nextSocket = { ...mockMqttClient, subscribe: vi.fn((_topic, _opts, cb) => cb(null)) };
    (mqtt.connect as any).mockReturnValue(nextSocket);
    const next = client.connect();
    eventHandlers.connect[1]();
    await next;
    expect(nextSocket.subscribe).toHaveBeenCalledWith('topic', expect.any(Object), expect.any(Function));
    client.disconnect();
    expect(client.subscribedTopics).toEqual([]);
  });

  it('queues a subscription without an error while the existing socket reconnects', async () => {
    const client = new Tier0MQClient({ host: 'broker' });
    const errors = vi.fn();
    client.on('error', errors);
    const pending = client.connect();
    emit('connect');
    await pending;
    emit('close');
    client.subscribe('new-topic', vi.fn());
    await Promise.resolve();
    expect(errors).not.toHaveBeenCalled();
    emit('connect');
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith('new-topic', expect.any(Object), expect.any(Function));
  });

  it('can retry after the initial transport closes with auto reconnect disabled', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    const first = client.connect();
    emit('close');
    await expect(first).rejects.toThrow(/closed/);
    (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
    const retry = client.connect();
    eventHandlers.connect[1]();
    await expect(retry).resolves.toBeUndefined();
  });

  it('ignores a late subscription failure from a retired socket', async () => {
    const callbacks: Function[] = [];
    mockMqttClient.subscribe = vi.fn((_topic, _opts, cb) => callbacks.push(cb));
    const client = new Tier0MQClient({ host: 'broker' });
    const first = client.connect();
    emit('connect');
    await first;
    const handler = vi.fn();
    client.subscribe('topic', handler);
    client.disconnect();
    const nextSocket = { ...mockMqttClient, subscribe: vi.fn((_topic, _opts, cb) => cb(null)) };
    (mqtt.connect as any).mockReturnValue(nextSocket);
    const next = client.connect({ password: 'key-b' });
    eventHandlers.connect[1]();
    await next;
    client.subscribe('topic', handler);
    callbacks[0](new Error('late failure'));
    expect(client.subscribedTopics).toEqual(['topic']);
    eventHandlers.message[1]('topic', Buffer.from('hello'), {});
    expect(handler).toHaveBeenCalledWith('topic', 'hello');
  });

  it('does not move a subscription to another identity after connection creation fails', async () => {
    const client = new Tier0MQClient({ password: 'key-a' });
    client.subscribe('topic', vi.fn());
    await Promise.resolve();
    await expect(client.connect({ host: 'broker', password: 'key-b' })).rejects.toThrow(/disconnect/i);
    const pending = client.connect({ host: 'broker' });
    emit('connect');
    await pending;
    expect((mqtt.connect as any).mock.calls[0][1].password).toBe('key-a');
  });

  it('rolls back the failed subscription before invoking a reentrant error listener', async () => {
    const callbacks: Function[] = [];
    mockMqttClient.subscribe = vi.fn((_topic, _opts, cb) => callbacks.push(cb));
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const first = client.connect();
    emit('connect');
    await first;
    const handler = vi.fn();
    client.subscribe('topic', handler);
    let next: Promise<void> | undefined;
    client.on('error', () => {
      client.disconnect();
      (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
      next = client.connect({ password: 'key-b' });
      client.subscribe('topic', handler);
    });
    callbacks[0](new Error('failed'));
    eventHandlers.connect[1]();
    await next;
    expect(client.subscribedTopics).toEqual(['topic']);
    eventHandlers.message[1]('topic', Buffer.from('hello'), {});
    expect(handler).toHaveBeenCalledWith('topic', 'hello');
  });

  it('does not emit a retired lazy connection cancellation into a new connection', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const errors = vi.fn();
    client.on('error', errors);
    client.subscribe('topic', vi.fn());
    client.disconnect();
    (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
    const next = client.connect({ password: 'key-b' });
    await Promise.resolve();
    eventHandlers.connect[1]();
    await next;
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not publish across identities when payload serialization reconnects', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const first = client.connect();
    emit('connect');
    await first;
    const nextSocket = { ...mockMqttClient, publish: vi.fn() };
    let next: Promise<void> | undefined;
    const payload = { toJSON() {
      client.disconnect();
      (mqtt.connect as any).mockReturnValue(nextSocket);
      next = client.connect({ password: 'key-b' });
      eventHandlers.connect[1]();
      return { value: 1 };
    } };
    await expect(client.publish('topic', payload)).rejects.toThrow(/connection changed/i);
    await next;
    expect(nextSocket.publish).not.toHaveBeenCalled();
  });

  it('does not unsubscribe a new identity after a message handler reconnects', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a', maxBackpressuredDeliveries: 1 });
    const first = client.connect();
    emit('connect');
    await first;
    let next: Promise<void> | undefined;
    const nextSocket = { ...mockMqttClient, unsubscribe: vi.fn() };
    const handler = vi.fn(() => {
      client.disconnect();
      (mqtt.connect as any).mockReturnValue(nextSocket);
      next = client.connect({ password: 'key-b' });
      client.subscribe('topic', handler);
      return false;
    });
    client.subscribe('topic', handler);
    eventHandlers.message[0]('topic', Buffer.from('hello'), {});
    eventHandlers.connect[1]();
    await next;
    expect(client.subscribedTopics).toEqual(['topic']);
    expect(nextSocket.unsubscribe).not.toHaveBeenCalled();
  });

  it('reports a failed lazy connection when automatic reconnect is disabled', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    const errors = vi.fn();
    client.on('error', errors);
    client.subscribe('topic', vi.fn());
    emit('close');
    await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
    expect(errors.mock.calls[0][0].message).toMatch(/closed/);
  });

  it('ignores unsubscribe failure from a retired socket', async () => {
    let callback: Function = () => {};
    mockMqttClient.unsubscribe = vi.fn((_topic, cb) => { callback = cb; });
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const first = client.connect();
    emit('connect');
    await first;
    const errors = vi.fn();
    client.on('error', errors);
    client.unsubscribe('topic');
    client.disconnect();
    (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
    const next = client.connect({ password: 'key-b' });
    eventHandlers.connect[1]();
    await next;
    callback(new Error('late failure'));
    expect(errors).not.toHaveBeenCalled();
    expect(client.isConnected).toBe(true);
  });

  it('stops delivering an old connection event after a listener switches identity', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const first = client.connect();
    emit('connect');
    await first;
    let next: Promise<void> | undefined;
    client.on('error', () => {
      client.disconnect();
      (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
      next = client.connect({ password: 'key-b' });
    });
    const secondListener = vi.fn(() => client.disconnect());
    client.on('error', secondListener);
    eventHandlers.error[0](new Error('old connection'));
    eventHandlers.connect[1]();
    await next;
    expect(secondListener).not.toHaveBeenCalled();
    expect(client.isConnected).toBe(true);
  });

  it('reports one error for multiple subscriptions awaiting the same failed connection', async () => {
    const client = new Tier0MQClient({ host: 'broker' });
    const errors = vi.fn();
    client.on('error', errors);
    client.subscribe('one', vi.fn());
    client.subscribe('two', vi.fn());
    eventHandlers.error[0](new Error('socket failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveBeenCalledOnce();
  });

  it('can start a new lazy connection from the previous connection error listener', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    const errors = vi.fn(() => {
      if (errors.mock.calls.length === 1) {
        (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
        client.subscribe('second', vi.fn());
      }
    });
    client.on('error', errors);
    client.subscribe('first', vi.fn());
    eventHandlers.close[0]();
    await vi.waitFor(() => expect(mqtt.connect).toHaveBeenCalledTimes(2));
    eventHandlers.close[1]();
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
  });

  it('reports a new lazy connection failure when the listener explicitly reconnects first', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    let next: Promise<void> | undefined;
    const errors = vi.fn(() => {
      if (errors.mock.calls.length === 1) {
        (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
        next = client.connect();
        void next.catch(() => {});
        client.subscribe('second', vi.fn());
      }
    });
    client.on('error', errors);
    client.subscribe('first', vi.fn());
    eventHandlers.close[0]();
    await vi.waitFor(() => expect(mqtt.connect).toHaveBeenCalledTimes(2));
    eventHandlers.close[1]();
    await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(2));
    await expect(next).rejects.toThrow(/closed/);
  });

  it('permits a synchronous retry on error before the old socket closes', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    let next: Promise<void> | undefined;
    client.on('error', () => {
      (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
      next = client.connect();
    });
    client.subscribe('first', vi.fn());
    eventHandlers.error[0](new Error('connection refused'));
    eventHandlers.close[0]();
    expect(mqtt.connect).toHaveBeenCalledTimes(2);
    eventHandlers.connect[1]();
    await expect(next).resolves.toBeUndefined();
  });

  it('notifies a silent transport close once and retains subscriptions', async () => {
    const client = new Tier0MQClient({ host: 'broker', reconnectPeriod: 0 });
    const disconnected = vi.fn();
    client.on('disconnect', disconnected);
    const first = client.connect();
    emit('connect');
    await first;
    client.subscribe('topic', vi.fn());
    eventHandlers.close[0]();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(client.subscribedTopics).toEqual(['topic']);
    expect(client.isConnected).toBe(false);
  });

  it('does not repeat disconnect when protocol disconnect precedes close', async () => {
    const client = new Tier0MQClient({ host: 'broker' });
    const disconnected = vi.fn();
    client.on('disconnect', disconnected);
    const first = client.connect();
    emit('connect');
    await first;
    eventHandlers.disconnect[0]();
    eventHandlers.close[0]();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined, 'sk-per-ws1_test', '1'],
    ['sk-svc-ws2_old', 'sk-svc-ws10_test', '36'],
    ['sk-svc-ws2_old', 'sk-app-ws' + (9007199254740993n).toString(36) + '_test', '9007199254740993'],
    ['sk-svc-ws2_old', 'legacy-key', 'enterprise'],
  ])('derives identity from connect-time key %s -> %s', async (initial, password, workspace) => {
    const client = new Tier0MQClient({ host: 'broker', ...(initial === undefined ? {} : { password: initial }) });
    const connected = client.connect({ password });
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      password, username: workspace + '&open',
      clientId: expect.stringMatching(new RegExp('^' + workspace + '&[a-z0-9]{8}$')),
    }));
  });

  it('snapshots constructor credentials before deriving identity', async () => {
    let reads = 0;
    const client = new Tier0MQClient({ host: 'broker', get password() {
      return ++reads === 1 ? 'sk-per-ws1_a' : 'sk-per-ws2_b';
    } });
    const pending = client.connect();
    emit('connect');
    await pending;
    expect(reads).toBe(1);
    expect((mqtt.connect as any).mock.calls[0][1]).toEqual(expect.objectContaining({
      username: '1&open', password: 'sk-per-ws1_a',
    }));
  });

  it('does not fall back to an environment key for explicitly missing or empty credentials', async () => {
    vi.stubEnv('TIER0_API_KEY', 'sk-per-ws2_environment');
    expect(() => new Tier0MQClient({ host: 'broker', password: undefined })).toThrow(/explicitly undefined/);
    const client = new Tier0MQClient({ host: 'broker', password: '' });
    const pending = client.connect();
    emit('connect');
    await pending;
    expect((mqtt.connect as any).mock.calls[0][1]).toEqual(expect.objectContaining({
      username: 'enterprise&open', password: '',
    }));
  });

  it('preserves a non-enumerable explicit password instead of using the environment key', async () => {
    vi.stubEnv('TIER0_API_KEY', 'sk-per-ws2_environment');
    const config = { host: 'broker' };
    Object.defineProperty(config, 'password', { value: 'sk-per-ws1_a', enumerable: false });
    const client = new Tier0MQClient(config);
    const pending = client.connect();
    emit('connect');
    await pending;
    expect((mqtt.connect as any).mock.calls[0][1]).toEqual(expect.objectContaining({
      username: '1&open', password: 'sk-per-ws1_a',
    }));
  });

  it('stops delivering a previous identity message after a handler reconnects', async () => {
    const client = new Tier0MQClient({ host: 'broker', password: 'key-a' });
    const first = client.connect();
    emit('connect');
    await first;
    let next: Promise<void> | undefined;
    client.subscribe('topic', () => {
      client.disconnect();
      (mqtt.connect as any).mockReturnValue({ ...mockMqttClient });
      next = client.connect({ password: 'key-b' });
    });
    const oldHandler = vi.fn();
    client.subscribe('topic', oldHandler);
    eventHandlers.message[0]('topic', Buffer.from('hello'), {});
    eventHandlers.connect[1]();
    await next;
    expect(oldHandler).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'connect'] as const)(
    'preserves each explicit identity field supplied through %s', async (stage) => {
      for (const explicit of [{ username: 'custom-user' }, { clientId: 'custom-client' },
        { username: 'custom-user', clientId: 'custom-client' }]) {
        const client = new Tier0MQClient({ host: 'broker', ...(stage === 'constructor' ? explicit : {}) });
        const connected = client.connect({ password: 'sk-per-ws1_test', ...(stage === 'connect' ? explicit : {}) });
        emit('connect');
        await connected;
        expect(mqtt.connect).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
          username: explicit.username ?? '1&open',
          clientId: explicit.clientId ?? expect.stringMatching(/^1&[a-z0-9]{8}$/),
        }));
        await client.disconnect();
      }
    },
  );

  it('keeps explicit connect-time identity across a later disconnected key change', async () => {
    const client = new Tier0MQClient({ host: 'broker' });
    let connected = client.connect({ password: 'sk-per-ws1_test', username: 'custom-user' });
    emit('connect');
    await connected;
    await client.disconnect();
    connected = client.connect({ password: 'sk-per-ws2_test' });
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      password: 'sk-per-ws2_test', username: 'custom-user',
      clientId: expect.stringMatching(/^2&[a-z0-9]{8}$/),
    }));
  });

  it.each([
    ['broker:8083', undefined, 'ws://broker:8083/mqtt'],
    ['broker:8084', undefined, 'wss://broker:8084/mqtt'],
    ['broker:9001', undefined, 'ws://broker:9001/mqtt'],
    ['broker:8083', true, 'wss://broker:8083/mqtt'],
    ['broker:8084', false, 'ws://broker:8084/mqtt'],
  ] as const)('honors embedded host port %s with secure=%s', async (host, secure, url) => {
    const client = new Tier0MQClient({ host, secure });
    const connected = client.connect();
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenCalledWith(url, expect.any(Object));
  });

  it('honors the embedded port in TIER0_MQTT_HOST', async () => {
    vi.stubEnv('TIER0_MQTT_HOST', 'emqx:8083');
    const client = new Tier0MQClient();
    const connected = client.connect();
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenCalledWith('ws://emqx:8083/mqtt', expect.any(Object));
  });

  it.each(['tcp', 'mqtt', 'mqtts'])('discards TCP ports from explicit %s URLs', async (scheme) => {
    const client = new Tier0MQClient({ host: scheme + '://broker:1883', port: 8083 });
    const connected = client.connect();
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenCalledWith('ws://broker:8083/mqtt', expect.any(Object));
  });

  it('should throw error when URL is not provided on connect', async () => {
    const client = new Tier0MQClient();
    await expect(client.connect()).rejects.toThrow('MQTT host is required');
  });

  it('should throw error when URL is not provided on subscribe', async () => {
    const client = new Tier0MQClient();
    client.subscribe('test/topic', () => {});
    // subscribe 是同步的，错误通过 error 事件抛出
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('should connect with config URL', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const connectPromise = client.connect();

    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://localhost:8080/mqtt',
      expect.objectContaining({
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        clean: true,
      })
    );
  });

  it('should not duplicate protocol when MQTT host includes ws scheme', async () => {
    const client = new Tier0MQClient({ host: 'wss://mqtt.example.com/' });
    const connectPromise = client.connect();

    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'wss://mqtt.example.com/mqtt',
      expect.any(Object)
    );
  });

  it('should not reuse the TCP port from tcp:// broker URLs for wss', async () => {
    const client = new Tier0MQClient({
      host: 'tcp://mqtt.example.com:1883',
      secure: true,
    });
    const connectPromise = client.connect();

    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'wss://mqtt.example.com:8084/mqtt',
      expect.any(Object)
    );
  });

  it('should honor ws port embedded in ws(s):// host', async () => {
    const client = new Tier0MQClient({ host: 'wss://mqtt.example.com:9001' });
    const connectPromise = client.connect();

    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'wss://mqtt.example.com:9001/mqtt',
      expect.any(Object)
    );
  });

  it.each([
    { port: 8084, secure: undefined, scheme: 'wss' },
    { port: 8083, secure: undefined, scheme: 'ws' },
    { port: 8084, secure: false, scheme: 'ws' },
    { port: 9443, secure: true, scheme: 'wss' },
  ])('should select $scheme for port $port and secure=$secure', async ({ port, secure, scheme }) => {
    const client = new Tier0MQClient({ host: 'mqtt.example.com', port, secure });
    const connected = client.connect();
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenCalledWith(
      `${scheme}://mqtt.example.com:${port}/mqtt`, expect.any(Object),
    );
  });

  it('should preserve explicit ws URLs even when secure is true', async () => {
    const client = new Tier0MQClient({ host: 'ws://mqtt.example.com:8084/mqtt', secure: true });
    const connected = client.connect();
    emit('connect');
    await connected;
    expect(mqtt.connect).toHaveBeenCalledWith('ws://mqtt.example.com:8084/mqtt', expect.any(Object));
  });

  it('should preserve HTTPS browser transport on other ports', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    try {
      const client = new Tier0MQClient({ host: 'mqtt.example.com', port: 8083 });
      const connected = client.connect();
      emit('connect');
      await connected;
      expect(mqtt.connect).toHaveBeenCalledWith('wss://mqtt.example.com:8083/mqtt', expect.any(Object));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should connect with override config', async () => {
    const client = new Tier0MQClient();
    const connectPromise = client.connect({
      host: 'mqtt.example.com',
      port: 443,
      clientId: 'test-client',
      username: 'user',
      password: 'pass',
      reconnectPeriod: 1000,
      connectTimeout: 5000,
      clean: false,
    });

    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://mqtt.example.com:443/mqtt',
      expect.objectContaining({
        clientId: 'test-client',
        username: 'user',
        password: 'pass',
        reconnectPeriod: 1000,
        connectTimeout: 5000,
        clean: false,
      })
    );
  });

  it('should reject on connection error', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const connectPromise = client.connect();

    const error = new Error('Connection refused');
    emit('error', error);

    await expect(connectPromise).rejects.toThrow('Connection refused');
  });

  it('should use env variable for URL', async () => {
    const originalHost = process.env.TIER0_MQTT_HOST;
    const originalPort = process.env.TIER0_MQTT_PORT;
    process.env.TIER0_MQTT_HOST = 'env.example.com';
    process.env.TIER0_MQTT_PORT = '8080';

    const client = new Tier0MQClient();
    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://env.example.com:8080/mqtt',
      expect.any(Object)
    );

    process.env.TIER0_MQTT_HOST = originalHost;
    process.env.TIER0_MQTT_PORT = originalPort;
  });

  it('should use env variable for password', async () => {
    const originalKey = process.env.TIER0_API_KEY;
    process.env.TIER0_API_KEY = 'mqtt-password';

    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        password: 'mqtt-password',
      })
    );

    process.env.TIER0_API_KEY = originalKey;
  });

  it('should auto-connect on subscribe', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);

    // 等待懒连接完成
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://localhost:8080/mqtt',
      expect.any(Object)
    );
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
      'test/topic',
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
  });

  it('should subscribe with qos 1', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    client.subscribe('test/topic', () => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
      'test/topic',
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
    expect(client.subscribedTopics).toContain('test/topic');
  });

  it('should dispatch message to handler with (topic, payload)', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'test/topic', Buffer.from('hello'));

    expect(handler).toHaveBeenCalledWith('test/topic', 'hello');
  });

  it('should dispatch JSON payload as string', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('sensor/temp', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const jsonStr = JSON.stringify({ value: 25.5, unit: 'C' });
    emit('message', 'sensor/temp', Buffer.from(jsonStr));

    expect(handler).toHaveBeenCalledWith('sensor/temp', jsonStr);
  });

  it('should not dispatch to handler of different topic', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'other/topic', Buffer.from('hello'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support wildcard # subscription', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('home/room/#', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'home/room/temp', Buffer.from('25'));
    emit('message', 'home/room/living/light', Buffer.from('on'));

    expect(handler).toHaveBeenCalledWith('home/room/temp', '25');
    expect(handler).toHaveBeenCalledWith('home/room/living/light', 'on');
  });

  it('should support wildcard + subscription', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('home/+/temp', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'home/bedroom/temp', Buffer.from('22'));
    emit('message', 'home/living/temp', Buffer.from('25'));
    emit('message', 'home/bedroom/humidity', Buffer.from('60'));

    expect(handler).toHaveBeenCalledWith('home/bedroom/temp', '22');
    expect(handler).toHaveBeenCalledWith('home/living/temp', '25');
    expect(handler).not.toHaveBeenCalledWith('home/bedroom/humidity', '60');
  });

  it('should allow multiple handlers on same topic', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.subscribe('test/topic', handler1);
    client.subscribe('test/topic', handler2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'test/topic', Buffer.from('hello'));

    expect(handler1).toHaveBeenCalledWith('test/topic', 'hello');
    expect(handler2).toHaveBeenCalledWith('test/topic', 'hello');
  });

  it('should deduplicate same handler on same topic', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 同一 topic + handler 只 subscribe 一次
    const calls = mockMqttClient.subscribe.mock.calls.filter(
      (c: any[]) => c[0] === 'test/topic'
    );
    expect(calls.length).toBe(1);
  });

  it('should auto-connect on publish', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const publishPromise = client.publish('test/topic', 'hello');

    // publish 是 async 的，内部会触发连接
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await publishPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://localhost:8080/mqtt',
      expect.any(Object)
    );
    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      'hello',
      expect.objectContaining({ qos: 0, retain: false })
    );
  });

  it('should publish string message', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.publish('test/topic', 'hello world');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      'hello world',
      expect.objectContaining({ qos: 0, retain: false })
    );
  });

  it('should publish object message as JSON', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const payload = { temp: 25, unit: 'C' };
    client.publish('test/topic', payload);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      JSON.stringify(payload),
      expect.any(Object)
    );
  });

  it('should publish with custom qos and retain', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.publish('test/topic', 'hello', { qos: 2, retain: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      'hello',
      expect.objectContaining({ qos: 2, retain: true })
    );
  });

  it('should unsubscribe specific handler from topic', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.subscribe('test/topic', handler1);
    client.subscribe('test/topic', handler2);
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.unsubscribe('test/topic', handler1);

    emit('message', 'test/topic', Buffer.from('hello'));
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith('test/topic', 'hello');
  });

  it('should unsubscribe all handlers from topic', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.subscribe('test/topic', handler1);
    client.subscribe('test/topic', handler2);
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.unsubscribe('test/topic');

    expect(mockMqttClient.unsubscribe).toHaveBeenCalledWith(
      'test/topic',
      expect.any(Function)
    );
    expect(client.subscribedTopics).not.toContain('test/topic');
  });

  it('should not send broker unsubscribe if other handlers remain', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.subscribe('test/topic', handler1);
    client.subscribe('test/topic', handler2);
    await new Promise((resolve) => setTimeout(resolve, 10));

    mockMqttClient.unsubscribe.mockClear();
    client.unsubscribe('test/topic', handler1);

    expect(mockMqttClient.unsubscribe).not.toHaveBeenCalled();
  });

  it('should disconnect and clear state', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.subscribe('test/topic', () => {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.disconnect();

    expect(mockMqttClient.end).toHaveBeenCalledWith(true, expect.any(Function));
    expect(client.subscribedTopics).toHaveLength(0);
    expect(client.isConnected).toBe(false);
  });

  it('should handle connect event', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const handler = vi.fn();
    client.on('connect', handler);

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(handler).toHaveBeenCalled();
  });

  it('should handle disconnect event', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const handler = vi.fn();
    client.on('disconnect', handler);

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.disconnect();
    expect(handler).toHaveBeenCalled();
  });

  it('should handle error event', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const handler = vi.fn();
    client.on('error', handler);

    const connectPromise = client.connect();
    const error = new Error('test error');
    emit('error', error);

    await expect(connectPromise).rejects.toThrow('test error');
    expect(handler).toHaveBeenCalledWith(error);
  });

  it('should remove event listener with off', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    const handler = vi.fn();
    client.on('connect', handler);
    client.off('connect', handler);

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(handler).not.toHaveBeenCalled();
  });

  it('should report isConnected correctly', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });
    expect(client.isConnected).toBe(false);

    const connectPromise = client.connect();
    mockMqttClient.connected = true;
    emit('connect');
    await connectPromise;

    expect(client.isConnected).toBe(true);
  });

  it('should resubscribe all topics on reconnect', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    // 首次连接并订阅
    const connectPromise1 = client.connect();
    emit('connect');
    await connectPromise1;
    await new Promise((resolve) => setTimeout(resolve, 10));

    client.subscribe('topic/a', () => {});
    client.subscribe('topic/b', () => {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    mockMqttClient.subscribe.mockClear();

    // 模拟断连后重新连接（再次 emit connect）
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockMqttClient.subscribe).toHaveBeenCalledTimes(2);
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
      'topic/a',
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
      'topic/b',
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
  });

  it('should resubscribe only unique topics on reconnect', async () => {
    const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.subscribe('same/topic', handler1);
    client.subscribe('same/topic', handler2);
    await new Promise((resolve) => setTimeout(resolve, 10));

    mockMqttClient.subscribe.mockClear();

    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 同一 topic 有两个 handler，但只向 broker 订阅一次
    expect(mockMqttClient.subscribe).toHaveBeenCalledTimes(1);
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
      'same/topic',
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
  });

  it('should use env host for lazy connect', async () => {
    const originalHost = process.env.TIER0_MQTT_HOST;
    const originalPort = process.env.TIER0_MQTT_PORT;
    process.env.TIER0_MQTT_HOST = 'lazy.example.com';
    process.env.TIER0_MQTT_PORT = '8084';

    const client = new Tier0MQClient();

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mqtt.connect).toHaveBeenCalledWith(
      'wss://lazy.example.com:8084/mqtt',
      expect.any(Object)
    );

    process.env.TIER0_MQTT_HOST = originalHost;
    process.env.TIER0_MQTT_PORT = originalPort;
  });

  it('should use env API_KEY for lazy connect password', async () => {
    const originalKey = process.env.TIER0_API_KEY;
    const originalHost = process.env.TIER0_MQTT_HOST;
    const originalPort = process.env.TIER0_MQTT_PORT;
    process.env.TIER0_API_KEY = 'lazy-key';
    process.env.TIER0_MQTT_HOST = 'lazy.example.com';
    process.env.TIER0_MQTT_PORT = '8084';

    const client = new Tier0MQClient();

    client.subscribe('test/topic', () => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mqtt.connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        password: 'lazy-key',
      })
    );

    process.env.TIER0_API_KEY = originalKey;
    process.env.TIER0_MQTT_HOST = originalHost;
    process.env.TIER0_MQTT_PORT = originalPort;
  });

  describe('workspace ID parsing from API key', () => {
    it.each(['svc', 'per', 'agent', 'app'])('should derive MQTT identity for %s keys over WSS', async (keyType) => {
      const apiKey = `sk-${keyType}-ws1_test_secret-with-separators`;
      const client = new Tier0MQClient({
        host: 'wss://mqtt.example.com:8084/mqtt', password: apiKey,
      });
      const connected = client.connect();
      emit('connect');
      await connected;
      expect(mqtt.connect).toHaveBeenCalledWith(
        'wss://mqtt.example.com:8084/mqtt',
        expect.objectContaining({ username: '1&open', clientId: expect.stringMatching(/^1&[a-z0-9]+$/), password: apiKey }),
      );
    });

    it.each(['9007199254740993', '9223372036854775807'])('should preserve workspace ID %s exactly', async (workspaceID) => {
      const client = new Tier0MQClient({ host: 'localhost', password: `sk-per-ws${BigInt(workspaceID).toString(36)}_test` });
      const connected = client.connect();
      emit('connect');
      await connected;
      expect(mqtt.connect).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ username: `${workspaceID}&open` }));
    });

    it.each(['sk-per-ws0_test', 'sk-per-ws1!_test', 'sk-per-ws1_', 'sk-per-ws_test', `sk-per-ws${(9223372036854775808n).toString(36)}_test`, 't0_legacy'])('should preserve legacy fallback for invalid or unencoded workspace keys (%s)', async (apiKey) => {
      const client = new Tier0MQClient({ host: 'localhost', password: apiKey });
      const connected = client.connect();
      emit('connect');
      await connected;
      expect(mqtt.connect).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ username: 'enterprise&open', password: apiKey }));
    });

    it('should parse workspaceID when secret contains no dash', async () => {
      // workspaceID 12345 in base36 is '9ix'
      const apiKey = 'sk-svc-ws9ix_secretWithoutDash';
      const client = new Tier0MQClient({ host: 'localhost', port: 8080, password: apiKey });
      const connectPromise = client.connect();
      emit('connect');
      await connectPromise;

      expect(mqtt.connect).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          username: '12345&open',
          password: apiKey,
        })
      );
    });

    it('should parse workspaceID when secret contains dash', async () => {
      // workspaceID 12345 in base36 is '9ix'
      const apiKey = 'sk-svc-ws9ix_secret-with-dash';
      const client = new Tier0MQClient({ host: 'localhost', port: 8080, password: apiKey });
      const connectPromise = client.connect();
      emit('connect');
      await connectPromise;

      expect(mqtt.connect).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          username: '12345&open',
          password: apiKey,
        })
      );
    });

    it('should parse workspaceID when secret contains underscore', async () => {
      // workspaceID 12345 in base36 is '9ix'
      const apiKey = 'sk-svc-ws9ix_secret_with_underscore';
      const client = new Tier0MQClient({ host: 'localhost', port: 8080, password: apiKey });
      const connectPromise = client.connect();
      emit('connect');
      await connectPromise;

      expect(mqtt.connect).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          username: '12345&open',
          password: apiKey,
        })
      );
    });

    it('should fall back to enterprise credentials for invalid key format', async () => {
      const apiKey = 'not-a-valid-key';
      const client = new Tier0MQClient({ host: 'localhost', port: 8080, password: apiKey });
      const connectPromise = client.connect();
      emit('connect');
      await connectPromise;

      expect(mqtt.connect).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          username: 'enterprise&open',
          password: apiKey,
        })
      );
    });
  });

  describe('backpressure protection (maxBackpressuredDeliveries)', () => {
    async function connectAndSubscribe(
      client: Tier0MQClient,
      topic: string,
      handler: Function
    ) {
      client.subscribe(topic, handler as any);
      await new Promise((resolve) => setTimeout(resolve, 10));
      emit('connect');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    it('should auto-unsubscribe after N consecutive backpressured deliveries', async () => {
      const client = new Tier0MQClient({
        host: 'localhost',
        port: 8080,
        maxBackpressuredDeliveries: 3,
      });

      const handler = vi.fn(() => false);
      const droppedHandler = vi.fn();
      client.on('subscriptionDropped', droppedHandler);
      await connectAndSubscribe(client, 'test/topic', handler);

      emit('message', 'test/topic', Buffer.from('m1'));
      emit('message', 'test/topic', Buffer.from('m2'));
      expect(client.subscribedTopics).toContain('test/topic');
      expect(droppedHandler).not.toHaveBeenCalled();

      emit('message', 'test/topic', Buffer.from('m3'));

      // 达到阈值：移除订阅、向 broker 退订并发出事件
      expect(client.subscribedTopics).not.toContain('test/topic');
      expect(mockMqttClient.unsubscribe).toHaveBeenCalledWith(
        'test/topic',
        expect.any(Function)
      );
      expect(droppedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'test/topic' })
      );

      // 后续消息不再投递
      handler.mockClear();
      emit('message', 'test/topic', Buffer.from('m4'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('should keep subscription when protection is disabled (default)', async () => {
      const client = new Tier0MQClient({ host: 'localhost', port: 8080 });

      const handler = vi.fn(() => false);
      await connectAndSubscribe(client, 'test/topic', handler);

      for (let i = 0; i < 10; i += 1) {
        emit('message', 'test/topic', Buffer.from(`m${i}`));
      }

      expect(client.subscribedTopics).toContain('test/topic');
      expect(handler).toHaveBeenCalledTimes(10);
      expect(mockMqttClient.unsubscribe).not.toHaveBeenCalled();
    });

    it('should reset the counter when the handler accepts a message again', async () => {
      const client = new Tier0MQClient({
        host: 'localhost',
        port: 8080,
        maxBackpressuredDeliveries: 2,
      });

      let accept = false;
      const handler = vi.fn(() => accept);
      await connectAndSubscribe(client, 'test/topic', handler);

      emit('message', 'test/topic', Buffer.from('m1')); // false -> count 1
      accept = true;
      emit('message', 'test/topic', Buffer.from('m2')); // true -> reset
      accept = false;
      emit('message', 'test/topic', Buffer.from('m3')); // false -> count 1

      // 未连续达到阈值，订阅保留
      expect(client.subscribedTopics).toContain('test/topic');
      expect(mockMqttClient.unsubscribe).not.toHaveBeenCalled();

      emit('message', 'test/topic', Buffer.from('m4')); // false -> count 2，触发退订
      expect(client.subscribedTopics).not.toContain('test/topic');
    });

    it('should treat void-returning handlers as accepted (backward compatible)', async () => {
      const client = new Tier0MQClient({
        host: 'localhost',
        port: 8080,
        maxBackpressuredDeliveries: 1,
      });

      const handler = vi.fn(() => undefined);
      await connectAndSubscribe(client, 'test/topic', handler);

      emit('message', 'test/topic', Buffer.from('m1'));
      emit('message', 'test/topic', Buffer.from('m2'));

      expect(client.subscribedTopics).toContain('test/topic');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should treat async and non-boolean shorthand handlers as accepted', async () => {
      const client = new Tier0MQClient({
        host: 'localhost',
        port: 8080,
        maxBackpressuredDeliveries: 1,
      });

      const queue: string[] = [];
      // 既有写法：async handler 与 push() 简写（返回 Promise/number），
      // 运行时均不视为背压
      const asyncHandler = vi.fn(async () => {});
      const pushHandler = vi.fn((_t: string, p: string) => queue.push(p));
      client.subscribe('test/async', asyncHandler as any);
      client.subscribe('test/push', pushHandler as any);
      await new Promise((resolve) => setTimeout(resolve, 10));
      emit('connect');
      await new Promise((resolve) => setTimeout(resolve, 10));

      emit('message', 'test/async', Buffer.from('m1'));
      emit('message', 'test/push', Buffer.from('m2'));
      emit('message', 'test/push', Buffer.from('m3'));

      expect(client.subscribedTopics).toContain('test/async');
      expect(client.subscribedTopics).toContain('test/push');
      expect(asyncHandler).toHaveBeenCalledTimes(1);
      expect(queue).toEqual(['m2', 'm3']);
      expect(mockMqttClient.unsubscribe).not.toHaveBeenCalled();
    });
  });
});
