---
name: tier0-sdk-openapi-files-upload
version: 0.1.0
description: "POST /openapi/v1/assets/files — 上传文件，返回 presigned PUT URL，SDK 直传存储"
---

# upload — `POST /openapi/v1/assets/files`

## SDK 调用

```typescript
import { uploadFile } from '@tier0/sdk/files';

const result = await uploadFile(file, {
  visibility: 'private',
  business: 'attachment',
  useBy: 'workspace',
});
```

> 当前 SDK 未发布 `files` 模块前，可直接用 `unsApi`/`flowApi` 同款 `openapi` client 调用本接口。

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileName` | string | **是** | 原始文件名，用于生成 object key |
| `contentType` | string | 否 | MIME 类型，如 `text/csv`、`image/png` |
| `size` | number | 否 | 文件大小（字节） |
| `business` | string | 否 | 业务场景，如 `attachment`、`avatar`、`notebook` |
| `useBy` | string | 否 | `user` / `workspace` / `platform`，默认 `user` |
| `visibility` | string | 否 | `public` / `private`，默认 `private` |
| `appInstanceId` | string | 否 | AI 生成应用实例 ID |
| `sessionId` | string | 否 | AI 生成应用会话 ID |

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    fileId?: string;
    filePath: string;        // 服务端生成的 object key，后续 download/url/delete 都用它
    fileUrl: string;         // public：长期有效公开 URL；private：可能为空
    uploadUrl?: string;      // presigned PUT URL，SDK 需用 PUT 直传文件内容
    expiresAt?: number;      // uploadUrl 过期时间戳（毫秒）
  };
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

// result.filePath 保存到业务对象中，用于后续下载/删除
console.log(result.filePath);

// public 文件可直接用 result.fileUrl 作为 <img> src
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

### 手动 PUT 直传（高级）

若需要自定义上传流程（如显示进度），可先调用接口拿到 `uploadUrl`，再自行 PUT：

```typescript
import { openapiClient } from '@tier0/sdk/openapi';

const resp = await openapiClient.post('/openapi/v1/assets/files', {
  fileName: file.name,
  contentType: file.type,
  size: file.size,
  visibility: 'private',
});

const { uploadUrl, filePath } = resp.data;

await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type },
});
```

## 注意事项

- `uploadUrl` 有效期默认 1 小时，超时需重新申请。
- 单文件大小一期限制 10 MB，超出后端直接拒绝。
- 扩展名黑名单（`html/htm/php/jsp/asp/htaccess/swf` 等）会被拒绝。
- 上传完成后文件状态为 `temp`，业务确认成功后会转为 `active`；长时间未确认的 temp 文件会被定时清理。
