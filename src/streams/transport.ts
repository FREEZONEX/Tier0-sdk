import { getClient, type HttpClient } from '../openapi/client.js';
import { getAppRuntime, type AppRuntime } from '../runtime.js';

export interface StreamTransportConfig {
  /** Bounds headers and body reading. It does not change server execution timeout. */
  transportTimeoutMs?: number;
}
export const DEFAULT_STREAM_TRANSPORT_TIMEOUT_MS = 60_000;

export class StreamTransportError extends Error {
  constructor(readonly kind: 'TRANSPORT_ERROR' | 'PROTOCOL_ERROR' | 'TRANSPORT_TIMEOUT', readonly status?: number) {
    super(kind);
  }
}

export class StreamTransport {
  private readonly timeout: number;
  constructor(
    private readonly resolveClient: () => HttpClient = getClient,
    config: StreamTransportConfig = {},
    readonly runtime: () => AppRuntime | undefined = getAppRuntime,
  ) {
    this.timeout = config.transportTimeoutMs ?? DEFAULT_STREAM_TRANSPORT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 2_147_483_647) {
      throw new TypeError('Tier0 SDK: invalid transportTimeoutMs.');
    }
  }

  async post(path: string, body: unknown, signal?: AbortSignal): Promise<{ value: unknown; status: number; ok: boolean }> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exchange = async () => {
      try {
        const runtime = this.runtime();
        if (runtime) response = await runtime.request(path, body, { signal: controller.signal });
        else {
          // Browser Apps must use their authenticated runtime bridge.
          if (typeof window !== 'undefined') throw new Error('Missing App runtime');
          const http = this.resolveClient();
          const key = http.getApiKey();
          response = await fetch(`${http.getBaseURL()}${path}`, {
            method: 'POST', redirect: 'manual', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}`, 'X-API-Key': key } : {}) },
            body: JSON.stringify(body),
          });
        }
      } catch {
        throw new StreamTransportError('TRANSPORT_ERROR');
      }
      try {
        return { value: await response.json() as unknown, status: response.status, ok: response.ok };
      } catch {
        throw new StreamTransportError('PROTOCOL_ERROR', response.status);
      }
    };
    try {
      const deadline = new Promise<never>((_, reject) => {
        const stop = () => reject(new StreamTransportError('TRANSPORT_ERROR', response?.status));
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) stop();
        timer = setTimeout(() => {
          reject(new StreamTransportError('TRANSPORT_TIMEOUT', response?.status));
          controller.abort();
        }, this.timeout);
      });
      return await Promise.race([exchange(), deadline]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
