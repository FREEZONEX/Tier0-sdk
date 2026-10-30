import type { NatsConnection, Subscription } from '@nats-io/nats-core';
import type { KeyPair } from '@nats-io/nkeys';
import { getCurrentAppId } from '../runtime-context.js';
import { onAppRuntimeDispose } from '../runtime.js';
import type { StreamJSON } from './requests.js';
import { StreamTransport } from './transport.js';
import type { components } from './contract.generated.js';

export interface StreamMessage<Payload = StreamJSON> {
  version: 'stream-messages/v1';
  messageId: string;
  correlationId?: string;
  payload: Payload;
}
export interface StreamMessagePublishOptions {
  messageId?: string;
  correlationId?: string;
}
export interface StreamMessageSubscription {
  readonly disposed: boolean;
  dispose(): Promise<void>;
}
export type StreamMessageErrorHandler = (error: StreamMessageError) => void;
export interface StreamMessageHandle<Payload = StreamJSON> {
  /** Resolves after broker flush, not after receiver acknowledgement. No retry or offline queue. */
  publish(payload: Payload, options?: StreamMessagePublishOptions): Promise<StreamMessage<Payload>>;
  subscribe(handler: (message: StreamMessage<Payload>) => void | Promise<void>, options?: {
    onError?: StreamMessageErrorHandler;
  }): Promise<StreamMessageSubscription>;
}
export class StreamMessageError extends Error {
  readonly retryable = false;
  constructor(readonly errorCode: string, message: string) {
    super(message);
    this.name = 'StreamMessageError';
  }
}

// SYS omits the ungranted direction; Swagger currently marks both fields required.
interface Permission extends Partial<Omit<components['schemas']['StreamMessageGrantedTopic'], 'topic'>> {
  topic: string;
}
interface Ticket extends Omit<components['schemas']['StreamMessagesConnectResp'], 'contractVersion' | 'permissions'> {
  contractVersion: 'stream-messages/v1';
  url: string;
  userJwt: string;
  expiresAt: string;
  permissions: Permission[];
  maxPayloadBytes: number;
}
const encoder = new TextEncoder();
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PAYLOAD = 60 * 1024;
const MAX_ENVELOPE = 64 * 1024;
const MAX_FLUSH_TIMEOUT_MS = 10_000;

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function json(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) return false;
  seen.add(value);
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every(v => json(v, seen));
  seen.delete(value);
  return valid;
}
function fail(code: string, message: string): StreamMessageError {
  return new StreamMessageError(`STREAM_MESSAGE_${code}`, message);
}
function envelope(value: unknown, maxPayload: number): value is StreamMessage {
  if (!plain(value) || Object.keys(value).some(k => !['version', 'messageId', 'correlationId', 'payload'].includes(k)) ||
      value.version !== 'stream-messages/v1' || typeof value.messageId !== 'string' || !uuid.test(value.messageId) ||
      (value.correlationId !== undefined && (typeof value.correlationId !== 'string' ||
        encoder.encode(value.correlationId).length > 128 || /[\u0000\r\n]/.test(value.correlationId))) ||
      !json(value.payload)) return false;
  return encoder.encode(JSON.stringify(value.payload)).length <= maxPayload;
}

/** One permission-scoped session. Every connection gets a fresh key and JWT. */
class MessageSession implements StreamMessageSubscription {
  disposed = false;
  readonly runtime: ReturnType<StreamTransport['runtime']>;
  private connection?: NatsConnection;
  private subscription?: Subscription;
  private connecting?: Promise<void>;
  private watching?: Promise<void>;
  private abort = new AbortController();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private connected = false;
  private attempts = 0;
  private subject = '';
  private payloadLimit = MAX_PAYLOAD;
  private expiresAt = 0;
  private brokerError?: StreamMessageError;
  private disposing?: Promise<void>;
  private removeRuntimeListener?: () => void;

  constructor(
    private transport: StreamTransport,
    private topic: string,
    private mode: 'publish' | 'subscribe',
    private report: StreamMessageErrorHandler,
    private remove: () => void,
    private handler?: (value: StreamMessage) => void | Promise<void>,
  ) {
    this.runtime = transport.runtime();
    if (this.runtime) this.removeRuntimeListener = onAppRuntimeDispose(this.runtime, () => { void this.dispose(); });
  }

  async ready(): Promise<void> {
    if (this.disposed) throw fail('DISPOSED', 'Stream messages session disposed.');
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    if (this.started) throw fail('DISCONNECTED', 'Stream messages disconnected.');
    this.started = true;
    try {
      await this.connect();
      if (this.disposed) throw fail('DISPOSED', 'Stream messages session disposed.');
    }
    catch (error) { await this.dispose(); throw error; }
  }

  private connect(): Promise<void> {
    const operation = this.open();
    this.connecting = operation;
    return operation.finally(() => { if (this.connecting === operation) this.connecting = undefined; });
  }

  private async open(): Promise<void> {
    let nc: NatsConnection | undefined;
    let key: KeyPair | undefined;
    let watched = false;
    try {
      // HTTP-only Cloud Apps must not load broker libraries or require their dependencies.
      const [{ jwtAuthenticator, wsconnect }, { createUser }] = await Promise.all([
        import('@nats-io/nats-core'), import('@nats-io/nkeys'),
      ]);
      if (this.disposed) return;
      const connectionKey = createUser();
      key = connectionKey;
      const appId = this.transport.runtime()?.appId ?? getCurrentAppId();
      const request: components['schemas']['StreamMessagesConnectReq'] = {
        appId, topics: [{ topic: this.topic, publish: this.mode === 'publish', subscribe: this.mode === 'subscribe' }],
        clientPublicKey: connectionKey.getPublicKey(),
      };
      const { value, ok } = await this.transport.post('/openapi/v2/stream-messages/connect', request, this.abort.signal);
      const ticket = this.ticket(value, ok);
      if (this.disposed) return;
      const expiresAt = Date.parse(ticket.expiresAt);
      const permission = ticket.permissions[0];
      this.subject = (this.mode === 'publish' ? permission.publishSubject : permission.subscribeSubject)!;
      this.payloadLimit = ticket.maxPayloadBytes;
      // Disable library reconnection so it cannot buffer writes or reuse expired JWTs.
      nc = await wsconnect({
        servers: [ticket.url], reconnect: false, waitOnFirstConnect: false,
        ignoreClusterUpdates: true, timeout: Math.max(1, Math.min(MAX_FLUSH_TIMEOUT_MS, expiresAt - Date.now())),
        authenticator: jwtAuthenticator(ticket.userJwt, () => connectionKey.getSeed()),
      });
      if (this.disposed) { await nc.close(); return; }
      this.connection = nc;
      this.expiresAt = expiresAt;
      this.brokerError = undefined;
      watched = true;
      this.watching = this.watch(nc, connectionKey);
      // Renewal also bounds the initial handshake; it must not wait for its first PONG.
      const untilExpiry = expiresAt - Date.now();
      this.expiryTimer = setTimeout(() => {
        if (this.connection !== nc) return;
        this.connected = false;
        void nc!.close();
      }, Math.max(1, Math.min(2_147_483_647, untilExpiry - Math.min(5_000, untilExpiry / 10))));
      if (this.mode === 'subscribe') {
        this.subscription = nc.subscribe(this.subject, { callback: (error, msg) => {
          if (this.disposed || this.connection !== nc || Date.now() >= expiresAt) return;
          if (error) { this.report(fail('SUBSCRIBE_FAILED', 'Stream subscription failed.')); return; }
          try {
            if (msg.data.length > MAX_ENVELOPE) throw fail('INVALID_ENVELOPE', 'Stream message envelope exceeds limit.');
            const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(msg.data));
            if (!envelope(value, this.payloadLimit)) throw fail('INVALID_ENVELOPE', 'Invalid Stream message envelope.');
            // Identity comes from the authorized physical subject; never accept identity fields in the envelope.
            const prefix = this.subject.slice(0, -1);
            if (!msg.subject.startsWith(prefix) || !/^[^.\s*>]+$/.test(msg.subject.slice(prefix.length))) {
              throw fail('INVALID_SUBJECT', 'Invalid Stream message subject.');
            }
            let result: void | Promise<void>;
            try { result = this.handler!(value); }
            catch { this.report(fail('HANDLER_FAILED', 'Stream message handler failed.')); return; }
            Promise.resolve(result).catch(() => {
              if (!this.disposed) this.report(fail('HANDLER_FAILED', 'Stream message handler failed.'));
            });
          } catch (error) {
            this.report(error instanceof StreamMessageError ? error : fail('INVALID_ENVELOPE', 'Invalid Stream message envelope.'));
          }
        } });
      }
      await this.flush(nc, false);
      if (this.disposed) return;
      if (nc.isClosed() || this.connection !== nc) throw fail('CONNECT_FAILED', 'Stream messages connection failed.');
      this.connected = true;
      this.attempts = 0;
    } catch (error) {
      if (nc) await nc.close();
      if (this.disposed) return;
      throw error instanceof StreamMessageError ? error : fail('CONNECT_FAILED', 'Stream messages connection failed.');
    } finally {
      // Before a successful handoff, this attempt owns its key, including when
      // the issuer or dial fails. A live connection's watcher owns later wiping.
      if (!watched) {
        await nc?.close();
        key?.clear();
      }
    }
  }

  private async flush(nc: NatsConnection, publishing: boolean): Promise<void> {
    const failure = () => publishing
      ? fail('RESULT_UNKNOWN', 'Stream publish result unknown; do not automatically retry.')
      : fail('CONNECT_FAILED', 'Stream messages connection failed.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped: (() => void) | undefined;
    try {
      if (this.disposed || nc.isClosed() || this.expiresAt <= Date.now()) throw failure();
      const deadline = new Promise<never>((_resolve, reject) => {
        stopped = () => reject(failure());
        this.abort.signal.addEventListener('abort', stopped, { once: true });
        if (this.abort.signal.aborted) stopped();
        timer = setTimeout(stopped, Math.max(1, Math.min(MAX_FLUSH_TIMEOUT_MS, this.expiresAt - Date.now())));
      });
      await Promise.race([nc.flush(), deadline, nc.closed().then(() => { throw failure(); })]);
    } catch {
      const watching = this.connection === nc ? this.watching : undefined;
      if (this.connection === nc) this.connected = false;
      // Stop the transport and wipe its key before reporting a failed/unknown operation.
      await nc.close();
      await watching;
      throw failure();
    } finally {
      clearTimeout(timer);
      if (stopped) this.abort.signal.removeEventListener('abort', stopped);
    }
  }

  private ticket(value: unknown, ok: boolean): Ticket {
    if (!ok) throw fail('CONNECT_DENIED', 'Stream messages connection denied.');
    if (!plain(value) || value.contractVersion !== 'stream-messages/v1' ||
        typeof value.url !== 'string' || typeof value.userJwt !== 'string' || !value.userJwt ||
        typeof value.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.expiresAt) ||
        !(Date.parse(value.expiresAt) > Date.now()) ||
        !Number.isSafeInteger(value.maxPayloadBytes) || (value.maxPayloadBytes as number) < 1 || (value.maxPayloadBytes as number) > MAX_PAYLOAD ||
        !Array.isArray(value.permissions) || value.permissions.length !== 1) {
      throw fail('CONNECT_PROTOCOL_ERROR', 'Invalid Stream messages connection response.');
    }
    const url = new URL(value.url);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.search) {
      throw fail('CONNECT_PROTOCOL_ERROR', 'Stream messages requires a credential-free WSS URL.');
    }
    const permission: unknown = value.permissions[0];
    if (!plain(permission) || permission.topic !== this.topic) throw fail('CONNECT_PROTOCOL_ERROR', 'Invalid topic permission.');
    // Subject layout belongs to SYS. Only check NATS syntax and requested access.
    const validSubject = (subject: unknown, mode: 'publish' | 'subscribe') => {
      if (typeof subject !== 'string' || !subject) return false;
      if (mode === 'subscribe' && !subject.endsWith('.*')) return false;
      const parts = subject.split('.');
      return parts.every((part, index) => !!part &&
        (mode === 'subscribe' && index === parts.length - 1 && part === '*' || !/[\s*>]/.test(part)));
    };
    const publish = permission.publishSubject;
    const subscribe = permission.subscribeSubject;
    if ((publish !== undefined && !validSubject(publish, 'publish')) ||
        (subscribe !== undefined && !validSubject(subscribe, 'subscribe')) ||
        (this.mode === 'publish' ? !publish || !!subscribe : !subscribe || !!publish)) {
      throw fail('CONNECT_PROTOCOL_ERROR', 'Invalid scoped topic subjects.');
    }
    return value as unknown as Ticket;
  }

  private async watch(nc: NatsConnection, key: KeyPair): Promise<void> {
    try {
      for await (const status of nc.status()) {
        if (this.disposed || this.connection !== nc) break;
        if (status.type === 'disconnect' || status.type === 'close' || status.type === 'staleConnection') this.connected = false;
        if (status.type === 'error' || status.type === 'slowConsumer') {
          this.brokerError = fail(status.type === 'error' ? 'BROKER_ERROR' : 'SLOW_CONSUMER', 'Stream messages asynchronous broker error.');
          this.report(this.brokerError);
        }
      }
      const error = await nc.closed();
      if (error && !this.disposed) this.report(fail('CONNECTION_LOST', 'Stream messages connection lost.'));
    } catch {
      if (!this.disposed) this.report(fail('CONNECTION_LOST', 'Stream messages connection lost.'));
    } finally {
      // Close even if the status iterator failed. A replacement must never be
      // issued while the prior, potentially wider, authenticated socket is live.
      await nc.close();
      key.clear();
      if (this.connection === nc) {
        this.connection = undefined;
        this.connected = false;
        this.subscription = undefined;
        clearTimeout(this.expiryTimer);
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.disposed) return;
      void this.connect().catch(error => {
        this.report(error instanceof StreamMessageError ? error : fail('CONNECT_FAILED', 'Stream messages reconnection failed.'));
        this.scheduleReconnect();
      });
    }, Math.min(30_000, 500 * 2 ** Math.min(this.attempts++, 6)));
  }

  async publish(value: StreamMessage): Promise<void> {
    // Only the very first publish may establish a connection. Subsequent disconnected writes fail.
    if (!this.started) await this.ready();
    const nc = this.connection;
    if (this.disposed || !this.connected || !nc || nc.isClosed()) throw fail('DISCONNECTED', 'Stream messages disconnected.');
    if (!envelope(value, this.payloadLimit)) throw fail('INVALID_ENVELOPE', 'Invalid Stream message envelope or payload limit exceeded.');
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length > MAX_ENVELOPE) throw fail('PAYLOAD_TOO_LARGE', 'Stream message envelope exceeds limit.');
    this.brokerError = undefined;
    try {
      nc.publish(this.subject, bytes);
      await this.flush(nc, true);
      if (this.brokerError) throw this.brokerError;
      if (!this.connected || this.connection !== nc) throw fail('RESULT_UNKNOWN', 'Stream publish result unknown.');
    } catch (error) {
      throw error instanceof StreamMessageError ? error : fail('RESULT_UNKNOWN', 'Stream publish result unknown; do not automatically retry.');
    }
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.connected = false;
    this.abort.abort();
    this.removeRuntimeListener?.();
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.expiryTimer);
    this.subscription?.unsubscribe();
    this.disposing = (async () => {
      await this.connection?.close();
      await this.connecting?.catch(() => undefined);
      await this.watching;
      this.connection = undefined;
      this.remove();
    })();
    return this.disposing;
  }
}

export class StreamMessagesClient {
  private sessions = new Set<MessageSession>();
  private listeners = new Set<StreamMessageErrorHandler>();
  private disposed = false;
  private disposing?: Promise<void>;
  constructor(private readonly transport = new StreamTransport()) {}

  onError(handler: StreamMessageErrorHandler): () => void {
    if (this.disposed) throw fail('DISPOSED', 'Stream messages client disposed.');
    this.listeners.add(handler);
    return () => { this.listeners.delete(handler); };
  }

  use<Payload = StreamJSON>(selector: { topic: string }): StreamMessageHandle<Payload> {
    if (!plain(selector) || Object.keys(selector).some(k => k !== 'topic') ||
        typeof selector.topic !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(selector.topic)) {
      throw new TypeError('Tier0 SDK: invalid logical Stream topic.');
    }
    const topic = selector.topic;
    let publisher: MessageSession | undefined;
    const session = (mode: 'publish' | 'subscribe', handler?: (value: StreamMessage) => void | Promise<void>, onError?: StreamMessageErrorHandler) => {
      if (this.disposed) throw fail('DISPOSED', 'Stream messages client disposed.');
      const report = (error: StreamMessageError) => {
        const listeners = new Set(this.listeners);
        if (onError) listeners.add(onError);
        if (!listeners.size) console.error(error);
        for (const listener of listeners) {
          try { listener(error); } catch { console.error(fail('ERROR_HANDLER_FAILED', 'Stream messages error handler failed.')); }
        }
      };
      const value = new MessageSession(this.transport, topic, mode, report, () => this.sessions.delete(value), handler);
      this.sessions.add(value);
      return value;
    };
    return {
      publish: async (payload, options = {}) => {
        if (this.disposed) throw fail('DISPOSED', 'Stream messages client disposed.');
        if (!plain(options) || Object.keys(options).some(k => !['messageId', 'correlationId'].includes(k)) ||
            (options.messageId !== undefined && typeof options.messageId !== 'string') ||
            (options.correlationId !== undefined && typeof options.correlationId !== 'string')) {
          throw new TypeError('Tier0 SDK: unsupported Stream publish option.');
        }
        const message: StreamMessage<Payload> = {
          version: 'stream-messages/v1', messageId: options.messageId ?? crypto.randomUUID(),
          ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }), payload,
        };
        if (!envelope(message, MAX_PAYLOAD)) throw fail('INVALID_ENVELOPE', 'Invalid Stream message envelope.');
        if (encoder.encode(JSON.stringify(message)).length > MAX_ENVELOPE) throw fail('PAYLOAD_TOO_LARGE', 'Stream message envelope exceeds limit.');
        if (publisher?.disposed) {
          const previous = publisher;
          await previous.dispose();
          if (previous.runtime !== this.transport.runtime()) throw fail('DISCONNECTED', 'Stream messages disconnected.');
          if (publisher === previous) publisher = undefined;
        }
        if (!publisher) publisher = session('publish');
        await publisher.publish(message as StreamMessage);
        return message;
      },
      subscribe: async (handler, options = {}) => {
        if (typeof handler !== 'function' || !plain(options) || Object.keys(options).some(k => k !== 'onError') ||
            (options.onError !== undefined && typeof options.onError !== 'function')) throw new TypeError('Tier0 SDK: invalid Stream subscription.');
        const value = session('subscribe', handler as (value: StreamMessage) => void | Promise<void>, options.onError);
        await value.ready();
        return value;
      },
    };
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.disposing = Promise.all([...this.sessions].map(session => session.dispose())).then(() => {
      this.listeners.clear();
    });
    return this.disposing;
  }
}
