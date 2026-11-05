import { HttpClient, type ClientConfig } from './openapi/client.js';
import { createApi } from './openapi/api.js';
import { createFilesClient } from './files.js';

/** A request identity must provide its own non-empty key, never a process-wide fallback. */
export type RequestClientConfig = Omit<ClientConfig, 'apiKey' | 'getApiKey'> & { apiKey: string };

/** Create an isolated client for one user/workspace or request. */
export function createTier0Client(config: RequestClientConfig) {
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
    throw new Error('Tier0 SDK: createTier0Client requires a non-empty apiKey');
  }
  const client = new HttpClient({ ...config });
  return { ...createApi(client), files: createFilesClient(client) };
}
