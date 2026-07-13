---
name: tier0-sdk-openapi-files-url
version: 0.1.0
description: "GET /openapi/v1/assets/files/url?filePath=... — 获取文件访问 URL，public 返回长期有效 URL，private 返回带有效期 presigned URL"
---

# url — `GET /openapi/v1/assets/files/url`

## SDK 调用

```typescript
import { getFileUrl } from '@tier0/sdk/files';

const { fileUrl, expiresAt } = await getFileUrl({
  filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
  expiredSec: 3600,
});
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filePath` | string | **是** | 上传时返回的 object key |
| `expiredSec` | number | 否 | presigned URL 有效期（秒），默认 3600。**仅 private 文件有效**，public 文件忽略 |
| `responseContentDisposition` | string | 否 | 自定义下载响应头 |

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    fileUrl: string;       // public：长期有效公开 URL；private：presigned URL
    expiresAt?: number;    // public：无；private：presigned URL 过期时间戳（毫秒）
  };
}
```

## 使用示例

### 前端展示 private 图片

```typescript
import { getFileUrl } from '@tier0/sdk/files';

const { fileUrl } = await getFileUrl({
  filePath: 'workspace/10086/avatar/20260706/abc.png',
  expiredSec: 3600,
});

// fileUrl 可直接作为 <img> src 使用
document.querySelector('img').src = fileUrl;
```

### 外发下载链接

```typescript
const { fileUrl, expiresAt } = await getFileUrl({
  filePath: 'workspace/10086/report/20260706/abc.csv',
  expiredSec: 86400, // 1 天
});

// 把 fileUrl 发给第三方，注意告知过期时间
console.log('下载链接:', fileUrl);
console.log('过期时间:', new Date(expiresAt));
```

### public 文件直接引用

```typescript
const { fileUrl } = await getFileUrl({
  filePath: 'workspace/10086/public/logo.png',
});

// public 文件返回长期有效 URL，无 expiresAt
console.log(fileUrl); // https://cdn.example.com/...
```

## 注意事项

- `getFileUrl` 不会下载文件内容，只返回可访问的 URL。
- private 文件的 presigned URL 会过期，不要把过期 URL 持久化到数据库。
- public 文件返回长期有效 URL，适合 CDN 引用。
