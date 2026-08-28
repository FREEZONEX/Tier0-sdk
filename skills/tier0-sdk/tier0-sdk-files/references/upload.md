---
name: tier0-sdk-openapi-files-upload
version: 0.3.0
description: "使用 uploadFile 统一上传并持久化文件；SDK 对不超过 100 MB 的文件使用标准上传，对超过 100 MB 的文件强制自动切换分片上传，并返回业务侧应保存的 filePath。"
---

# `uploadFile` — 统一上传入口

Cloud 与企业版接口完全统一，SDK 无需区分部署环境，通过 `configureClient` 的 `apiHost`/`apiKey`（或环境变量 `TIER0_API_HOST`/`TIER0_API_KEY`）区分即可。

应用始终调用 `uploadFile()`。不要在应用中判断是否需要切片，也不要直接调用分片接口：文件超过 100 MB 时，SDK 会强制自动切换为分片上传。

## 默认存储决策（强制）

当用户需要上传并保存附件、头像、图片、导入文件或其他持久化文件时，优先使用 `uploadFile`，把文件保存到 SDK 管理的对象存储（Cloud 为 AWS S3，企业版为 RustFS）。不要默认保存到应用服务器本地磁盘、仓库目录、`public/uploads` 或数据库 Blob；这些位置不能作为持久文件的事实来源。

业务表只保存上传返回的 `filePath`。展示或访问时调用 `getFileUrl`，下载时调用 `downloadFile`，删除时调用 `deleteFile`。不要保存会过期的 `postUrl`/`postFields` 或私有文件 presigned URL。只有上传前转码、扫描等短期处理可以使用本地临时文件，处理完成后仍须上传到 SDK 管理的对象存储。

## 目录

- SDK 签名与上传流程
- SDK 对象存储优先规则与业务数据保存方式
- 标准上传接口与浏览器、Node.js 示例
- 错误和注意事项

## SDK 签名

```typescript
import { uploadFile } from '@tier0/sdk/files';

interface MultipartOptions {
  partSize?: number;
  concurrency?: number;
  onProgress?: (progress: MultipartProgress) => void;
  retainSessionOnFailure?: boolean;
}

interface MultipartProgress {
  doneParts: number;
  totalParts: number;
  uploadedBytes: number;
  percent: number;
}

interface UploadOptions {
  business?: string;                          // 业务场景，如 attachment / avatar / notebook
  useBy?: 'user' | 'workspace' | 'platform';  // 不传时由后端裁定
  visibility?: 'public' | 'private';          // 不传时由后端裁定（默认 private）
  appInstanceId?: string;                     // AI 生成应用实例 ID
  sessionId?: string;                         // AI 生成应用会话 ID
  signal?: AbortSignal;
  multipart?: MultipartOptions;               // 显式配置进度、并发或失败续传；小文件传入后也使用分片
}

interface UploadResult {
  fileId?: string;               // 后端文件记录 ID（若返回）
  filePath: string;              // 存储 object key，业务侧保存此字段，后续 download/url/delete 都用它
  fileUrl: string;               // public：长期有效公开 URL；private：可能为空或 presigned URL
  postUrl: string;               // 标准上传使用；分片上传时为空字符串
  postFields: Record<string,string>; // 标准上传使用；分片上传时为空对象
  expiresAt?: number;            // presigned URL 过期时间戳（毫秒）
}

function uploadFile(file: File, options?: UploadOptions): Promise<UploadResult>;
```

## 上传流程

1. SDK 检查文件名、类型和大小，并选择上传方式。
2. 文件不超过 100 MB 且未传 `options.multipart` 时，SDK 申请 presigned POST 并完成标准上传。
3. 文件超过 100 MB 时，SDK 强制自动执行分片上传；任何大小的文件传入 `options.multipart` 时也执行分片上传。详细行为见 [`multipart.md`](multipart.md)。
4. 后端独立校验套餐单文件上限和剩余存储配额；100 MB 是传输方式切换阈值，不是套餐上限。
5. SDK 返回 `UploadResult`，业务数据只保存 `filePath`。

## 标准上传底层接口

以下契约用于理解和排障，不要在应用代码中替代 `uploadFile()` 手动调用。

标准上传虽然使用 HTTP `multipart/form-data` 提交文件，但它不是对象存储的 multipart 分片上传；后者仅指 [`multipart.md`](multipart.md) 中的切片、并发 PUT 和 complete 流程。

`POST /openapi/v1/assets/files`，请求体（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileName` | string | **是** | 原始文件名，服务端据此生成 object key |
| `contentType` | string | **是** | MIME 类型；SDK 在 `file.type` 为空时填 `application/octet-stream` |
| `size` | number | **是** | 文件大小（字节） |
| `business` | string | 否 | 业务场景 |
| `useBy` | string | 否 | `user` / `workspace` / `platform` |
| `visibility` | string | 否 | `public` / `private` |
| `appInstanceId` | string | 否 | AI 生成应用实例 ID |
| `sessionId` | string | 否 | AI 生成应用会话 ID |

响应体（扁平 JSON；SDK 同时兼容 `{ code, msg, data }` 包裹响应）：

```json
{
  "fileId": "12345",
  "filePath": "workspace/10086/attachment/20260706/abcdef-report.csv",
  "fileUrl": "",
  "postUrl": "https://bucket.s3.amazonaws.com/",
  "postFields": {
    "key": "workspace/10086/attachment/20260706/abcdef-report.csv",
    "policy": "<base64 policy>",
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-credential": "AKID/20260706/us-east-1/s3/aws4_request",
    "x-amz-date": "20260706T000000Z",
    "x-amz-signature": "<sig>"
  },
  "expiresAt": 1751892400000
}
```

## 使用示例

### 浏览器上传

```typescript
import { uploadFile } from '@tier0/sdk/files';

const input = document.querySelector('input[type=file]');
const file = input.files[0];

const result = await uploadFile(file, {
  visibility: 'private',
  business: 'attachment',
});

// result.filePath 保存到业务对象，用于后续下载/取 URL/删除
console.log(result.filePath);

// public 文件可直接用 result.fileUrl 作为 <img> src；
// private 文件需要再调 getFileUrl 获取可访问 URL
```

### Node.js 上传

```typescript
import { uploadFile } from '@tier0/sdk/files';
import fs from 'node:fs';

const buffer = fs.readFileSync('./report.csv');
const file = new File([buffer], 'report.csv', { type: 'text/csv' });

const result = await uploadFile(file, {
  visibility: 'private',
  business: 'attachment',
  appInstanceId: 'app-123',
  sessionId: 'sess-456',
});
```

## 错误

客户端预检错误（上传前抛出）：

| 错误 | 触发时机 |
|------|----------|
| `Tier0 SDK: uploadFile requires a File object` | 入参不是 File |
| `Tier0 SDK: forbidden file extension: .xxx` | 后缀黑名单（`html/htm/php/jsp/asp/htaccess/swf` 等） |
| `Tier0 SDK: invalid upload response from backend` | 后端响应缺少 `postUrl` 或 `filePath` |

服务端错误以结构化 `ApiError` 抛出（`Error` 子类，message 为 `HTTP <status>: <msg>`），携带 `status`（HTTP 状态码）、`code`（后端业务错误码）、`msg`（错误消息），调用方可机读；**直传对象存储失败（如 S3 返回 403 AccessDenied）同样抛 `ApiError`**：

```typescript
import { ApiError } from '@tier0/sdk/openapi';

try {
  await uploadFile(file);
} catch (e) {
  if (e instanceof ApiError) {
    console.error(e.status, e.code, e.msg); // 例如 403 40301 'storage quota exceeded'
  }
}
```

存储配额相关错误码（文件大小上限与配额由服务端按套餐裁定，SDK 不做客户端大小预检）：

| 错误码 | HTTP | 触发场景 | 处理建议 |
|--------|------|----------|----------|
| `CodeStorageQuotaExceeded` | 403 | 预占/差额补偿超出套餐存储上限 | 提示删除文件或升级套餐 |
| `CodeStorageFileTooLarge` | 400 | 单文件超过当前套餐或部署环境允许的上限 | 提示服务端返回的当前上限或升级套餐 |
| `CodeStorageUploadStateInvalid` | 409 | confirm/abort 的记录非 `temp`（非幂等重放场景） | 提示任务已结束或不存在 |

## 注意事项

- 应用只调用 `uploadFile()`；不要自行切片、申请分片 URL、收集 ETag 或调用 complete/abort。
- `postUrl`/`postFields` 默认有效期 3600 秒，超时需重新发起上传。
- `filePath` 由服务端生成；SDK 不暴露 bucket、endpoint 或永久密钥。
- POST 上传为 `multipart/form-data`：`postFields` 全部先写入，`file` 字段必须最后 appended；不要额外添加 `Content-Type` 表单字段；对象 key 精确匹配 `filePath`；body 大小 ∈ [1, sizeBytes]；成功返回 204 无 body。
- `visibility=public` 的 `fileUrl` 长期有效，可直接引用；`private` 文件需用 `getFileUrl` 获取带签名的访问 URL。
- 上传完成后文件状态为 `temp`，业务确认后转为 `active`；长期未确认的 temp 文件会被后端定时清理。
