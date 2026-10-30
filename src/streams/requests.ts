import { StreamTransport, StreamTransportError, DEFAULT_STREAM_TRANSPORT_TIMEOUT_MS, type StreamTransportConfig } from './transport.js';
import type { components } from './contract.generated.js';
/** Public request contracts do not expose runtime bindings. */
export type StreamJSON = null | boolean | number | string | StreamJSON[] | { [key: string]: StreamJSON };

export interface PublicStreamRequest extends Omit<components['schemas']['PublicStreamRequest'], 'inputSchema' | 'outputSchema' | 'sideEffect' | 'idempotency'> {
  code: string;
  name: string;
  description: string;
  contractVersion: string;
  inputSchema: Record<string, StreamJSON>;
  outputSchema: Record<string, StreamJSON>;
  sideEffect: 'read' | 'write';
  idempotency: 'none' | 'optional' | 'required';
  timeoutMs: number;
  status: string;
}

type WireDiscovery = components['schemas']['StreamRequestDiscoverReq'];
export interface StreamRequestDiscoverOptions extends WireDiscovery {
  page?: number;
  size?: number;
  search?: string;
}

export interface StreamRequestDiscoverResponse {
  total: number;
  list: PublicStreamRequest[];
}

/** HTTP transport settings do not override server execution semantics. */
export interface StreamRequestTransportConfig extends StreamTransportConfig {}

export const DEFAULT_STREAM_REQUEST_TRANSPORT_TIMEOUT_MS = DEFAULT_STREAM_TRANSPORT_TIMEOUT_MS;

export interface StreamRequestInvokeOptions {
  /** Stable caller-owned key for one business intent, at most 128 UTF-8 bytes. Never generated or retried by the SDK. */
  idempotencyKey?: string;
}

export interface StreamRequestInvokeResponse<Result = StreamJSON> extends Omit<components['schemas']['StreamRequestInvokeResp'], 'result' | 'status'> {
  code: string;
  contractVersion: string;
  result: Result;
  runID: string;
  /** Persisted request ledger success; all other states reject conservatively. */
  status: 'completed';
  /** True only when the server explicitly reports an idempotent replay. */
  replayed: boolean;
}

export interface StreamRequestErrorInfo {
  /** HTTP status, absent when no HTTP response was received. */
  status?: number;
  /** Gateway string errorCode, or an SDK-local STREAM_REQUEST_* transport/protocol code. */
  errorCode: string;
  runID?: string;
  contractVersion?: string;
  runStatus?: string;
  replayed?: boolean;
}

/** No StreamRequest error is automatically retried, including authentication failures. */
export class StreamRequestError extends Error {
  readonly status?: number;
  readonly errorCode: string;
  readonly runID?: string;
  readonly contractVersion?: string;
  readonly runStatus?: string;
  readonly replayed?: boolean;
  readonly retryable = false;
  readonly outcomeUnknown: boolean = false;

  constructor(message: string, info: StreamRequestErrorInfo) {
    super(message);
    this.name = 'StreamRequestError';
    this.status = info.status;
    this.errorCode = info.errorCode;
    this.runID = info.runID;
    this.contractVersion = info.contractVersion;
    this.runStatus = info.runStatus;
    this.replayed = info.replayed;
  }
}

/** Execution may have happened. Reconcile run information; any deliberate replay must reuse the same key. */
export class StreamRequestResultUnknownError extends StreamRequestError {
  readonly outcomeUnknown = true;

  constructor(info: StreamRequestErrorInfo) {
    super('StreamRequest result is unknown; execution may have occurred. Do not automatically retry.', info);
    this.name = 'StreamRequestResultUnknownError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: unknown, allowed: string[]): void {
  if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new TypeError('Tier0 SDK: unsupported StreamRequest option.');
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

function definition(value: unknown): value is PublicStreamRequest {
  if (!record(value)) return false;
  return ['code', 'name', 'description', 'contractVersion', 'status'].every(key => typeof value[key] === 'string') &&
    value.code !== '' && value.contractVersion !== '' && record(value.inputSchema) && record(value.outputSchema) &&
    ['read', 'write'].includes(value.sideEffect as string) &&
    ['none', 'optional', 'required'].includes(value.idempotency as string) &&
    typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0;
}

function runInfo(value: unknown): Partial<StreamRequestErrorInfo> {
  if (!record(value)) return {};
  return {
    runID: typeof value.runID === 'string' ? value.runID : undefined,
    contractVersion: typeof value.contractVersion === 'string' ? value.contractVersion : undefined,
    runStatus: typeof value.status === 'string' ? value.status : undefined,
    replayed: typeof value.replayed === 'boolean' ? value.replayed : undefined,
  };
}

export interface StreamRequestHandle<Input = StreamJSON, Result = StreamJSON> {
  describe(): Promise<PublicStreamRequest>;
  /**
   * One POST only. Input is opaque business JSON, including fields named streamId,
   * entryId, deploymentVersion or timeoutMs. Only the server chooses binding/version/timeout.
   * Generic types are caller assertions; the server validates the contract schemas.
   */
  invoke(input: Input, options?: StreamRequestInvokeOptions): Promise<StreamRequestInvokeResponse<Result>>;
}

export class StreamRequestsClient {
  private readonly transport: StreamTransport;

  constructor(transport = new StreamTransport()) {
    this.transport = transport;
  }

  private async post(path: string, body: unknown, invoked: boolean): Promise<{ value: unknown; status: number }> {
    let response: Awaited<ReturnType<StreamTransport['post']>>;
    try {
      response = await this.transport.post(path, body);
    } catch (error) {
      if (!(error instanceof StreamTransportError)) throw error;
      const info = { status: error.status, errorCode: `STREAM_REQUEST_${error.kind}` };
      if (invoked) throw new StreamRequestResultUnknownError(info);
      const message = error.kind === 'TRANSPORT_TIMEOUT' ? 'StreamRequest HTTP transport deadline exceeded.' :
        error.kind === 'PROTOCOL_ERROR' ? 'Invalid StreamRequest response.' : 'StreamRequest transport failed.';
      throw new StreamRequestError(message, info);
    }
    const { value, status, ok } = response;
    if (!ok) {
      const error = record(value) ? value : {};
      const valid = typeof error.errorCode === 'string' && typeof error.message === 'string';
      const info: StreamRequestErrorInfo = {
        ...runInfo(value), status,
        errorCode: valid ? error.errorCode as string : 'STREAM_REQUEST_PROTOCOL_ERROR',
      };
      if (info.errorCode === 'STREAM_REQUEST_RESULT_UNKNOWN' || (invoked && !valid)) {
        throw new StreamRequestResultUnknownError(info);
      }
      throw new StreamRequestError(valid ? error.message as string : 'Invalid StreamRequest error response.', info);
    }
    return { value, status };
  }

  /** Discover visible contracts; defaults and authorization are resolved by the server. */
  async discover(options: StreamRequestDiscoverOptions = {}): Promise<StreamRequestDiscoverResponse> {
    keys(options, ['page', 'size', 'search']);
    if ((options.page !== undefined && (!Number.isSafeInteger(options.page) || options.page < 1)) ||
        (options.size !== undefined && (!Number.isSafeInteger(options.size) || options.size < 1 || options.size > 200)) ||
        (options.search !== undefined && typeof options.search !== 'string')) {
      throw new TypeError('Tier0 SDK: invalid StreamRequest discovery options.');
    }
    const { value, status } = await this.post('/openapi/v2/stream-requests/discover', options, false);
    if (!record(value) || !Number.isSafeInteger(value.total) || (value.total as number) < 0 ||
        !Array.isArray(value.list) || !value.list.every(definition)) {
      throw new StreamRequestError('Invalid StreamRequest discovery response.', { status, errorCode: 'STREAM_REQUEST_PROTOCOL_ERROR' });
    }
    return value as unknown as StreamRequestDiscoverResponse;
  }

  use<Input = StreamJSON, Result = StreamJSON>(selector: { code: string }): StreamRequestHandle<Input, Result> {
    keys(selector, ['code']);
    const code = selector.code;
    if (typeof code !== 'string' || code.length > 128 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(code)) {
      throw new TypeError('Tier0 SDK: invalid StreamRequest code.');
    }
    const path = `/openapi/v2/stream-requests/${encodeURIComponent(code)}`;
    return {
      describe: async () => {
        const { value, status } = await this.post(`${path}/describe`, {}, false);
        if (!definition(value) || value.code !== code) {
          throw new StreamRequestError('Invalid StreamRequest description.', { status, errorCode: 'STREAM_REQUEST_PROTOCOL_ERROR' });
        }
        return value;
      },
      invoke: async (input, options = {}) => {
        keys(options, ['idempotencyKey']);
        const key = options.idempotencyKey;
        if (key !== undefined && (typeof key !== 'string' || !key || key.trim() !== key || new TextEncoder().encode(key).length > 128)) {
          throw new TypeError('Tier0 SDK: invalid StreamRequest idempotency key.');
        }
        if (!json(input)) throw new TypeError('Tier0 SDK: StreamRequest input must be JSON.');
        const { value, status } = await this.post(`${path}/invoke`, {
          input, ...(key === undefined ? {} : { idempotencyKey: key }),
        }, true);
        if (!record(value) || value.code !== code || typeof value.contractVersion !== 'string' || !value.contractVersion ||
            !Object.prototype.hasOwnProperty.call(value, 'result') || typeof value.runID !== 'string' || !value.runID ||
            value.status !== 'completed' ||
            typeof value.replayed !== 'boolean') {
          throw new StreamRequestResultUnknownError({ ...runInfo(value), status, errorCode: 'STREAM_REQUEST_PROTOCOL_ERROR' });
        }
        return value as unknown as StreamRequestInvokeResponse<Result>;
      },
    };
  }
}
