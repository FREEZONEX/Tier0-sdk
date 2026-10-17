import { getClient, type HttpClient } from './openapi/client.js';

export interface CloudTransportConfig {
  /** Whole HTTP exchange including the response body, in milliseconds; default 60,000. */
  transportTimeoutMs?: number;
  /** UNS v2 response body limit; may only tighten the 20 MiB contract/RPC ceiling. */
  unsV2MaxResponseBytes?: number;
}

export const DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS = 60_000;
export const UNS_V2_MAX_REQUEST_BYTES = 16 << 20;
export const UNS_V2_MAX_RESPONSE_BYTES = 20 << 20;

type Failure = 'TRANSPORT_ERROR' | 'PROTOCOL_ERROR' | 'TRANSPORT_TIMEOUT';

/** Internal redacted failure, translated by each public contract client. */
export class CloudTransportError extends Error {
  constructor(readonly kind: Failure, readonly status?: number) {
    super(kind);
    this.name = 'CloudTransportError';
  }
}

/** Single fetch, no redirects/retries; one deadline covers both headers and body. */
export class CloudTransport {
  private readonly timeoutMs: number;
  private readonly unsV2MaxResponseBytes: number;

  constructor(private readonly resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    const timeout = config.transportTimeoutMs ?? DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
      throw new TypeError('Tier0 SDK: transportTimeoutMs must be an integer between 1 and 2147483647.');
    }
    this.timeoutMs = timeout;
    const maxResponseBytes = config.unsV2MaxResponseBytes ?? UNS_V2_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > UNS_V2_MAX_RESPONSE_BYTES) {
      throw new TypeError('Tier0 SDK: unsV2MaxResponseBytes must be an integer between 1 and 20971520.');
    }
    this.unsV2MaxResponseBytes = maxResponseBytes;
  }

  async postText(path: string, body: string): Promise<{ text: string; status: number; ok: boolean }> {
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const key = client.getApiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers['X-API-Key'] = key;
    }
    const controller = new AbortController();
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exchange = async () => {
      try {
        response = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
      } catch {
        throw new CloudTransportError('TRANSPORT_ERROR');
      }
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > this.unsV2MaxResponseBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      }
      if (!response.body) throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const chunks: string[] = [];
      let receivedBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > this.unsV2MaxResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new CloudTransportError('PROTOCOL_ERROR', response.status);
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } catch (error) {
        if (error instanceof CloudTransportError) throw error;
        throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      } finally {
        reader.releaseLock();
        reader = undefined;
      }
      return { text: chunks.join(''), status: response.status, ok: response.ok };
    };
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => undefined);
          reject(new CloudTransportError('TRANSPORT_TIMEOUT', response?.status));
        }, this.timeoutMs);
      });
      // Also bounds custom transports which ignore AbortSignal.
      return await Promise.race([exchange(), deadline]);
    } catch (error) {
      if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_TIMEOUT', response?.status);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async post(path: string, body: unknown): Promise<{ value: unknown; status: number; ok: boolean }> {
    const client = this.resolveClient();
    const url = `${client.getBaseURL()}${path}`;
    const key = client.getApiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers['X-API-Key'] = key;
    }
    const serialized = JSON.stringify(body);
    const controller = new AbortController();
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exchange = async () => {
      try {
        response = await fetch(url, { method: 'POST', headers, body: serialized, redirect: 'manual', signal: controller.signal });
      } catch {
        throw new CloudTransportError('TRANSPORT_ERROR');
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new CloudTransportError('PROTOCOL_ERROR', response.status);
      }
      return { value, status: response.status, ok: response.ok };
    };
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CloudTransportError('TRANSPORT_TIMEOUT', response?.status));
        }, this.timeoutMs);
      });
      // Also bounds custom transports which ignore AbortSignal.
      return await Promise.race([exchange(), deadline]);
    } catch (error) {
      if (controller.signal.aborted) throw new CloudTransportError('TRANSPORT_TIMEOUT', response?.status);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
