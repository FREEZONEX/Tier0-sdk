import { getClient, HttpClient, type ClientConfig } from './openapi/client.js';
import { StreamRequestsClient } from './streams/requests.js';
import { StreamMessagesClient } from './streams/messages.js';
import { StreamTransport, type StreamTransportConfig } from './streams/transport.js';

export interface Tier0ClientConfig extends ClientConfig, StreamTransportConfig {}

function assemble(transport: StreamTransport) {
  const messages = new StreamMessagesClient(transport);
  return {
    streams: { requests: new StreamRequestsClient(transport), messages },
    dispose: () => messages.dispose(),
  };
}

/** Isolated server client; in a browser, the trusted App runtime supplies HTTP authentication. */
export function createClient(config: Tier0ClientConfig = {}) {
  const http = new HttpClient(config);
  return assemble(new StreamTransport(() => http, config));
}

/** Automatically uses the host-injected App runtime, or configureClient on a server. */
export const client = assemble(new StreamTransport(getClient));
