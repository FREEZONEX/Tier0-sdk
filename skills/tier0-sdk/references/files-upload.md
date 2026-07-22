---
name: tier0-sdk-openapi-files-upload
version: 0.2.0
description: "uploadFile — POST /openapi/v1/assets/files 申请 presigned PUT URL 后直传对象存储，返回 filePath 与 fileUrl"
---

# uploadFile — 上传文件

Cloud 与企业版接口完全统一，SDK 无需区分部署环境，通过 `configureClient` 的 `apiHost`/`apiKey`（或环境变量 `TIER0_API_HOST`/`TIER0_API_KEY`）区分即可。

## 目录

- SDK 签名与上传流程
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

1. SDK 读取 `file.name` / `file.type` / `file.size`，做客户端预检（后缀黑名单、10MB 上限）；
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

| 错误 | 触发时机 |
|------|----------|
| `Tier0 SDK: uploadFile requires a File object` | 入参不是 File |
| `Tier0 SDK: forbidden file extension: .xxx` | 后缀黑名单（`html/htm/php/jsp/asp/htaccess/swf` 等），上传前抛出 |
| `Tier0 SDK: file size ... exceeds the 10MB limit` | 超过 10MB，上传前抛出 |
| `Tier0 SDK: invalid upload response from backend` | 后端响应缺少 `uploadUrl` 或 `filePath` |
| `Tier0 SDK: direct upload to storage failed: <status>` | PUT 直传存储失败 |
| `HTTP <status>: ...` | 接口鉴权失败、参数错误等 |

## 注意事项

- `uploadUrl` 默认有效期 3600 秒，超时需重新发起上传。
- `filePath` 由服务端生成；SDK 不暴露 bucket、endpoint 或永久密钥。
- `visibility=public` 的 `fileUrl` 长期有效，可直接引用；`private` 文件需用 `getFileUrl` 获取带签名的访问 URL。
- 上传完成后文件状态为 `temp`，业务确认后转为 `active`；长期未确认的 temp 文件会被后端定时清理。
