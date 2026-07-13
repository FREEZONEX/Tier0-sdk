import { getClient } from './openapi/client.js';

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
}

export interface UploadResult {
  /** 后端文件记录 ID（若返回） */
  fileId?: string;
  /** 存储对象 key，业务系统保存此字段即可 */
  filePath: string;
  /** public：长期有效公开 URL；private：上传时可能为空或 presigned URL */
  fileUrl: string;
  /** 本次上传使用的 presigned PUT URL */
  uploadUrl?: string;
  /** private presigned URL 过期时间戳（毫秒） */
  expiresAt?: number;
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

/** 单文件大小上限（字节）。后端最终裁定，SDK 仅做上传前友好预检 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface UploadFileApiResp {
  fileId?: string | number;
  filePath?: string;
  fileUrl?: string;
  uploadUrl?: string;
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

function checkFileSize(size: number): void {
  if (size > MAX_FILE_SIZE) {
    throw new Error(`Tier0 SDK: file size ${size} exceeds the 10MB limit`);
  }
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
 * 1. `POST /openapi/v1/assets/files` 申请 presigned PUT URL 与 filePath；
 * 2. SDK 直传文件内容到对象存储（Cloud 为 AWS S3，企业版为 RustFS）；
 * 3. 返回 { filePath, fileUrl, ... }，业务侧保存 filePath 即可。
 *
 * 调用前需先通过 `configureClient` 配置 apiHost/apiKey，或设置环境变量
 * `TIER0_API_HOST` / `TIER0_API_KEY`。
 */
export async function uploadFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  assertUploadFile(file);
  const fileName = checkFileName(file.name);
  checkFileSize(file.size);

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

  if (!data.uploadUrl || !data.filePath) {
    throw new Error('Tier0 SDK: invalid upload response from backend: missing uploadUrl or filePath');
  }

  const uploadResp = await fetch(data.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
    signal: options.signal,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => 'Unknown error');
    throw new Error(`Tier0 SDK: direct upload to storage failed: ${uploadResp.status} ${text}`);
  }

  return {
    fileId: data.fileId !== undefined ? String(data.fileId) : undefined,
    filePath: data.filePath,
    fileUrl: data.fileUrl ?? '',
    uploadUrl: data.uploadUrl,
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
