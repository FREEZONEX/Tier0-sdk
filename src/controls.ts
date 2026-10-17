import { getClient, HttpClient, type ClientConfig } from './openapi/client.js';
import { CloudTransport, CloudTransportError, DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS } from './cloud-transport.js';
import { CapabilitiesClient } from './capabilities.js';
import { createUnsV2Client, type UnsV2Client } from './uns-v2/client.js';

/** Cloud Control contracts are independent of generated OpenAPI / Enterprise flow types. */
export type ControlJSON = null | boolean | number | string | ControlJSON[] | { [key: string]: ControlJSON };

export interface PublicControl {
  code: string;
  name: string;
  description: string;
  contractVersion: string;
  inputSchema: Record<string, ControlJSON>;
  outputSchema: Record<string, ControlJSON>;
  sideEffect: 'read' | 'write';
  idempotency: 'none' | 'optional' | 'required';
  timeoutMs: number;
  status: string;
}

export interface ControlDiscoverOptions {
  page?: number;
  size?: number;
  search?: string;
}

export interface ControlDiscoverResponse {
  total: number;
  list: PublicControl[];
}

/** HTTP transport budget only; never sent to the Gateway or used as a Control execution timeout. */
export interface ControlTransportConfig {
  /** Whole request including response body; positive integer milliseconds, default 60,000. */
  transportTimeoutMs?: number;
  /** UNS v2 only: response limit up to the fixed 20 MiB contract/RPC ceiling. */
  unsV2MaxResponseBytes?: number;
}

export interface CloudClientConfig extends ClientConfig, ControlTransportConfig {}

export const DEFAULT_CONTROL_TRANSPORT_TIMEOUT_MS = DEFAULT_CLOUD_TRANSPORT_TIMEOUT_MS;

export interface ControlInvokeOptions {
  /** Stable caller-owned key for one business intent, at most 128 UTF-8 bytes. Never generated or retried by the SDK. */
  idempotencyKey?: string;
}

export interface ControlInvokeResponse<Result = ControlJSON> {
  code: string;
  contractVersion: string;
  result: Result;
  runID: string;
  status: string;
  /** True only when the server explicitly reports an idempotent replay. */
  replayed: boolean;
}

export interface ControlErrorInfo {
  /** HTTP status, absent when no HTTP response was received. */
  status?: number;
  /** Gateway string errorCode, or an SDK-local CONTROL_* transport/protocol code. */
  errorCode: string;
  runID?: string;
  contractVersion?: string;
  runStatus?: string;
  replayed?: boolean;
}

/** No Control error is automatically retried, including authentication failures. */
export class ControlError extends Error {
  readonly status?: number;
  readonly errorCode: string;
  readonly runID?: string;
  readonly contractVersion?: string;
  readonly runStatus?: string;
  readonly replayed?: boolean;
  readonly retryable = false;

  constructor(message: string, info: ControlErrorInfo) {
    super(message);
    this.name = 'ControlError';
    this.status = info.status;
    this.errorCode = info.errorCode;
    this.runID = info.runID;
    this.contractVersion = info.contractVersion;
    this.runStatus = info.runStatus;
    this.replayed = info.replayed;
  }
}

/** Execution may have happened. Reconcile run information; any deliberate replay must reuse the same key. */
export class ControlResultUnknownError extends ControlError {
  readonly outcomeUnknown = true;

  constructor(info: ControlErrorInfo) {
    super('Control result is unknown; execution may have occurred. Do not automatically retry.', info);
    this.name = 'ControlResultUnknownError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: unknown, allowed: string[]): void {
  if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new TypeError('Tier0 SDK: unsupported Control option.');
  }
}

function json(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }
  seen.add(value);
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every(item => json(item, seen));
  seen.delete(value);
  return valid;
}

function definition(value: unknown): value is PublicControl {
  if (!record(value)) return false;
  return ['code', 'name', 'description', 'contractVersion', 'status'].every(key => typeof value[key] === 'string') &&
    value.code !== '' && value.contractVersion !== '' && record(value.inputSchema) && record(value.outputSchema) &&
    ['read', 'write'].includes(value.sideEffect as string) &&
    ['none', 'optional', 'required'].includes(value.idempotency as string) &&
    typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0;
}

function runInfo(value: unknown): Partial<ControlErrorInfo> {
  if (!record(value)) return {};
  return {
    runID: typeof value.runID === 'string' ? value.runID : undefined,
    contractVersion: typeof value.contractVersion === 'string' ? value.contractVersion : undefined,
    runStatus: typeof value.status === 'string' ? value.status : undefined,
    replayed: typeof value.replayed === 'boolean' ? value.replayed : undefined,
  };
}

export interface ControlHandle<Input = ControlJSON, Result = ControlJSON> {
  describe(): Promise<PublicControl>;
  /**
   * One POST only. Input is opaque business JSON, including fields named streamId,
   * entryId, deploymentVersion or timeoutMs. Only the server chooses binding/version/timeout.
   * Generic types are caller assertions; the server validates the contract schemas.
   */
  invoke(input: Input, options?: ControlInvokeOptions): Promise<ControlInvokeResponse<Result>>;
}

export class ControlsClient {
  private readonly transport: CloudTransport;

  constructor(resolveClient: () => HttpClient = getClient, config: ControlTransportConfig = {}) {
    this.transport = new CloudTransport(resolveClient, config);
  }

  private async post(path: string, body: unknown, invoked: boolean): Promise<{ value: unknown; status: number }> {
    let response: Awaited<ReturnType<CloudTransport['post']>>;
    try {
      response = await this.transport.post(path, body);
    } catch (error) {
      if (!(error instanceof CloudTransportError)) throw error;
      const info = { status: error.status, errorCode: `CONTROL_${error.kind}` };
      if (invoked) throw new ControlResultUnknownError(info);
      const message = error.kind === 'TRANSPORT_TIMEOUT' ? 'Control HTTP transport deadline exceeded.' :
        error.kind === 'PROTOCOL_ERROR' ? 'Invalid Control response.' : 'Control transport failed.';
      throw new ControlError(message, info);
    }
    const { value, status, ok } = response;
    if (!ok) {
      const error = record(value) ? value : {};
      const valid = typeof error.errorCode === 'string' && typeof error.message === 'string';
      const info: ControlErrorInfo = {
        ...runInfo(value), status,
        errorCode: valid ? error.errorCode as string : 'CONTROL_PROTOCOL_ERROR',
      };
      if (info.errorCode === 'CONTROL_RESULT_UNKNOWN' || (invoked && !valid)) {
        throw new ControlResultUnknownError(info);
      }
      throw new ControlError(valid ? error.message as string : 'Invalid Control error response.', info);
    }
    return { value, status };
  }

  /** Discover visible contracts; defaults and authorization are resolved by the server. */
  async discover(options: ControlDiscoverOptions = {}): Promise<ControlDiscoverResponse> {
    keys(options, ['page', 'size', 'search']);
    if ((options.page !== undefined && (!Number.isSafeInteger(options.page) || options.page < 1)) ||
        (options.size !== undefined && (!Number.isSafeInteger(options.size) || options.size < 1 || options.size > 200)) ||
        (options.search !== undefined && typeof options.search !== 'string')) {
      throw new TypeError('Tier0 SDK: invalid Control discovery options.');
    }
    const { value, status } = await this.post('/openapi/v1/controls/discover', options, false);
    if (!record(value) || !Number.isSafeInteger(value.total) || (value.total as number) < 0 ||
        !Array.isArray(value.list) || !value.list.every(definition)) {
      throw new ControlError('Invalid Control discovery response.', { status, errorCode: 'CONTROL_PROTOCOL_ERROR' });
    }
    return value as unknown as ControlDiscoverResponse;
  }

  use<Input = ControlJSON, Result = ControlJSON>(selector: { code: string }): ControlHandle<Input, Result> {
    keys(selector, ['code']);
    const code = selector.code;
    if (typeof code !== 'string' || code.length > 128 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(code)) {
      throw new TypeError('Tier0 SDK: invalid Control code.');
    }
    const path = `/openapi/v1/controls/${encodeURIComponent(code)}`;
    return {
      describe: async () => {
        const { value, status } = await this.post(`${path}/describe`, {}, false);
        if (!definition(value) || value.code !== code) {
          throw new ControlError('Invalid Control description.', { status, errorCode: 'CONTROL_PROTOCOL_ERROR' });
        }
        return value;
      },
      invoke: async (input, options = {}) => {
        keys(options, ['idempotencyKey']);
        const key = options.idempotencyKey;
        if (key !== undefined && (typeof key !== 'string' || !key || key.trim() !== key || new TextEncoder().encode(key).length > 128)) {
          throw new TypeError('Tier0 SDK: invalid Control idempotency key.');
        }
        if (!json(input)) throw new TypeError('Tier0 SDK: Control input must be JSON.');
        const { value, status } = await this.post(`${path}/invoke`, {
          input, ...(key === undefined ? {} : { idempotencyKey: key }),
        }, true);
        if (!record(value) || value.code !== code || typeof value.contractVersion !== 'string' || !value.contractVersion ||
            !Object.prototype.hasOwnProperty.call(value, 'result') || typeof value.runID !== 'string' || !value.runID ||
            typeof value.status !== 'string' || !value.status || ['accepted', 'queued', 'pending', 'running'].includes(value.status) ||
            typeof value.replayed !== 'boolean') {
          throw new ControlResultUnknownError({ ...runInfo(value), status, errorCode: 'CONTROL_PROTOCOL_ERROR' });
        }
        return value as unknown as ControlInvokeResponse<Result>;
      },
    };
  }
}

/** Uses configureClient()/TIER0_API_HOST/TIER0_API_KEY, resolved for every call. */
export const controls = new ControlsClient();

/**
 * Isolated Cloud client using the existing ClientConfig host/key/runtime callbacks.
 * transportTimeoutMs bounds HTTP headers and body reading (default 60s); it does not
 * change the server execution contract. An invoke deadline means result unknown.
 * No global configuration changes, credential refresh, retries or generated API changes.
 */
export function createClient(config: CloudClientConfig = {}): {
  controls: ControlsClient;
  capabilities: CapabilitiesClient;
  unsV2: UnsV2Client;
} {
  const http = new HttpClient(config);
  const resolveClient = () => http;
  return {
    controls: new ControlsClient(resolveClient, config),
    capabilities: new CapabilitiesClient(resolveClient, config),
    unsV2: createUnsV2Client(resolveClient, config),
  };
}
