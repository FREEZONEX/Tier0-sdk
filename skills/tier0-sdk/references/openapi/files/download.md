---
name: tier0-sdk-openapi-files-download
version: 0.1.0
description: "GET /openapi/v1/assets/files/download?filePath=... — 直接下载文件，返回文件流或 302 跳转"
---

# download — `GET /openapi/v1/assets/files/download`

## SDK 调用

```typescript
import { downloadFile } from '@tier0/sdk/files';

const result = await downloadFile({
  filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
});
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filePath` | string | **是** | 上传时返回的 object key |
| `responseContentDisposition` | string | 否 | 自定义下载响应头，如 `attachment;filename=report.csv` |

## 响应行为

后端根据文件 `visibility` 决定下载方式：

- **public**：302 跳转到长期有效公开 URL，或直接返回文件流。
- **private**：302 跳转到短期 presigned URL，或直接返回文件流。

SDK 会跟随重定向，最终拿到文件内容。

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

## 注意事项

- private 文件的 presigned URL 有效期较短（默认 1 小时），过期需重新调用 `downloadFile` 或 `getFileUrl`。
- 若只需要一个可外发的 URL（如前端 `<img src>`），请用 `getFileUrl` 而不是 `downloadFile`。
- 大文件建议流式处理：`response.body.getReader()`。
