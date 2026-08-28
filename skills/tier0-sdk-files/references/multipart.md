---
name: tier0-sdk-openapi-files-multipart-upload
version: 0.2.0
description: "SDK 分片上传规则与配置：uploadFile 对超过 100 MB 的文件强制自动分片，并封装切片、并发、重试、ETag、complete/abort、进度和断点续传；应用无需自行实现分片。"
---

# SDK 分片上传

分片在客户端运行，但由 `@tier0/sdk/files` 完整实现。应用只调用 `uploadFile()` 并按需提供进度或续传配置，不要自行切片或编排底层接口。

## 强制选择规则

| 条件 | SDK 行为 |
|---|---|
| 文件大小 ≤ 100 MB，且未传 `options.multipart` | 使用标准上传 |
| 文件大小 > 100 MB | `uploadFile()` 强制自动切换分片，应用不能通过选项关闭 |
| 任意大小文件传入 `options.multipart` | 使用分片，以启用进度、并发配置或失败续传 |

100 MB 指 `100 * 1024 * 1024` 字节，是传输方式切换阈值，不是套餐单文件上限。实际文件上限和剩余存储配额由后端裁定。

## 职责边界

| 组件 | 职责 |
|---|---|
| SDK | 切片、申请分片 URL、并发上传、失败重试、收集 ETag、complete/abort、进度回调和续传 |
| 应用 | 文件选择和进度 UI；仅在需要跨会话续传时保存 `multipartSession` |
| 后端 | 鉴权、签名、套餐与配额校验、创建和结束分片会话 |

## 目录

- 强制选择规则与职责边界
- SDK 签名
- 上传流程与后端契约
- 使用示例（自动分片 / 进度 / 失败续传）
- 错误与注意事项

## SDK 签名

```typescript
import { uploadFile, uploadFileMultipart, resumeMultipartUpload } from '@tier0/sdk/files';

interface MultipartUploadOptions extends UploadOptions {
  partSize?: number;            // 分片大小（字节），默认 8MB；低于 5MB 会自动抬升到 5MB（S3 最小分片限制）
  concurrency?: number;         // 并发上传分片数，默认 4
  onProgress?: (progress: MultipartProgress) => void; // 每完成一片回调一次
  signal?: AbortSignal;         // 继承自 UploadOptions
  retainSessionOnFailure?: boolean; // 失败时保留会话以便续传（默认 false：自动 abort 清理）
}

interface MultipartProgress {
  doneParts: number;       // 已完成分片数
  totalParts: number;      // 总分片数
  uploadedBytes: number;   // 已上传字节数
  percent: number;         // 0-100
}

interface MultipartPart {
  partNumber: number;      // 分片序号，从 1 开始
  etag: string;            // 对象存储返回的 ETag
}

interface MultipartResumeSession {
  fileKey: string;         // 存储对象 key
  uploadId: string;        // 分片会话 ID
  partSize: number;        // 分片大小（字节），续传沿用
  completedParts: MultipartPart[]; // 已完成分片，续传时跳过
}

class MultipartUploadError extends ApiError {
  multipartSession?: MultipartResumeSession; // retainSessionOnFailure: true 时存在
}

interface MultipartUploadResult {
  fileId?: string;
  filePath: string;        // 业务侧保存此字段
  fileUrl: string;
  uploadId: string;        // 分片会话 ID
  sizeBytes: number;       // 文件大小（字节）
  expiresAt?: number;
  // 与 uploadFile 对齐：postUrl/postFields 恒为空字符串/空对象
  postUrl: string;
  postFields: Record<string, string>;
}

// 应用统一入口
function uploadFile(file: File, options?: UploadOptions): Promise<UploadResult>;

// 高级入口；通常由 uploadFile 自动调用
function uploadFileMultipart(file: File, options?: MultipartUploadOptions): Promise<MultipartUploadResult>;
function resumeMultipartUpload(
  file: File,
  session: MultipartResumeSession,
  options?: { concurrency?: number; onProgress?: MultipartProgressCallback; signal?: AbortSignal; retainSessionOnFailure?: boolean }
): Promise<MultipartUploadResult>;
```

导出常量：`MULTIPART_THRESHOLD_BYTES`（100MB）、`DEFAULT_MULTIPART_PART_SIZE`（8MB）、`MIN_MULTIPART_PART_SIZE`（5MB）、`DEFAULT_MULTIPART_CONCURRENCY`（4）、`MULTIPART_MAX_RETRIES`（3）、`MULTIPART_PART_TIMEOUT_MS`（60s）；路由判断函数 `shouldUseMultipart(size, multipart?)`。

## 上传流程与后端契约

1. **init**：`POST /openapi/v1/assets/files/multipart/init`
   body `{ fileName, contentType, size, partSize?, business?, useBy?, visibility?, appInstanceId?, sessionId? }`
   → `data { fileKey, filePath, uploadId, partSize, partCount, expiresAt }`；
2. **part-urls**：`POST /openapi/v1/assets/files/multipart/part-urls`
   body `{ fileKey, uploadId, partNumbers: number[] }`（SDK 一次性申请全部分片）
   → `data { partUrls: [{ partNumber, url, expiresAt }] }`；
3. **直传分片**：对每片 `fetch(url, { method: 'PUT', body: file.slice(offset, offset + partSize), signal: 60s 超时 })`；
   默认并发 4（手写并发池，无额外依赖）；单片失败指数退避重试 3 次（500ms 起、封顶 8s + 随机抖动），
   成功从响应头取 `ETag`；已上传分片记录在内存 `Map`（partNumber -> etag），重试/续传不重传；
4. **complete**：`POST /openapi/v1/assets/files/multipart/complete`
   body `{ fileKey, uploadId, parts: [{ partNumber, etag }] }`（SDK 按 partNumber 升序上报）
   → `data { filePath, fileUrl, sizeBytes, expiresAt }`；幂等，失败退避重试。

任意分片重试仍失败：默认 SDK 自动调用 abort 清理会话后抛结构化 `ApiError`；complete 失败同样默认 abort 清理。

**失败语义（分片上传与 complete 一致）**：
- 用户取消（`signal` 中止 / AbortError）：会话尽力 abort 清理后**原样抛回 AbortError**，不转 ApiError，与单发上传路径行为一致；
- 其他失败：默认 abort 清理后抛结构化 `ApiError`（status/code/msg 可机读）；
- `retainSessionOnFailure: true`：不 abort，抛出的 `MultipartUploadError` 携带 `multipartSession`（`fileKey`/`uploadId`/`partSize`/`completedParts`），调用方可持久化该会话并经 `resumeMultipartUpload` 断点续传——已完成分片跳过不重传，仅重新申请缺失分片的直传 URL 并续传，随后 complete；若失败发生在 complete 阶段（全部分片已上传），续传直接进入 complete 组装。

## 使用示例

### 自动分片（>100 MB）

```typescript
import { uploadFile } from '@tier0/sdk/files';

const file = input.files[0]; // 120MB
const result = await uploadFile(file, { business: 'attachment' });
console.log(result.filePath); // 保存此字段
```

应用不需要判断大小；同一调用对小文件使用标准上传，对超过 100 MB 的文件自动使用分片。

### 上传进度与并发

```typescript
import { uploadFile } from '@tier0/sdk/files';

const result = await uploadFile(file, {
  visibility: 'private',
  multipart: {
    concurrency: 4,
    onProgress: (progress) => updateProgress(progress.percent),
  },
});
```

显式传入 `multipart` 后，小文件也会使用分片。

### 失败保留会话 + 断点续传

```typescript
import {
  MultipartUploadError,
  uploadFile,
  resumeMultipartUpload,
} from '@tier0/sdk/files';

// 1. 失败时保留会话（不 abort），从错误中取出 multipartSession 持久化
try {
  await uploadFile(file, {
    multipart: { retainSessionOnFailure: true },
  });
} catch (err) {
  if (err instanceof MultipartUploadError && err.multipartSession) {
    saveSession(err.multipartSession); // 自行持久化 fileKey/uploadId/completedParts
  }
  throw err;
}

// 2. 下次重试时续传：已完成分片跳过，仅上传缺失分片
const result = await resumeMultipartUpload(file, loadSession(), {
  concurrency: 4,
  onProgress: (p) => console.log(p.percent),
});
```

## 错误与注意事项

- 应用统一调用 `uploadFile()`；`uploadFileMultipart()` 是高级入口，不要直接调用 `/multipart/*` 接口重新实现 SDK 已提供的流程。
- 分片直传存储失败（如 S3 403）抛结构化 `ApiError`（`status`/`code`/`msg` 可机读；网关风格 JSON 错误体解析 code/msg，S3/RustFS XML 错误体保留原文）；重试仍失败默认 abort 后抛出。
- 分片大小下限：客户端传入的 `partSize` 低于 5MB 会自动抬升到 `MIN_MULTIPART_PART_SIZE`（5MB），避免多分片场景下非末片小于 S3 最小分片、complete 阶段被拒（`EntityTooSmall`）；单分片文件不受限（末片可为任意大小）。
- 失败会话保留与续传：默认失败即 abort 清理；`retainSessionOnFailure: true` 时不 abort，抛出的 `MultipartUploadError` 携带 `multipartSession`，可经 `resumeMultipartUpload` 续传（跳过已完成分片）。complete 失败默认同样 abort 清理（除非 retain），保留时续传直接进入 complete 组装。
- 取消语义：用户通过 `options.signal` 取消时原样抛回 AbortError（不转 ApiError），与单发上传路径一致；每片 PUT 自带 60s 超时。
- 客户端预检错误（上传前抛出）：非 `File` 入参、空文件（`multipart upload requires a non-empty file`）、危险后缀（复用 `checkFileName` 黑名单）、init 响应缺少 `fileKey`/`uploadId`/`filePath`、complete 响应缺少 `filePath`。
- 断点续传的 `multipartSession` 需要调用方自行持久化（`fileKey`/`uploadId`/`partSize`/`completedParts`）；续传时 `file` 需与原上传为同一文件（大小一致）。
- 文件大小上限与配额由服务端按套餐裁定（同单发上传）；`size > 100MB` 是客户端自动切换分片的阈值。
