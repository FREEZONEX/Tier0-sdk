---
name: tier0-sdk-openapi-files-download
version: 0.2.0
description: "downloadFile — GET /openapi/v1/assets/files/download 直接下载文件，返回跟随重定向后的原始 Response，浏览器触发保存或 Node 写入本地"
---

# downloadFile — 直接下载文件

只需要一个可外发的 URL（如前端 `<img src>`）时，请用 `getFileUrl` 而不是本函数。

## SDK 签名

```typescript
import { downloadFile } from '@tier0/sdk/files';

interface DownloadFileOptions {
  filePath: string;                     // 上传时返回的 filePath，必填
  responseContentDisposition?: string;  // 自定义下载响应头，如 attachment;filename=report.csv
  signal?: AbortSignal;
}

interface DownloadFileResult {
  response: Response;        // 原始响应（已跟随重定向）
  contentType: string;       // 响应 Content-Type
  contentDisposition?: string; // 响应 Content-Disposition（若有）
}

function downloadFile(options: DownloadFileOptions): Promise<DownloadFileResult>;
```

## 底层接口

`GET /openapi/v1/assets/files/download?filePath={filePath}&responseContentDisposition={...}`

后端根据文件 `visibility` 决定下载方式：

- **public**：302 跳转到长期有效公开 URL，或直接返回文件流。
- **private**：302 跳转到短期 presigned URL，或直接返回文件流。

SDK 自动跟随重定向，最终拿到文件内容。

## 使用示例

### 浏览器触发下载

```typescript
import { downloadFile } from '@tier0/sdk/files';

const { response } = await downloadFile({
  filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
  responseContentDisposition: 'attachment;filename=report.csv',
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'report.csv';
a.click();
URL.revokeObjectURL(url);
```

### Node.js 保存到本地

```typescript
import { downloadFile } from '@tier0/sdk/files';
import fs from 'node:fs';

const { response } = await downloadFile({
  filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
});

const buffer = Buffer.from(await response.arrayBuffer());
fs.writeFileSync('./report.csv', buffer);
```

### 直接读取文本/JSON

```typescript
const { response } = await downloadFile({ filePath: '...' });
const text = await response.text();
const json = await response.json();
```

## 错误

| 错误 | 触发时机 |
|------|----------|
| `Tier0 SDK: downloadFile requires filePath` | 未传 `filePath` |
| `Tier0 SDK: download failed: <status>` | 下载接口返回非 2xx（如 403 跨租户、404 不存在） |

## 注意事项

- private 文件的下载链路依赖短期 presigned URL（默认有效期 3600 秒），过期需重新调用 `downloadFile` 或 `getFileUrl`。
- 大文件建议流式处理：`response.body.getReader()`。
