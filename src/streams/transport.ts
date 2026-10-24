import { getClient, type HttpClient } from '../openapi/client.js';
import { getAppRuntime, type AppRuntime } from '../runtime.js';
import { CloudTransport, CloudTransportError, DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS, type CloudTransportConfig } from '../cloud-transport.js';

export type StreamTransportConfig = Pick<CloudTransportConfig, 'transportTimeoutMs'>;
export const DEFAULT_STREAM_TRANSPORT_TIMEOUT_MS = DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;
export { CloudTransportError as StreamTransportError };

/** Add the trusted App bridge to the existing single-attempt Cloud transport. */
export class StreamTransport extends CloudTransport {
  constructor(
    resolveClient: () => HttpClient = getClient,
    config: StreamTransportConfig = {},
    readonly runtime: () => AppRuntime | undefined = getAppRuntime,
  ) {
    super(resolveClient, config);
  }

  async post(path: string, body: unknown, signal?: AbortSignal) {
    const runtime = this.runtime();
    if (!runtime && typeof window !== 'undefined') throw new CloudTransportError('TRANSPORT_ERROR');
    return super.post(path, body, signal, runtime);
  }
}
