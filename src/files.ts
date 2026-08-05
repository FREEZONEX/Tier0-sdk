import { getClient, ApiError, type HttpClient } from './openapi/client.js';

/**
 * 文件可见性：
 * - public:  长期有效公开 URL
 * - private: 访问需签名（presigned URL，带过期时间）
 */
export type Visibility = 'public' | 'private';

/**
 * 文件归属粒度：
 * - user:      用户私有文件
 * - workspace: 工作空间文件
 * - platform:  平台级文件
 */
export type UseBy = 'user' | 'workspace' | 'platform';

export interface UploadOptions {
  /** 业务场景标识，如 attachment / avatar / notebook */
  business?: string;
  /** 用途，不传时由后端裁定 */
  useBy?: UseBy;
  /** 可见性，不传时由后端裁定（默认 private） */
  visibility?: Visibility;
  /** AI 生成应用实例 ID，用于应用级隔离与孤儿文件清理 */
  appInstanceId?: string;
  /** AI 生成应用会话 ID */
  sessionId?: string;
  /** 请求取消信号 */
  signal?: AbortSignal;
  /**
   * multipart 分片上传参数：大文件（>100MB）自动启用分片直传；
   * 小文件显式传入本字段同样走分片（用于测试或自定义分片大小）。
   */
  multipart?: MultipartOptions;
}

export interface UploadResult {
  /** 后端文件记录 ID（若返回） */
  fileId?: string;
  /** 存储对象 key，业务系统保存此字段即可 */
  filePath: string;
  /** public：长期有效公开 URL；private：上传时可能为空或 presigned URL */
  fileUrl: string;
  /** 本次上传使用的 presigned POST URL（POST policy 上传入口） */
  postUrl: string;
  /** POST 上传表单字段，全部需先写入 multipart 表单，`file` 字段必须最后 */
  postFields: Record<string, string>;
  /** presigned URL 过期时间戳（毫秒） */
  expiresAt?: number;
}

/** 文件大小超过该阈值（字节）时 `uploadFile` 自动切换 multipart 分片直传：>100MB */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
/** multipart 分片默认大小（字节）：8MB */
export const DEFAULT_MULTIPART_PART_SIZE = 8 * 1024 * 1024;
/** S3 兼容对象存储 multipart 非末片的最小分片大小（字节）：5MB，小于该值 complete 会被拒（EntityTooSmall） */
export const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
/** multipart 分片默认并发上传数 */
export const DEFAULT_MULTIPART_CONCURRENCY = 4;
/** 单片上传失败的最大重试次数（不含首次请求） */
export const MULTIPART_MAX_RETRIES = 3;
/** 单片上传单次请求超时（毫秒）：60s */
export const MULTIPART_PART_TIMEOUT_MS = 60_000;

/** multipart 分片上传进度信息 */
export interface MultipartProgress {
  /** 已完成分片数 */
  doneParts: number;
  /** 总分片数 */
  totalParts: number;
  /** 已上传字节数 */
  uploadedBytes: number;
  /** 进度百分比（0-100） */
  percent: number;
}

/** multipart 分片上传进度回调，每完成一片调用一次 */
export type MultipartProgressCallback = (progress: MultipartProgress) => void;

/** 已完成的分片（complete 时上报后端） */
export interface MultipartPart {
  /** 分片序号，从 1 开始 */
  partNumber: number;
  /** 对象存储返回的 ETag */
  etag: string;
}

/** multipart 分片上传子选项，挂在 `uploadFile` 的 `options.multipart` 上 */
export interface MultipartOptions {
  /** 分片大小（字节），默认 8MB；低于 5MB 会自动抬升到 5MB（S3 最小分片限制） */
  partSize?: number;
  /** 并发上传分片数，默认 4 */
  concurrency?: number;
  /** 进度回调：每完成一片调用一次 */
  onProgress?: MultipartProgressCallback;
  /** 失败（分片重试耗尽 / complete 失败）时保留会话以便续传；默认 false：自动 abort 清理 */
  retainSessionOnFailure?: boolean;
}

/** `uploadFileMultipart` 的选项：`UploadOptions` 基础上增加分片参数 */
export interface MultipartUploadOptions extends UploadOptions {
  /** 分片大小（字节），默认 8MB；低于 5MB 会自动抬升到 5MB（S3 最小分片限制） */
  partSize?: number;
  /** 并发上传分片数，默认 4 */
  concurrency?: number;
  /** 进度回调：每完成一片调用一次 */
  onProgress?: MultipartProgressCallback;
  /** 失败（分片重试耗尽 / complete 失败）时保留会话以便续传；默认 false：自动 abort 清理 */
  retainSessionOnFailure?: boolean;
}

/**
 * multipart 分片上传结果，字段与 `uploadFile` 对齐：
 * `postUrl`/`postFields` 仅适用于单发 presigned POST，分片直传场景恒为空。
 */
export interface MultipartUploadResult extends UploadResult {
  /** 分片会话 uploadId，可用于 abort/后续续传 */
  uploadId: string;
  /** 上传完成后后端返回的文件大小（字节） */
  sizeBytes: number;
}

/**
 * 失败会话的公开结构：`MultipartUploadError.multipartSession` 携带，调用方可持久化后
 * 经 `resumeMultipartUpload` 断点续传（跳过 `completedParts`，仅续传缺失分片）。
 */
export interface MultipartResumeSession {
  /** 存储对象 key（init 返回） */
  fileKey: string;
  /** 分片会话 ID（init 返回） */
  uploadId: string;
  /** 后端裁定的分片大小（字节），续传切片必须沿用 */
  partSize: number;
  /** 已完成分片（partNumber -> etag），续传时跳过 */
  completedParts: MultipartPart[];
}

/**
 * multipart 分片上传失败时抛出的结构化错误：`ApiError` 子类，语义与 `ApiError` 完全一致
 * （status/code/msg 可机读）。`retainSessionOnFailure: true` 且失败发生在分片上传或
 * complete 阶段时，携带 `multipartSession` 供调用方断点续传。
 */
export class MultipartUploadError extends ApiError {
  /** 失败时的会话快照（含已完成分片）；未保留会话时为空 */
  readonly multipartSession?: MultipartResumeSession;

  constructor(status: number, code: number, msg: string, multipartSession?: MultipartResumeSession) {
    super(status, code, msg);
    this.name = 'MultipartUploadError';
    this.multipartSession = multipartSession;
  }
}

/** `resumeMultipartUpload` 的选项 */
export interface ResumeMultipartUploadOptions {
  /** 并发上传分片数，默认 4 */
  concurrency?: number;
  /** 进度回调：每完成一片调用一次 */
  onProgress?: MultipartProgressCallback;
  /** 请求取消信号 */
  signal?: AbortSignal;
  /** 续传再次失败时是否再次保留会话（默认 false：自动 abort 清理） */
  retainSessionOnFailure?: boolean;
}

/**
 * 判断是否需要走 multipart 分片直传：
 * 大文件（>100MB）自动启用；小文件显式传入 `multipart` 选项也启用。
 */
export function shouldUseMultipart(fileSize: number, multipart?: MultipartOptions): boolean {
  return fileSize > MULTIPART_THRESHOLD_BYTES || multipart !== undefined;
}

interface MultipartInitApiResp {
  fileKey?: string;
  filePath?: string;
  uploadId?: string;
  partSize?: number;
  partCount?: number;
  expiresAt?: number;
}

interface MultipartPartUrlItem {
  partNumber?: number;
  url?: string;
  expiresAt?: number;
}

interface MultipartPartUrlApiResp {
  partUrls?: MultipartPartUrlItem[];
}

interface MultipartCompleteApiResp {
  fileId?: string | number;
  filePath?: string;
  fileUrl?: string;
  sizeBytes?: number;
  expiresAt?: number;
}

/**
 * 分片上传会话状态：uploadId + 已完成分片（partNumber -> etag）。
 * 本版仅内存实现断点续传，不做跨进程持久化。
 */
interface MultipartSession {
  fileKey: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  completed: Map<number, string>;
}

/** 将外层 signal 与固定超时合并为单个 signal（Node18 无 AbortSignal.any，手写合并），返回清理函数 */
function withTimeoutSignal(
  outer: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) {
      controller.abort(outer.reason);
    } else {
      outer.addEventListener('abort', onOuterAbort, { once: true });
    }
  }
  const timer = setTimeout(
    () => controller.abort(new Error(`Tier0 SDK: request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    },
  };
}

/** 指数退避延迟（毫秒），带少量随机抖动，避免同批分片同时重试 */
function backoffDelay(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 手写并发池：最多 limit 个任务并行，按输入顺序返回结果，不引入额外依赖 */
async function mapWithConcurrency<T>(inputs: number[], limit: number, task: (input: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(inputs.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, inputs.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++;
      results[index] = await task(inputs[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 单次 PUT 分片到对象存储，成功返回 ETag；非 2xx 抛结构化 ApiError（status/code/msg 可机读） */
async function putPart(url: string, body: Blob, timeoutMs: number, outerSignal?: AbortSignal): Promise<string> {
  const { signal, cleanup } = withTimeoutSignal(outerSignal, timeoutMs);
  try {
    const resp = await fetch(url, { method: 'PUT', body, signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => 'Unknown error');
      let code = 0;
      let msg = text;
      try {
        // 网关风格 JSON 错误体携带 code/msg；对象存储（S3/RustFS）多为 XML，保留原文
        const parsed = JSON.parse(text) as { code?: unknown; msg?: unknown };
        if (parsed && typeof parsed === 'object' && typeof parsed.msg === 'string' && parsed.msg) {
          msg = parsed.msg;
          code = typeof parsed.code === 'number' ? parsed.code : 0;
        }
      } catch {
        // 非 JSON 响应体，兜底原文
      }
      throw new ApiError(resp.status, code, msg);
    }
    const etag = resp.headers.get('etag') ?? '';
    if (!etag) {
      throw new Error('Tier0 SDK: part upload response missing ETag header');
    }
    return etag;
  } finally {
    cleanup();
  }
}

/** 单片上传带指数退避重试（最多 maxRetries 次重试）；用户主动 abort 不重试 */
async function putPartWithRetry(url: string, body: Blob, maxRetries: number, outerSignal?: AbortSignal): Promise<string> {
  let lastError: unknown;
  const maxAttempts = maxRetries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await putPart(url, body, MULTIPART_PART_TIMEOUT_MS, outerSignal);
    } catch (err) {
      lastError = err;
      if (outerSignal?.aborted) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await sleep(backoffDelay(attempt));
      }
    }
  }
  throw lastError;
}

/** 并发上传全部未完成分片：已完成分片跳过（断点续传），返回按 partNumber 升序的 parts */
async function uploadPartsWithResume(
  file: File,
  session: MultipartSession,
  partUrls: Map<number, string>,
  concurrency: number,
  maxRetries: number,
  onProgress?: MultipartProgressCallback,
  signal?: AbortSignal
): Promise<MultipartPart[]> {
  const partNumbers = Array.from({ length: session.partCount }, (_, i) => i + 1);
  let doneParts = session.completed.size;
  let uploadedBytes = doneParts * session.partSize;

  await mapWithConcurrency(partNumbers, concurrency, async (partNumber) => {
    // 断点续传：已完成分片不再重传
    if (session.completed.has(partNumber)) {
      return;
    }
    const url = partUrls.get(partNumber);
    if (!url) {
      throw new Error(`Tier0 SDK: missing upload URL for part ${partNumber}`);
    }
    const offset = (partNumber - 1) * session.partSize;
    const slice = file.slice(offset, Math.min(offset + session.partSize, file.size));
    const etag = await putPartWithRetry(url, slice, maxRetries, signal);
    session.completed.set(partNumber, etag);
    doneParts += 1;
    uploadedBytes += slice.size;
    onProgress?.({
      doneParts,
      totalParts: session.partCount,
      uploadedBytes,
      percent: session.partCount > 0 ? Math.round((doneParts / session.partCount) * 100) : 100,
    });
  });

  return Array.from(session.completed.entries())
    .sort(([a], [b]) => a - b)
    .map(([partNumber, etag]) => ({ partNumber, etag }));
}

/** 用户主动取消：signal 已中止，或错误本身就是 AbortError（与单发路径的取消失败语义一致） */
function isUserAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');
}

/** 将内部会话转为可导出/续传的公开会话结构（已完成分片按 partNumber 升序） */
function toResumeSession(session: MultipartSession): MultipartResumeSession {
  const completedParts = Array.from(session.completed.entries())
    .sort(([a], [b]) => a - b)
    .map(([partNumber, etag]) => ({ partNumber, etag }));
  return {
    fileKey: session.fileKey,
    uploadId: session.uploadId,
    partSize: session.partSize,
    completedParts,
  };
}

/** 尽力调用 multipart/abort 清理会话；清理失败不掩盖原始错误 */
async function abortMultipartSession(client: HttpClient, session: MultipartSession): Promise<void> {
  await client
    .post<unknown>('/openapi/v1/assets/files/multipart/abort', {
      fileKey: session.fileKey,
      uploadId: session.uploadId,
    })
    .catch(() => undefined);
}

/**
 * 将任意错误规整为结构化 ApiError：已是 ApiError 原样保留 status/code/msg，
 * 其余包装为 status=0 的客户端错误；传入 session 时包装为 MultipartUploadError 供续传。
 */
function toStructuredError(err: unknown, session?: MultipartResumeSession): ApiError {
  if (err instanceof ApiError) {
    if (session) {
      return new MultipartUploadError(err.status, err.code, err.msg, session);
    }
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new MultipartUploadError(0, 0, msg, session);
}

/** complete 幂等重试：失败退避重试，成功返回解包后的 complete 响应 */
async function postMultipartCompleteWithRetry(
  client: HttpClient,
  session: MultipartSession,
  parts: MultipartPart[],
  signal?: AbortSignal
): Promise<MultipartCompleteApiResp & { filePath: string }> {
  let lastError: unknown;
  const maxAttempts = MULTIPART_MAX_RETRIES + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await client.post<unknown>(
        '/openapi/v1/assets/files/multipart/complete',
        { fileKey: session.fileKey, uploadId: session.uploadId, parts },
        { signal }
      );
      const complete = unwrapData<MultipartCompleteApiResp>(resp);
      if (!complete.filePath) {
        throw new Error('Tier0 SDK: invalid multipart complete response from backend: missing filePath');
      }
      return complete as MultipartCompleteApiResp & { filePath: string };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await sleep(backoffDelay(attempt));
      }
    }
  }
  throw toStructuredError(lastError);
}

/**
 * multipart 分片上传大文件，解决单发上传（presigned POST）在 >100MB 场景的超时问题。
 *
 * 调用流程（均走既有 x-api-key 认证与 HttpClient）：
 * 1. `POST /openapi/v1/assets/files/multipart/init` 初始化分片会话（可选传 partSize，后端裁定为准；
 *    客户端传入低于 5MB 的 partSize 会自动抬升到 5MB，避免非末片小于 S3 最小分片导致 complete 被拒）；
 * 2. `POST /openapi/v1/assets/files/multipart/part-urls` 申请未完成分片的直传 URL（已完成分片跳过）；
 * 3. 并发 `PUT` 直传分片（默认并发 4，可配）：浏览器/Node 均用 `file.slice` 切片，
 *    单片失败指数退避重试 3 次；已上传分片记录在内存中，重试/续传不重传；
 * 4. `POST /openapi/v1/assets/files/multipart/complete` 组装文件（幂等，失败可重试）。
 *
 * 失败语义（分片上传与 complete 一致）：
 * - 用户取消（`options.signal` 中止 / AbortError）：会话尽力 abort 清理后原样抛回 AbortError，
 *   不转 ApiError，与单发上传路径行为一致；
 * - 其他失败：默认 abort 清理会话后抛结构化 ApiError（status/code/msg 可机读）；
 *   设置 `retainSessionOnFailure: true` 时不 abort，抛出的 `MultipartUploadError` 携带
 *   `multipartSession`（fileKey/uploadId/partSize/completedParts），可经 `resumeMultipartUpload` 断点续传。
 *
 * 每片 PUT 自带 60s 超时；`onProgress` 每完成一片回调一次（percent 为完成分片数/总分片数）。
 * 断点续传本版仅内存实现（uploadId + 已完成 partNumber），跨进程续传需自行持久化会话信息。
 *
 * `uploadFile` 在文件 >100MB 时自动调用本方法；小文件也可显式传 `options.multipart` 走分片。
 */
export async function uploadFileMultipart(
  file: File,
  options: MultipartUploadOptions = {}
): Promise<MultipartUploadResult> {
  assertUploadFile(file);
  if (file.size <= 0) {
    throw new Error('Tier0 SDK: multipart upload requires a non-empty file');
  }
  const fileName = checkFileName(file.name);
  const client = getClient();
  const contentType = file.type || 'application/octet-stream';
  // 客户端显式传入的分片大小，低于 S3 最小分片（5MB）时抬升，避免非末片在 complete 阶段被拒（EntityTooSmall）
  const requestedPartSize = options.partSize && options.partSize > 0 ? options.partSize : DEFAULT_MULTIPART_PART_SIZE;
  const partSize = Math.max(requestedPartSize, MIN_MULTIPART_PART_SIZE);

  // 1. 初始化分片会话
  const initResp = await client.post<unknown>(
    '/openapi/v1/assets/files/multipart/init',
    {
      fileName,
      contentType,
      size: file.size,
      partSize,
      business: options.business,
      useBy: options.useBy,
      visibility: options.visibility,
      appInstanceId: options.appInstanceId,
      sessionId: options.sessionId,
    },
    { signal: options.signal }
  );
  const init = unwrapData<MultipartInitApiResp>(initResp);
  if (!init.fileKey || !init.uploadId || !init.filePath) {
    throw new Error('Tier0 SDK: invalid multipart init response from backend: missing fileKey/uploadId/filePath');
  }

  // 后端裁定的分片大小同样抬到最小分片（若后端返回更小值）；分片数以文件大小自洽计算，
  // 保证切片覆盖整个文件且非末片满足最小分片约束
  const sessionPartSize = Math.max(
    init.partSize && init.partSize > 0 ? init.partSize : partSize,
    MIN_MULTIPART_PART_SIZE
  );
  const session: MultipartSession = {
    fileKey: init.fileKey,
    uploadId: init.uploadId,
    partSize: sessionPartSize,
    partCount: Math.ceil(file.size / sessionPartSize),
    completed: new Map(),
  };

  return runMultipartUpload(file, session, options);
}

/**
 * multipart 核心流程：part-urls -> 并发直传 -> complete。
 * `uploadFileMultipart`（新会话）与 `resumeMultipartUpload`（既有会话续传）共用。
 */
async function runMultipartUpload(
  file: File,
  session: MultipartSession,
  options: MultipartUploadOptions
): Promise<MultipartUploadResult> {
  const client = getClient();
  const retain = options.retainSessionOnFailure === true;

  // 2. 申请未完成分片的直传 URL（已完成分片跳过；续传场景只申请缺失分片）
  const partNumbers = Array.from({ length: session.partCount }, (_, i) => i + 1).filter(
    (n) => !session.completed.has(n)
  );
  let parts: MultipartPart[];
  try {
    if (partNumbers.length > 0) {
      const partUrlsResp = await client.post<unknown>(
        '/openapi/v1/assets/files/multipart/part-urls',
        { fileKey: session.fileKey, uploadId: session.uploadId, partNumbers },
        { signal: options.signal }
      );
      const partUrlsData = unwrapData<MultipartPartUrlApiResp>(partUrlsResp);
      const partUrls = new Map<number, string>();
      for (const item of partUrlsData?.partUrls ?? []) {
        if (item?.partNumber && item.url) {
          partUrls.set(item.partNumber, item.url);
        }
      }

      // 3. 并发直传分片（失败重试；重试仍失败按 retainSessionOnFailure 决定 abort 或保留会话）
      parts = await uploadPartsWithResume(
        file,
        session,
        partUrls,
        options.concurrency && options.concurrency > 0 ? options.concurrency : DEFAULT_MULTIPART_CONCURRENCY,
        MULTIPART_MAX_RETRIES,
        options.onProgress,
        options.signal
      );
    } else {
      // 全部分片已上传（如 complete 失败后的续传）：无需再传分片，直接进入 complete
      parts = Array.from(session.completed.entries())
        .sort(([a], [b]) => a - b)
        .map(([partNumber, etag]) => ({ partNumber, etag }));
    }
  } catch (err) {
    if (isUserAbort(err, options.signal)) {
      // 用户取消：清理会话后原样抛回 AbortError，不转 ApiError
      await abortMultipartSession(client, session);
      throw err;
    }
    if (retain) {
      // 保留会话供续传：错误携带 fileKey/uploadId/partSize/completedParts
      throw toStructuredError(err, toResumeSession(session));
    }
    await abortMultipartSession(client, session);
    throw toStructuredError(err);
  }

  // 4. complete：幂等，失败退避重试；失败同样走 abort 清理（除非 retainSessionOnFailure）
  try {
    const complete = await postMultipartCompleteWithRetry(client, session, parts, options.signal);
    return {
      fileId: complete.fileId !== undefined ? String(complete.fileId) : undefined,
      filePath: complete.filePath,
      fileUrl: complete.fileUrl ?? '',
      postUrl: '',
      postFields: {},
      uploadId: session.uploadId,
      sizeBytes: complete.sizeBytes ?? file.size,
      expiresAt: complete.expiresAt,
    };
  } catch (err) {
    if (isUserAbort(err, options.signal)) {
      await abortMultipartSession(client, session);
      throw err;
    }
    if (retain) {
      // complete 失败时全部分片已上传：续传可直接跳过上传、仅重试 complete 组装
      throw toStructuredError(err, toResumeSession(session));
    }
    await abortMultipartSession(client, session);
    throw toStructuredError(err);
  }
}

/**
 * 断点续传：使用 `MultipartUploadError.multipartSession`（或自行持久化的会话）恢复上传。
 * 已完成分片（`completedParts`）跳过不重传，仅重新申请缺失分片的直传 URL 并续传，随后 complete。
 * 适用于 `retainSessionOnFailure: true` 保留的失败会话；若失败发生在 complete 阶段
 * （全部分片已上传），续传会直接进入 complete 组装。
 * 注意：`file` 需与原上传为同一文件（大小一致），分片大小以会话为准。
 */
export async function resumeMultipartUpload(
  file: File,
  session: MultipartResumeSession,
  options: ResumeMultipartUploadOptions = {}
): Promise<MultipartUploadResult> {
  assertUploadFile(file);
  if (!session || !session.fileKey || !session.uploadId) {
    throw new Error('Tier0 SDK: resumeMultipartUpload requires a valid multipart session (fileKey/uploadId)');
  }
  if (!(session.partSize > 0)) {
    throw new Error('Tier0 SDK: resumeMultipartUpload requires a positive partSize in session');
  }
  const completed = new Map<number, string>();
  for (const part of session.completedParts ?? []) {
    if (part && part.partNumber > 0 && part.etag) {
      completed.set(part.partNumber, part.etag);
    }
  }
  const internal: MultipartSession = {
    fileKey: session.fileKey,
    uploadId: session.uploadId,
    partSize: session.partSize,
    partCount: Math.ceil(file.size / session.partSize),
    completed,
  };
  return runMultipartUpload(file, internal, {
    concurrency: options.concurrency,
    onProgress: options.onProgress,
    signal: options.signal,
    retainSessionOnFailure: options.retainSessionOnFailure,
  });
}

export interface GetFileUrlOptions {
  /** 上传时返回的 filePath */
  filePath: string;
  /** 仅 private 文件有效（秒）；public 文件忽略该参数，返回长期有效公开 URL */
  expiredSec?: number;
  /** 自定义下载响应头，如 attachment;filename=report.csv */
  responseContentDisposition?: string;
  /** 请求取消信号 */
  signal?: AbortSignal;
}

export interface GetFileUrlResult {
  /** public：长期有效公开 URL；private：presigned URL */
  fileUrl: string;
  /** private presigned URL 过期时间戳（毫秒） */
  expiresAt?: number;
}

export interface DownloadFileOptions {
  /** 上传时返回的 filePath */
  filePath: string;
  /** 自定义下载响应头，如 attachment;filename=report.csv */
  responseContentDisposition?: string;
  /** 请求取消信号 */
  signal?: AbortSignal;
}

export interface DownloadFileResult {
  /** 原始响应（已跟随重定向）：浏览器可 .blob() 触发保存，Node 可 .arrayBuffer() 写入本地 */
  response: Response;
  /** 响应 Content-Type */
  contentType: string;
  /** 响应 Content-Disposition（若有） */
  contentDisposition?: string;
}

export interface DeleteFileOptions {
  /** 上传时返回的 filePath */
  filePath: string;
  /** 请求取消信号 */
  signal?: AbortSignal;
}

export interface DeleteFileResult {
  deleted: boolean;
}

/** 危险后缀黑名单，与后端保持一致，上传前客户端预检 */
const FORBIDDEN_EXTENSIONS = new Set([
  'html', 'htm', 'php', 'php5', 'php4', 'php3', 'php2', 'phtml', 'pht',
  'asp', 'aspx', 'asa', 'asax', 'ascx', 'ashx', 'asmx', 'cer',
  'jsp', 'jspa', 'jspx', 'jsw', 'jsv', 'jspf', 'jhtml',
  'htaccess', 'swf',
]);

interface UploadFileApiResp {
  fileId?: string | number;
  filePath?: string;
  fileUrl?: string;
  postUrl?: string;
  postFields?: Record<string, string>;
  expiresAt?: number;
}

interface GetFileUrlApiResp {
  fileUrl?: string;
  expiresAt?: number;
}

interface DeleteFileApiResp {
  deleted?: boolean;
}

/** 网关响应可能是扁平 JSON，也可能包一层 data，统一解包 */
function unwrapData<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) {
    const data = (body as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      return data as T;
    }
  }
  return body as T;
}

function assertUploadFile(file: File): void {
  if (!file || typeof file !== 'object' || typeof file.size !== 'number' || typeof file.name !== 'string') {
    throw new Error('Tier0 SDK: uploadFile requires a File object');
  }
}

function checkFileName(fileName: string): string {
  const name = fileName || 'unnamed';
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw new Error(`Tier0 SDK: forbidden file extension: .${ext}`);
  }
  return name;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

/**
 * 上传文件。
 *
 * Cloud 和企业版接口完全统一，无需区分部署环境：
 * 1. 文件 >100MB 时自动切换 multipart 分片直传（见 `uploadFileMultipart`）；
 *    小文件也可显式传 `options.multipart` 走分片；
 * 2. 其余场景走 `POST /openapi/v1/assets/files` 申请 presigned POST URL、表单字段与 filePath；
 * 3. SDK 以 `multipart/form-data` 直传文件内容到对象存储（Cloud 为 AWS S3，企业版为 RustFS）：
 *    `postFields` 全部先写入表单，`file` 字段必须最后 appended，不额外添加 `Content-Type` 表单字段；
 * 4. 返回 { filePath, fileUrl, ... }，业务侧保存 filePath 即可。
 *
 * 调用前需先通过 `configureClient` 配置 apiHost/apiKey，或设置环境变量
 * `TIER0_API_HOST` / `TIER0_API_KEY`。
 */
export async function uploadFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  assertUploadFile(file);
  // 大文件（>100MB）自动切换 multipart 分片直传；小文件显式传 options.multipart 也走分片
  if (shouldUseMultipart(file.size, options.multipart)) {
    const { multipart, ...rest } = options;
    return uploadFileMultipart(file, {
      ...rest,
      partSize: multipart?.partSize,
      concurrency: multipart?.concurrency,
      onProgress: multipart?.onProgress,
      retainSessionOnFailure: multipart?.retainSessionOnFailure,
    });
  }
  const fileName = checkFileName(file.name);

  const client = getClient();
  const contentType = file.type || 'application/octet-stream';

  const resp = await client.post<unknown>(
    '/openapi/v1/assets/files',
    {
      fileName,
      contentType,
      size: file.size,
      business: options.business,
      useBy: options.useBy,
      visibility: options.visibility,
      appInstanceId: options.appInstanceId,
      sessionId: options.sessionId,
    },
    { signal: options.signal }
  );
  const data = unwrapData<UploadFileApiResp>(resp);

  if (!data.postUrl || !data.filePath) {
    throw new Error('Tier0 SDK: invalid upload response from backend: missing postUrl or filePath');
  }

  // 表单字段顺序对对象存储签名校验敏感：postFields 全部先入，file 必须最后 appended；
  // 不手动设置 Content-Type，浏览器/undici 会为 FormData 自动生成 multipart boundary。
  const form = new FormData();
  for (const [key, value] of Object.entries(data.postFields ?? {})) {
    form.append(key, value);
  }
  form.append('file', file);

  const uploadResp = await fetch(data.postUrl, {
    method: 'POST',
    body: form,
    signal: options.signal,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => 'Unknown error');
    // 直传存储失败同样抛结构化 ApiError，供调用方机读（status/code/msg）
    throw new ApiError(uploadResp.status, 0, text);
  }

  return {
    fileId: data.fileId !== undefined ? String(data.fileId) : undefined,
    filePath: data.filePath,
    fileUrl: data.fileUrl ?? '',
    postUrl: data.postUrl,
    postFields: data.postFields ?? {},
    expiresAt: data.expiresAt,
  };
}

/**
 * 获取文件访问 URL。
 *
 * - public 文件：返回长期有效公开 URL，`expiresAt` 为空；
 * - private 文件：返回 presigned URL，`expiresAt` 为过期时间戳，`expiredSec` 控制有效期。
 *
 * 适用于需要外发 URL 或前端直接展示 private 图片的场景；
 * 需要下载文件内容时请用 `downloadFile`。
 */
export async function getFileUrl(options: GetFileUrlOptions): Promise<GetFileUrlResult> {
  if (!options.filePath) {
    throw new Error('Tier0 SDK: getFileUrl requires filePath');
  }
  const client = getClient();
  const query = buildQuery({
    filePath: options.filePath,
    expiredSec: options.expiredSec,
    responseContentDisposition: options.responseContentDisposition,
  });

  const resp = await client.get<unknown>(`/openapi/v1/assets/files/url?${query}`, {
    signal: options.signal,
  });
  const data = unwrapData<GetFileUrlApiResp>(resp);

  if (!data.fileUrl) {
    throw new Error('Tier0 SDK: invalid url response from backend: missing fileUrl');
  }

  return { fileUrl: data.fileUrl, expiresAt: data.expiresAt };
}

/**
 * 直接下载文件。
 *
 * 调用 `GET /openapi/v1/assets/files/download?filePath=...`，后端按 visibility
 * 返回文件流或 302 跳转（public 到公开 URL，private 到短期 presigned URL），
 * SDK 自动跟随重定向，返回原始 Response：
 * - 浏览器：`response.blob()` 后创建 object URL 触发保存；
 * - Node.js：`response.arrayBuffer()` 后写入本地文件系统。
 */
export async function downloadFile(options: DownloadFileOptions): Promise<DownloadFileResult> {
  if (!options.filePath) {
    throw new Error('Tier0 SDK: downloadFile requires filePath');
  }
  const client = getClient();
  const baseURL = client.getBaseURL();
  const apiKey = client.getApiKey();
  const query = buildQuery({
    filePath: options.filePath,
    responseContentDisposition: options.responseContentDisposition,
  });

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['X-API-Key'] = apiKey;
  }

  const response = await fetch(`${baseURL}/openapi/v1/assets/files/download?${query}`, {
    method: 'GET',
    headers,
    redirect: 'follow',
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`Tier0 SDK: download failed: ${response.status} ${text}`);
  }

  return {
    response,
    contentType: response.headers.get('content-type') ?? '',
    contentDisposition: response.headers.get('content-disposition') ?? undefined,
  };
}

/**
 * 删除文件。按上传时返回的 filePath 删除存储对象与文件记录。
 */
export async function deleteFile(options: DeleteFileOptions): Promise<DeleteFileResult> {
  if (!options.filePath) {
    throw new Error('Tier0 SDK: deleteFile requires filePath');
  }
  const client = getClient();
  const resp = await client.post<unknown>(
    '/openapi/v1/assets/files/delete',
    { filePath: options.filePath },
    { signal: options.signal }
  );
  const data = unwrapData<DeleteFileApiResp>(resp);
  return { deleted: data?.deleted ?? true };
}
