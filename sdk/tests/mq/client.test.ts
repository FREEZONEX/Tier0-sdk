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
  });

  function emit(event: string, ...args: any[]) {
    const handlers = eventHandlers[event] || [];
    handlers.forEach((h) => h(...args));
  }

  it('should throw error when URL is not provided on connect', async () => {
    const client = new Tier0MQClient();
    await expect(client.connect()).rejects.toThrow('MQTT URL is required');
  });

  it('should throw error when URL is not provided on subscribe', async () => {
    const client = new Tier0MQClient();
    client.subscribe('test/topic', () => {});
    // subscribe 是同步的，错误通过 error 事件抛出
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('should connect with config URL', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
    const connectPromise = client.connect();

    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://localhost:8080',
      expect.objectContaining({
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        clean: true,
      })
    );
  });

  it('should connect with override config', async () => {
    const client = new Tier0MQClient();
    const connectPromise = client.connect({
      url: 'wss://mqtt.example.com',
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
      'wss://mqtt.example.com',
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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
    const connectPromise = client.connect();

    const error = new Error('Connection refused');
    emit('error', error);

    await expect(connectPromise).rejects.toThrow('Connection refused');
  });

  it('should use env variable for URL', async () => {
    const originalEnv = process.env.TIER0_MQTT_URL;
    process.env.TIER0_MQTT_URL = 'ws://env.example.com';

    const client = new Tier0MQClient();
    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://env.example.com',
      expect.any(Object)
    );

    process.env.TIER0_MQTT_URL = originalEnv;
  });

  it('should use env variable for password', async () => {
    const originalKey = process.env.TIER0_API_KEY;
    process.env.TIER0_API_KEY = 'mqtt-password';

    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);

    // 等待懒连接完成
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://localhost:8080',
      expect.any(Object)
    );
    expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
      'test/topic',
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
  });

  it('should subscribe with qos 1', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'test/topic', Buffer.from('hello'));

    expect(handler).toHaveBeenCalledWith('test/topic', 'hello');
  });

  it('should dispatch JSON payload as string', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit('message', 'other/topic', Buffer.from('hello'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support wildcard # subscription', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

    const publishPromise = client.publish('test/topic', 'hello');

    // publish 是 async 的，内部会触发连接
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await publishPromise;

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://localhost:8080',
      expect.any(Object)
    );
    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      'test/topic',
      'hello',
      expect.objectContaining({ qos: 0, retain: false })
    );
  });

  it('should publish string message', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
    const handler = vi.fn();
    client.on('connect', handler);

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(handler).toHaveBeenCalled();
  });

  it('should handle disconnect event', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
    const handler = vi.fn();
    client.on('error', handler);

    const connectPromise = client.connect();
    const error = new Error('test error');
    emit('error', error);

    await expect(connectPromise).rejects.toThrow('test error');
    expect(handler).toHaveBeenCalledWith(error);
  });

  it('should remove event listener with off', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
    const handler = vi.fn();
    client.on('connect', handler);
    client.off('connect', handler);

    const connectPromise = client.connect();
    emit('connect');
    await connectPromise;

    expect(handler).not.toHaveBeenCalled();
  });

  it('should report isConnected correctly', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });
    expect(client.isConnected).toBe(false);

    const connectPromise = client.connect();
    mockMqttClient.connected = true;
    emit('connect');
    await connectPromise;

    expect(client.isConnected).toBe(true);
  });

  it('should resubscribe all topics on reconnect', async () => {
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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
    const client = new Tier0MQClient({ url: 'ws://localhost:8080' });

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

  it('should use env URL for lazy connect', async () => {
    const originalEnv = process.env.TIER0_MQTT_URL;
    process.env.TIER0_MQTT_URL = 'ws://lazy.example.com';

    const client = new Tier0MQClient();

    const handler = vi.fn();
    client.subscribe('test/topic', handler);
    await new Promise((resolve) => setTimeout(resolve, 10));
    emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mqtt.connect).toHaveBeenCalledWith(
      'ws://lazy.example.com',
      expect.any(Object)
    );

    process.env.TIER0_MQTT_URL = originalEnv;
  });

  it('should use env API_KEY for lazy connect password', async () => {
    const originalKey = process.env.TIER0_API_KEY;
    const originalUrl = process.env.TIER0_MQTT_URL;
    process.env.TIER0_API_KEY = 'lazy-key';
    process.env.TIER0_MQTT_URL = 'ws://lazy.example.com';

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
    process.env.TIER0_MQTT_URL = originalUrl;
  });
});
