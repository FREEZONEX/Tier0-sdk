---
name: tier0-sdk-openapi-files-delete
version: 0.1.0
description: "POST /openapi/v1/assets/files/delete — 删除文件及元数据"
---

# delete — `POST /openapi/v1/assets/files/delete`

## SDK 调用

```typescript
import { deleteFile } from '@tier0/sdk/files';

const { deleted } = await deleteFile({
  filePath: 'workspace/10086/attachment/20260706/abcdef-report.csv',
});
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filePath` | string | **是** | 上传时返回的 object key |

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    deleted: boolean;
  };
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

## 注意事项

- 删除操作会同时删除存储对象和元数据记录。
- 只能删除当前租户/项目下的文件；跨租户删除返回 403。
- `useBy=platform` 的文件需要平台管理员权限才能删除。
- 删除后 `filePath` 不可恢复，请谨慎操作。
