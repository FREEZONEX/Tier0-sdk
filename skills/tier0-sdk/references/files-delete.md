---
name: tier0-sdk-openapi-files-delete
version: 0.2.0
description: "deleteFile — POST /openapi/v1/assets/files/delete 按 filePath 删除存储对象与文件记录"
---

# deleteFile — 删除文件

按上传时返回的 `filePath` 删除存储对象与文件记录，不可恢复。

## SDK 签名

```typescript
import { deleteFile } from '@tier0/sdk/files';

interface DeleteFileOptions {
  filePath: string;  // 上传时返回的 filePath，必填
  signal?: AbortSignal;
}

interface DeleteFileResult {
  deleted: boolean;
}

function deleteFile(options: DeleteFileOptions): Promise<DeleteFileResult>;
```

## 底层接口

`POST /openapi/v1/assets/files/delete`，请求体（JSON）：

```json
{
  "filePath": "workspace/10086/attachment/20260706/abcdef-report.csv"
}
```

响应体（扁平 JSON；SDK 同时兼容 `{ code, msg, data }` 包裹响应；后端返回 204/空体时 SDK 也按成功处理）：

```json
{
  "deleted": true
}
```

## 使用示例

```typescript
import { deleteFile } from '@tier0/sdk/files';

try {
  const { deleted } = await deleteFile({
    filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
  });
  if (deleted) {
    console.log('删除成功');
  }
} catch (error) {
  // 403：无权限或文件不属于当前租户
  // 404：文件不存在
  console.error(error.message);
}
```

## 错误

| 错误 | 触发时机 |
|------|----------|
| `Tier0 SDK: deleteFile requires filePath` | 未传 `filePath` |
| `HTTP <status>: ...` | 403 跨租户/无权限、404 文件不存在等 |

## 注意事项

- 删除操作会同时删除存储对象和元数据记录。
- 只能删除当前租户/项目下的文件；跨租户删除返回 403。
- `useBy=platform` 的文件需要平台管理员权限才能删除。
- 删除后 `filePath` 不可恢复，请谨慎操作。
