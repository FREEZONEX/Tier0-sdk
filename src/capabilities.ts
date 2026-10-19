import { CloudTransport, CloudTransportError, type CloudTransportConfig } from './cloud-transport.js';
import { getClient, type HttpClient } from './openapi/client.js';

export type CapabilityCode = 'namespace.v2' | 'source.v1' | 'stream.v2' | 'control.v1' | 'control.invoke.v1';
export type CapabilityState = 'disabled' | 'not_supported' | 'unavailable' | 'readiness_unknown' | 'ready';
export type CapabilityAvailability = 'unavailable' | 'unknown' | 'available';

export interface PublicCapability {
  code: CapabilityCode;
  /** Public release and workspace gates; does not establish runtime readiness. */
  releaseEnabled: boolean;
  /** Server-assessed implementation/readiness, never inferred from releaseEnabled. */
  enabled: boolean;
  /** Authorization summary, not a grant for every individual Control code. */
  allowed: boolean;
  state: CapabilityState;
  /** Not device online status or execution/ACK confirmation. */
  availability: CapabilityAvailability;
  contractVersions: string[];
}

export interface CapabilityDeprecation {
  contract: string;
  replacement?: string;
  sunsetAt?: string;
}

export interface CapabilityDiscoverResponse {
  product: 'cloud';
  /** Trusted server configuration only; absent when unconfigured. */
  productVersion?: string;
  contractVersion: '1.0';
  apiContractVersions: string[];
  interpreterContractVersions: string[];
  /** Public SDK contract labels, not npm package versions. */
  sdkContractVersions: string[];
  capabilities: PublicCapability[];
  deprecations: CapabilityDeprecation[];
}

export interface CapabilityErrorInfo {
  status?: number;
  /** Gateway string code (including unknown future codes), or an SDK-local CAPABILITY_* code. */
  errorCode: string;
}

export class CapabilityError extends Error {
  readonly status?: number;
  readonly errorCode: string;
  readonly retryable = false;

  constructor(message: string, info: CapabilityErrorInfo) {
    super(message);
    this.name = 'CapabilityError';
    this.status = info.status;
    this.errorCode = info.errorCode;
  }
}

const contracts: Record<CapabilityCode, string[]> = {
  'namespace.v2': ['openapi/v2'],
  'source.v1': ['openapi/v1'],
  'stream.v2': ['tier0-stream/v2'],
  'control.v1': ['openapi/v1', 'control/v1'],
  'control.invoke.v1': ['openapi/v1', 'tier0-stream/v2', 'control/v1'],
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
}

/** Validate and explicitly project the frozen contract; unknown capabilities/extension fields are ignored. */
function discovery(value: unknown, status: number): CapabilityDiscoverResponse {
  const fail = (version = false): never => {
    throw new CapabilityError(version ? 'Unsupported capability contract version.' : 'Invalid capability discovery response.', {
      status, errorCode: version ? 'CAPABILITY_UNSUPPORTED_VERSION' : 'CAPABILITY_PROTOCOL_ERROR',
    });
  };
  if (!record(value)) return fail();
  if (!text(value.product) || !text(value.contractVersion) ||
      !strings(value.apiContractVersions) || !strings(value.interpreterContractVersions) || !strings(value.sdkContractVersions) ||
      !Array.isArray(value.capabilities) || !Array.isArray(value.deprecations) ||
      (value.productVersion !== undefined && !text(value.productVersion))) return fail();
  if (value.product !== 'cloud' || value.contractVersion !== '1.0' ||
      !value.apiContractVersions.includes('openapi/v1') ||
      !value.interpreterContractVersions.includes('tier0-stream/v2') ||
      !value.sdkContractVersions.includes('control/v1')) return fail(true);

  const capabilities: PublicCapability[] = [];
  const seen = new Set<string>();
  for (const item of value.capabilities) {
    if (!record(item) || !text(item.code)) return fail();
    if (!Object.prototype.hasOwnProperty.call(contracts, item.code)) continue;
    const code = item.code as CapabilityCode;
    if (seen.has(code)) return fail();
    seen.add(code);
    if (typeof item.releaseEnabled !== 'boolean' || typeof item.enabled !== 'boolean' || typeof item.allowed !== 'boolean' ||
        !['disabled', 'not_supported', 'unavailable', 'readiness_unknown', 'ready'].includes(item.state as string) ||
        !['unavailable', 'unknown', 'available'].includes(item.availability as string) || !strings(item.contractVersions)) return fail();
    if (contracts[code].some(version =>
      !(item.contractVersions as string[]).includes(version) ||
      (version.startsWith('openapi/') && !(value.apiContractVersions as string[]).includes(version)))) return fail(true);
    const ready = item.state === 'ready';
    const expectedAvailability = ready ? 'available' : item.state === 'readiness_unknown' ? 'unknown' : 'unavailable';
    if (item.enabled !== ready || item.availability !== expectedAvailability ||
        (ready && (!item.releaseEnabled || !item.allowed)) ||
        (item.state === 'disabled' ? item.releaseEnabled : !item.releaseEnabled)) return fail();
    capabilities.push({
      code, releaseEnabled: item.releaseEnabled, enabled: item.enabled, allowed: item.allowed,
      state: item.state as CapabilityState, availability: item.availability as CapabilityAvailability,
      contractVersions: [...item.contractVersions],
    });
  }
  const deprecations: CapabilityDeprecation[] = [];
  for (const item of value.deprecations) {
    if (!record(item) || !text(item.contract) ||
        (item.replacement !== undefined && !text(item.replacement)) ||
        (item.sunsetAt !== undefined && !text(item.sunsetAt))) return fail();
    deprecations.push({ contract: item.contract,
      ...(item.replacement === undefined ? {} : { replacement: item.replacement as string }),
      ...(item.sunsetAt === undefined ? {} : { sunsetAt: item.sunsetAt as string }),
    });
  }
  return {
    product: 'cloud', ...(value.productVersion === undefined ? {} : { productVersion: value.productVersion as string }),
    contractVersion: '1.0', apiContractVersions: [...value.apiContractVersions],
    interpreterContractVersions: [...value.interpreterContractVersions], sdkContractVersions: [...value.sdkContractVersions],
    capabilities, deprecations,
  };
}

export class CapabilitiesClient {
  private readonly transport: CloudTransport;

  constructor(resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    this.transport = new CloudTransport(resolveClient, config);
  }

  /** Workspace comes exclusively from the authenticated key. One POST, no automatic retries or caching. */
  async discover(): Promise<CapabilityDiscoverResponse> {
    if (arguments.length !== 0) throw new TypeError('Tier0 SDK: capability discovery accepts no arguments.');
    let response: Awaited<ReturnType<CloudTransport['post']>>;
    try {
      response = await this.transport.post('/openapi/v1/capabilities/discover', {});
    } catch (error) {
      if (!(error instanceof CloudTransportError)) throw error;
      throw new CapabilityError('Capability discovery HTTP exchange failed.', {
        status: error.status, errorCode: `CAPABILITY_${error.kind}`,
      });
    }
    const { value, status, ok } = response;
    if (!ok) {
      if (!record(value) || !text(value.errorCode) || typeof value.message !== 'string') {
        throw new CapabilityError('Invalid capability error response.', { status, errorCode: 'CAPABILITY_PROTOCOL_ERROR' });
      }
      throw new CapabilityError(value.message, { status, errorCode: value.errorCode });
    }
    return discovery(value, status);
  }
}

/** Uses configureClient()/runtime environment, resolving the host and workspace key on every call. */
export const capabilities = new CapabilitiesClient();
