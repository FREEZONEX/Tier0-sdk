import mqtt from 'mqtt';
import type { MqttClient, IClientOptions } from 'mqtt';
import type { MQTTConfig, MQTTEventMap } from './types.js';

function getEnvVar(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return import.meta.env[key] || import.meta.env[`VITE_${key}`];
    }
  } catch {
    // ignore
  }
  return undefined;
}

export type TopicHandler = (topic: string, payload: string) => void;

function parseWorkspaceIDFromApiKey(apiKey: string): string | undefined {
  apiKey = apiKey.trim();
  const parts = apiKey.split('-');
  if (parts.length !== 3 || parts[0] !== 'sk') {
    return undefined;
  }
  const payload = parts[2];
  if (!payload.startsWith('ws')) {
    return undefined;
  }
  const sepIndex = payload.indexOf('_');
  if (sepIndex <= 2) {
    return undefined;
  }
  const workspaceID36 = payload.slice(2, sepIndex);
  try {
    const workspaceID = parseInt(workspaceID36, 36);
    if (workspaceID <= 0 || isNaN(workspaceID)) {
      return undefined;
    }
    return String(workspaceID);
  } catch {
    return undefined;
  }
}

function generateRandomString(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

interface Subscription {
  topic: string;
  handler: TopicHandler;
}

export class Tier0MQClient {
  private client: MqttClient | null = null;
  private config: MQTTConfig;
  private listeners: { [K in keyof MQTTEventMap]?: Array<MQTTEventMap[K]> } = {};
  private subscriptions: Subscription[] = [];
  private connectingPromise: Promise<void> | null = null;
  private _connected = false;

  constructor(config?: MQTTConfig) {
    const envHost = getEnvVar('TIER0_MQTT_HOST');
    const envPort = getEnvVar('TIER0_MQTT_PORT');

    const host = config?.host || envHost || '';
    const port = config?.port || parseInt(envPort || '8084') || 8084;
    const password = config?.password || getEnvVar('TIER0_API_KEY') || '';

    // 从 apiKey 解析 workspaceID，自动生成 clientId 和 username
    const workspaceID = config?.clientId && config?.username
      ? undefined
      : parseWorkspaceIDFromApiKey(password);

    const autoClientId = workspaceID
      ? `${workspaceID}&${generateRandomString(8)}`
      : `enterprise&${generateRandomString(8)}`;
    const autoUsername = workspaceID
      ? `${workspaceID}&open`
      : 'enterprise&open';

    this.config = {
      host,
      port,
      clientId: config?.clientId || autoClientId,
      username: config?.username || autoUsername,
      password,
      keepAlive: config?.keepAlive ?? 60,
      reconnectPeriod: config?.reconnectPeriod ?? 5000,
      connectTimeout: config?.connectTimeout ?? 30000,
      clean: config?.clean ?? true,
      ...config,
    };
  }

  private get mqttUrl(): string {
    const { host, port } = this.config;
    if (!host) {
      throw new Error(
        'MQTT host is required. Provide it via MQTTConfig or TIER0_MQTT_HOST environment variable.'
      );
    }
    return `ws://${host}:${port}/mqtt`;
  }

  // 内部确保已连接（懒连接）
  private async ensureConnected(): Promise<void> {
    if (this._connected) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = this.doConnect();
    return this.connectingPromise;
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: IClientOptions = {
        clientId: this.config.clientId,
        username: this.config.username,
        password: this.config.password,
        keepalive: this.config.keepAlive,
        reconnectPeriod: this.config.reconnectPeriod,
        connectTimeout: this.config.connectTimeout,
        clean: this.config.clean,
      };

      this.client = mqtt.connect(this.mqttUrl, options);

      this.client.on('connect', () => {
        this._connected = true;
        this.connectingPromise = null;
        this.emit('connect');
        // 断连重连后自动恢复所有订阅
        this.resubscribeAll();
        resolve();
      });

      this.client.on('error', (err) => {
        this.emit('error', err);
        this.connectingPromise = null;
        reject(err);
      });

      this.client.on('disconnect', () => {
        this._connected = false;
        this.emit('disconnect');
      });

      this.client.on('close', () => {
        this._connected = false;
      });

      this.client.on(
        'message',
        (topic: string, payload: Buffer, _packet: mqtt.IPublishPacket) => {
          const payloadStr = payload.toString();
          this.subscriptions.forEach((sub) => {
            if (this.topicMatch(sub.topic, topic)) {
              try {
                sub.handler(topic, payloadStr);
              } catch (e) {
                this.emit('error', e as Error);
              }
            }
          });
        }
      );
    });
  }

  // 显式连接（需要等待连接完成时使用）
  async connect(config?: MQTTConfig): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    return this.ensureConnected();
  }

  // 订阅 topic，内部 qos 固定为 1，handler 接收 (topic, payload)
  // 无需先调用 connect()，自动处理连接
  subscribe(topic: string, handler: TopicHandler): void {
    // 避免重复注册同一 topic 的同一 handler
    const exists = this.subscriptions.some(
      (s) => s.topic === topic && s.handler === handler
    );
    if (exists) {
      return;
    }

    this.subscriptions.push({ topic, handler });

    if (this._connected && this.client) {
      this.client.subscribe(topic, { qos: 1 as 0 | 1 | 2 }, (err) => {
        if (err) {
          this.emit('error', err);
          // 订阅失败时回滚
          this.subscriptions = this.subscriptions.filter(
            (s) => !(s.topic === topic && s.handler === handler)
          );
        }
      });
    } else {
      // 未连接时触发懒连接，连接成功后 resubscribeAll 会自动 subscribe
      this.ensureConnected().catch((err) => this.emit('error', err));
    }
  }

  // 取消订阅：如果提供了 handler 则仅移除该 handler，否则移除该 topic 下所有 handler
  unsubscribe(topic: string, handler?: TopicHandler): void {
    if (handler) {
      this.subscriptions = this.subscriptions.filter(
        (s) => !(s.topic === topic && s.handler === handler)
      );
    } else {
      this.subscriptions = this.subscriptions.filter((s) => s.topic !== topic);
    }

    if (!this.client) return;

    // 如果该 topic 下已无任何 handler，则向 broker 发送 unsubscribe
    const stillHasHandler = this.subscriptions.some((s) => s.topic === topic);
    if (!stillHasHandler) {
      this.client.unsubscribe(topic, (err) => {
        if (err) {
          this.emit('error', err);
        }
      });
    }
  }

  // 发布消息，无需先调用 connect()，内部自动处理连接
  async publish(
    topic: string,
    payload: string | object,
    options?: { qos?: number; retain?: boolean }
  ): Promise<void> {
    await this.ensureConnected();

    const message =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client!.publish(topic, message, {
      qos: (options?.qos ?? 0) as 0 | 1 | 2,
      retain: options?.retain ?? false,
    });
  }

  disconnect(): void {
    if (!this.client) return;

    this.client.end(true, () => {
      this.emit('disconnect');
    });
    this.client = null;
    this._connected = false;
    this.connectingPromise = null;
    this.subscriptions = [];
  }

  on<K extends keyof MQTTEventMap>(event: K, handler: MQTTEventMap[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(handler);
  }

  off<K extends keyof MQTTEventMap>(event: K, handler: MQTTEventMap[K]): void {
    const handlers = this.listeners[event];
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
  }

  private emit<K extends keyof MQTTEventMap>(
    event: K,
    ...args: Parameters<MQTTEventMap[K]>
  ): void {
    const handlers = this.listeners[event];
    if (!handlers) return;
    handlers.forEach((h) => (h as any)(...args));
  }

  // 断连后自动重新订阅所有已注册的 topic
  private resubscribeAll(): void {
    if (!this.client) return;

    // 按 topic 去重，每个 topic 只订阅一次
    const uniqueTopics = Array.from(
      new Set(this.subscriptions.map((s) => s.topic))
    );
    uniqueTopics.forEach((topic) => {
      this.client!.subscribe(topic, { qos: 1 as 0 | 1 | 2 }, (err) => {
        if (err) {
          this.emit('error', err);
        }
      });
    });
  }

  // 判断接收到的 topic 是否匹配订阅的 topic（支持通配符 # 和 +）
  private topicMatch(subscribed: string, received: string): boolean {
    const subParts = subscribed.split('/');
    const recParts = received.split('/');

    for (let i = 0; i < subParts.length; i++) {
      const sp = subParts[i];
      const rp = recParts[i];

      if (sp === '#') {
        // # 必须是最后一个层级，匹配后面所有
        return true;
      }
      if (sp === '+') {
        // + 匹配单个层级
        continue;
      }
      if (sp !== rp) {
        return false;
      }
    }

    return subParts.length === recParts.length;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get subscribedTopics(): string[] {
    return Array.from(new Set(this.subscriptions.map((s) => s.topic)));
  }
}
