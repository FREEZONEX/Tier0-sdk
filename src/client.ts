import { getClient, HttpClient, type ClientConfig } from './openapi/client.js';
import { StreamRequestsClient } from './streams/requests.js';
import { StreamMessagesClient } from './streams/messages.js';
import { StreamTransport } from './streams/transport.js';
import type { CloudTransportConfig } from './cloud-transport.js';
import { CapabilitiesClient } from './capabilities.js';
import { createUnsV2Client } from './uns-v2/client.js';

export interface CloudClientConfig extends ClientConfig, CloudTransportConfig {}
export type Tier0ClientConfig = CloudClientConfig;

function assemble(resolveClient: () => HttpClient, config: CloudClientConfig = {}) {
  const transport = new StreamTransport(resolveClient, config);
  const messages = new StreamMessagesClient(transport);
  return {
    streams: { requests: new StreamRequestsClient(transport), messages },
    capabilities: new CapabilitiesClient(resolveClient, config),
    unsV2: createUnsV2Client(resolveClient, config),
    dispose: () => messages.dispose(),
  };
}

/** Isolated server client; in a browser, the trusted App runtime supplies HTTP authentication. */
export function createClient(config: Tier0ClientConfig = {}) {
  const http = new HttpClient(config);
  return assemble(() => http, config);
}

/** Automatically uses the host-injected App runtime, or configureClient on a server. */
export const client = assemble(getClient);
