import {
  CloudTransport,
  CloudTransportError,
  UNS_V2_MAX_REQUEST_BYTES,
  type CloudTransportConfig,
} from '../cloud-transport.js';
import { getClient, type HttpClient } from '../openapi/client.js';
import { decodeUnsV2JSON, encodeUnsV2JSON } from './codec.js';
import { recordSubscription, type RecordSubscribeRequest, type RecordSubscribeFrame } from './subscribe.js';
export type { RecordSubscribeRequest, RecordSubscribeFrame } from './subscribe.js';
import {
  UNS_V2_OPERATIONS,
  type ErrorRetry,
  type Fault,
  type UnsV2OperationName,
  type UnsV2Operations,
  type UnsV2Request,
  type UnsV2Response,
} from './generated.js';

type RecordValue = Record<string, unknown>;

export interface UnsV2ErrorInfo {
  status?: number;
  operation: UnsV2OperationName;
  code: string;
  requestId?: string;
  retryable: boolean;
  retry?: ErrorRetry;
  execution?: Fault['execution'];
  opId?: string;
  path?: string;
  details?: RecordValue[];
  repair?: string;
  reason?: string;
  queryId?: string;
  data?: unknown;
  fault?: Fault;
}

/** Server advice is exposed verbatim. The SDK never acts on it or retries a request. */
export class UnsV2Error extends Error implements UnsV2ErrorInfo {
  readonly status?: number;
  readonly operation: UnsV2OperationName;
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly retry?: ErrorRetry;
  readonly execution?: Fault['execution'];
  readonly opId?: string;
  readonly path?: string;
  readonly details?: RecordValue[];
  readonly repair?: string;
  readonly reason?: string;
  readonly queryId?: string;
  readonly data?: unknown;
  readonly fault?: Fault;

  constructor(message: string, info: UnsV2ErrorInfo) {
    super(message);
    this.name = 'UnsV2Error';
    Object.assign(this, info);
    this.status = info.status;
    this.operation = info.operation;
    this.code = info.code;
    this.retryable = info.retryable;
  }
}

/** A mutating request may have reached the service. Reconcile before any deliberate replay. */
export class UnsV2OutcomeUnknownError extends UnsV2Error {
  readonly outcomeUnknown = true;
  constructor(message: string, info: UnsV2ErrorInfo) {
    super(message, info);
    this.name = 'UnsV2OutcomeUnknownError';
  }
}

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resourcePath(operation: { path: string; readonly pathParams: readonly string[] }, request: unknown): string {
  let path = operation.path;
  for (const key of operation.pathParams) {
    const value = record(request) && Object.prototype.hasOwnProperty.call(request, key) ? request[key] : undefined;
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
        value === '.' || value === '..' || /[/\\\u0000-\u001f\u007f]/.test(value)) {
      throw new TypeError(`Tier0 SDK: invalid UNS v2 path identity ${key}.`);
    }
    path = path.replace(`:${key}`, encodeURIComponent(value));
  }
  return path;
}

function errorInfo(value: unknown, status: number, operation: UnsV2OperationName): UnsV2ErrorInfo | undefined {
  if (!record(value) || !record(value.error)) return undefined;
  const fault = value.error;
  if (typeof fault.code !== 'string' || typeof fault.reason !== 'string' || !Array.isArray(fault.details) ||
      !fault.details.every(record) || !['notStarted', 'rolledBack', 'committed', 'unknown'].includes(String(fault.execution)) ||
      !record(fault.retry) || typeof fault.retry.safe !== 'boolean' ||
      (fault.retry.afterMs !== undefined && (typeof fault.retry.afterMs !== 'number' || !Number.isSafeInteger(fault.retry.afterMs) || fault.retry.afterMs < 0))) return undefined;
  return {
    status, operation, code: fault.code,
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    retryable: fault.retry.safe, retry: fault.retry as ErrorRetry, execution: fault.execution as Fault['execution'],
    details: fault.details, data: value.data, fault: fault as Fault,
    ...Object.fromEntries(['opId', 'path', 'repair', 'reason', 'queryId'].flatMap(key =>
      typeof fault[key] === 'string' ? [[key, fault[key]]] : [])),
  };
}

export class UnsV2ClientCore {
  private readonly transport: CloudTransport;

  constructor(resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}) {
    this.transport = new CloudTransport(resolveClient, config);
  }

  /** GET/SSE, with an explicit resume cursor and no automatic reconnect. */
  async *recordSubscribe(request: RecordSubscribeRequest = {}, options: { signal?: AbortSignal } = {}): AsyncGenerator<RecordSubscribeFrame> {
    try {
      yield* recordSubscription(this.transport, request, options.signal);
    } catch (error) {
      if (!(error instanceof CloudTransportError)) throw error;
      let info: UnsV2ErrorInfo | undefined;
      if (error.responseText && error.status !== undefined) {
        try {
          const value = decodeUnsV2JSON(error.responseText, 'UnsV2ErrorResponse');
          if (record(value) && value.code === error.status) info = errorInfo(value, error.status, 'recordSubscribe');
        } catch { /* Report a redacted protocol error. */ }
      }
      throw new UnsV2Error('UNS v2 subscription failed.', info || {
        status: error.status, operation: 'recordSubscribe', code: `UNS_V2_${error.kind}`, retryable: false,
      });
    }
  }

  async call<Name extends Exclude<UnsV2OperationName, 'recordSubscribe'>>(name: Name, request: UnsV2Request<Name>): Promise<UnsV2Response<Name>> {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(UNS_V2_OPERATIONS, name)) {
      throw new TypeError('Tier0 SDK: unknown UNS v2 operation.');
    }
    const operation = UNS_V2_OPERATIONS[name];
    if (operation.method !== 'POST') throw new TypeError('Tier0 SDK: use recordSubscribe for SSE.');
    const mutation = operation.mutation;
    const path = resourcePath(operation, request);
    const body = encodeUnsV2JSON(request, operation.request);
    if (new TextEncoder().encode(body).byteLength > UNS_V2_MAX_REQUEST_BYTES) {
      throw new TypeError('Tier0 SDK: UNS v2 request body exceeds the 16777216-byte contract limit.');
    }
    let response: Awaited<ReturnType<CloudTransport['postText']>>;
    try {
      response = await this.transport.postText(path, body);
    } catch (error) {
      if (!(error instanceof CloudTransportError)) throw error;
      const info: UnsV2ErrorInfo = {
        status: error.status,
        operation: name,
        code: `UNS_V2_${error.kind}`,
        retryable: false,
      };
      const message = error.kind === 'TRANSPORT_TIMEOUT'
        ? 'UNS v2 HTTP transport deadline exceeded.'
        : error.kind === 'PROTOCOL_ERROR' ? 'Invalid UNS v2 HTTP response.' : 'UNS v2 transport failed.';
      if (mutation) throw new UnsV2OutcomeUnknownError(message, info);
      throw new UnsV2Error(message, info);
    }

    let value: unknown;
    try {
      value = decodeUnsV2JSON(response.text, response.status === 200 ? operation.response : 'UnsV2ErrorResponse');
    } catch {
      const info: UnsV2ErrorInfo = {
        status: response.status,
        operation: name,
        code: 'UNS_V2_PROTOCOL_ERROR',
        retryable: false,
      };
      if (mutation) throw new UnsV2OutcomeUnknownError('Invalid UNS v2 response.', info);
      throw new UnsV2Error('Invalid UNS v2 response.', info);
    }

    if (response.status !== 200) {
      const info = errorInfo(value, response.status, name);
      if (!info || !record(value) || value.code !== response.status) {
        const invalid: UnsV2ErrorInfo = {
          status: response.status,
          operation: name,
          code: 'UNS_V2_PROTOCOL_ERROR',
          retryable: false,
        };
        if (mutation) throw new UnsV2OutcomeUnknownError('Invalid UNS v2 error response.', invalid);
        throw new UnsV2Error('Invalid UNS v2 error response.', invalid);
      }
      const message = record(value) && typeof value.msg === 'string' ? value.msg : info.code;
      if (mutation && info.execution === 'unknown') throw new UnsV2OutcomeUnknownError(message, info);
      if (!mutation && info.execution === 'unknown') throw new UnsV2Error('Invalid read execution outcome.', { status: response.status, operation: name, code: 'UNS_V2_PROTOCOL_ERROR', retryable: false });
      throw new UnsV2Error(message, info);
    }

    if (!record(value) || value.code !== 200 || typeof value.msg !== 'string' ||
        typeof value.requestId !== 'string' || !Object.prototype.hasOwnProperty.call(value, 'data')) {
      const info: UnsV2ErrorInfo = {
        status: response.status,
        operation: name,
        code: 'UNS_V2_PROTOCOL_ERROR',
        retryable: false,
      };
      if (mutation) throw new UnsV2OutcomeUnknownError('Invalid UNS v2 success envelope.', info);
      throw new UnsV2Error('Invalid UNS v2 success envelope.', info);
    }
    return value as UnsV2Response<Name>;
  }
}

export type UnsV2Client = UnsV2ClientCore & UnsV2Operations;

export function createUnsV2Client(resolveClient: () => HttpClient = getClient, config: CloudTransportConfig = {}): UnsV2Client {
  const core = new UnsV2ClientCore(resolveClient, config);
  const methods = Object.fromEntries(Object.keys(UNS_V2_OPERATIONS).filter(name => name !== 'recordSubscribe').map(name => [name, (request: unknown) =>
    core.call(name as Exclude<UnsV2OperationName, 'recordSubscribe'>, request as UnsV2Request<Exclude<UnsV2OperationName, 'recordSubscribe'>>)]));
  return Object.assign(core, methods) as unknown as UnsV2Client;
}

/** Uses configureClient()/TIER0_API_HOST/TIER0_API_KEY and does not imply v2 readiness. */
export const unsV2 = createUnsV2Client();
