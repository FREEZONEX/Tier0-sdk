---
name: tier0-sdk-openapi-files-url
version: 0.2.0
description: "getFileUrl — GET /openapi/v1/assets/files/url 获取文件访问 URL：public 返回长期有效 URL，private 返回带 expiresAt 的 presigned URL"
---

# getFileUrl — 获取文件访问 URL

只返回可访问的 URL，不下载文件内容。需要文件内容时请用 `downloadFile`。

该接口适合图片/媒体预览、第三方临时访问或确实需要外发 URL 的场景。
浏览器应用的“下载附件”按钮不得使用该接口后直接 `window.open()`、
设置 `location.href` 或打开新标签页；这会让 PDF 等文件进入内置预览器，
也可能被浏览器策略或扩展拦截。应用下载请使用 `downloadFile`，并按
`download.md` 中的 Blob + `<a download>` 模式实现。

## SDK 签名

```typescript
import { getFileUrl } from '@tier0/sdk/files';

interface GetFileUrlOptions {
  filePath: string;                     // 上传时返回的 filePath，必填
  expiredSec?: number;                  // presigned URL 有效期（秒），默认 3600；仅 private 有效，public 忽略
  responseContentDisposition?: string;  // 自定义下载响应头，如 attachment;filename=report.csv
  signal?: AbortSignal;
}

interface GetFileUrlResult {
  fileUrl: string;    // public：长期有效公开 URL；private：presigned URL
  expiresAt?: number; // private：presigned URL 过期时间戳（毫秒）；public 无此字段
}

function getFileUrl(options: GetFileUrlOptions): Promise<GetFileUrlResult>;
```

## 底层接口

`GET /openapi/v1/assets/files/url?filePath={filePath}&expiredSec={expiredSec}&responseContentDisposition={...}`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filePath` | string | **是** | 上传时返回的 object key |
| `expiredSec` | number | 否 | presigned URL 有效期（秒），默认 3600；仅 private 文件有效 |
| `responseContentDisposition` | string | 否 | 自定义下载响应头 |

响应体（扁平 JSON；SDK 同时兼容 `{ code, msg, data }` 包裹响应）：

```json
{
  "fileUrl": "https://bucket.s3.amazonaws.com/...?X-Amz-Signature=...",
  "expiresAt": 1751892400000
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

### 外发临时访问链接

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

## 错误

| 错误 | 触发时机 |
|------|----------|
| `Tier0 SDK: getFileUrl requires filePath` | 未传 `filePath` |
| `Tier0 SDK: invalid url response from backend: missing fileUrl` | 后端响应缺少 `fileUrl` |
| `HTTP <status>: ...` | 鉴权失败、文件不存在、跨租户访问（403）等 |

## 注意事项

- private 文件的 presigned URL 会过期，不要把 URL 持久化到数据库；过期后重新调用 `getFileUrl` 即可。
- public 文件返回长期有效 URL，适合 CDN 引用与 `<img>` 直链。
- 该接口只返回 URL，不传输文件内容。
- `responseContentDisposition` 不能替代浏览器端 `<a download>`，也不能保证不同对象存储和浏览器都强制下载。
- MonoApp/TanStack Start 的附件下载必须经过同源服务端路由：服务端调用 `downloadFile` 并流式转发，浏览器再保存 Blob。
- 不要把 private presigned URL 写入数据库、业务记录、浏览器历史或长期缓存。
