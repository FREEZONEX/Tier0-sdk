---
name: tier0-sdk-openapi-files-upload
version: 0.2.0
description: "uploadFile — POST /openapi/v1/assets/files 申请 presigned PUT URL 后直传对象存储，返回 filePath 与 fileUrl"
---

# uploadFile — 上传文件

Cloud 与企业版接口完全统一，SDK 无需区分部署环境，通过 `configureClient` 的 `apiHost`/`apiKey`（或环境变量 `TIER0_API_HOST`/`TIER0_API_KEY`）区分即可。

## 默认存储决策（强制）

当用户需要上传并保存附件、头像、图片、导入文件或其他持久化文件时，优先使用 `uploadFile`，把文件保存到 SDK 管理的对象存储（Cloud 为 AWS S3，企业版为 RustFS）。不要默认保存到应用服务器本地磁盘、仓库目录、`public/uploads` 或数据库 Blob；这些位置不能作为持久文件的事实来源。

业务表只保存上传返回的 `filePath`。展示或访问时调用 `getFileUrl`，下载时调用 `downloadFile`，删除时调用 `deleteFile`。不要保存会过期的 `uploadUrl` 或私有文件 presigned URL。只有上传前转码、扫描等短期处理可以使用本地临时文件，处理完成后仍须上传到 SDK 管理的对象存储。

## 目录

- SDK 签名与上传流程
- SDK 对象存储优先规则与业务数据保存方式
- 底层接口与使用示例
- 浏览器、Node.js 与高级手动 PUT
- 错误和注意事项

## SDK 签名

```typescript
import { uploadFile } from '@tier0/sdk/files';

interface UploadOptions {
  business?: string;                          // 业务场景，如 attachment / avatar / notebook
  useBy?: 'user' | 'workspace' | 'platform';  // 不传时由后端裁定
  visibility?: 'public' | 'private';          // 不传时由后端裁定（默认 private）
  appInstanceId?: string;                     // AI 生成应用实例 ID
  sessionId?: string;                         // AI 生成应用会话 ID
  signal?: AbortSignal;
}

interface UploadResult {
  fileId?: string;    // 后端文件记录 ID（若返回）
  filePath: string;   // 存储 object key，业务侧保存此字段，后续 download/url/delete 都用它
  fileUrl: string;    // public：长期有效公开 URL；private：可能为空或 presigned URL
  uploadUrl?: string; // 本次上传使用的 presigned PUT URL
  expiresAt?: number; // presigned URL 过期时间戳（毫秒）
}

function uploadFile(file: File, options?: UploadOptions): Promise<UploadResult>;
```

## 上传流程

1. SDK 读取 `file.name` / `file.type` / `file.size`，做客户端预检（仅后缀黑名单）；文件大小上限与配额由服务端按套餐裁定，SDK 不做大小预检；
2. `POST /openapi/v1/assets/files` 申请 presigned PUT URL 与 `filePath`；
3. SDK 用 `PUT uploadUrl` 直传文件内容到对象存储（Cloud 为 AWS S3，企业版为 RustFS）；
4. 返回 `UploadResult`。

## 底层接口

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
  "uploadUrl": "https://bucket.s3.amazonaws.com/...?X-Amz-Signature=...",
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

### 手动 PUT 直传（高级，如需自定义上传进度）

```typescript
import { getClient } from '@tier0/sdk/openapi';

const client = getClient();
const resp = await client.post('/openapi/v1/assets/files', {
  fileName: file.name,
  contentType: file.type || 'application/octet-stream',
  size: file.size,
  visibility: 'private',
});
// 网关可能返回扁平 JSON 或 { code, msg, data } 包裹，按需解包
const data = (resp as any).data ?? resp;

await fetch(data.uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type || 'application/octet-stream' },
});
```

## 错误

客户端预检错误（上传前抛出）：

| 错误 | 触发时机 |
|------|----------|
| `Tier0 SDK: uploadFile requires a File object` | 入参不是 File |
| `Tier0 SDK: forbidden file extension: .xxx` | 后缀黑名单（`html/htm/php/jsp/asp/htaccess/swf` 等） |
| `Tier0 SDK: invalid upload response from backend` | 后端响应缺少 `uploadUrl` 或 `filePath` |
| `Tier0 SDK: direct upload to storage failed: <status>` | PUT 直传存储失败 |

服务端错误以结构化 `ApiError` 抛出（`Error` 子类，message 为 `HTTP <status>: <msg>`），携带 `status`（HTTP 状态码）、`code`（后端业务错误码）、`msg`（错误消息），调用方可机读：

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
| `CodeStorageFileTooLarge` | 400 | 单文件超过上限（Phase 1 统一 100MB / Phase 2 按套餐 1GB） | 提示当前上限 |
| `CodeStorageUploadStateInvalid` | 409 | confirm/abort 的记录非 `temp`（非幂等重放场景） | 提示任务已结束或不存在 |

## 注意事项

- `uploadUrl` 默认有效期 3600 秒，超时需重新发起上传。
- `filePath` 由服务端生成；SDK 不暴露 bucket、endpoint 或永久密钥。
- `visibility=public` 的 `fileUrl` 长期有效，可直接引用；`private` 文件需用 `getFileUrl` 获取带签名的访问 URL。
- 上传完成后文件状态为 `temp`，业务确认后转为 `active`；长期未确认的 temp 文件会被后端定时清理。
