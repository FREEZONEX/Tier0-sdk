---
name: tier0-sdk-openapi-browse
version: 0.1.0
description: "POST /openapi/v1/uns/browse — BrowseReq"
---

# browse — `POST /openapi/v1/uns/browse`

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsbrowse(body);
```

## 请求参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `include_leaf_value` | boolean(boolean) |  |
| `include_metadata` | boolean(boolean) |  |
| `max_depth` | integer(int64) |  |
| `path` | string |  |

## 响应类型

`{ code: number, msg: string }`

## 使用示例

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsbrowse({
  // 根据实际业务填写参数
});
console.log(result);
```
