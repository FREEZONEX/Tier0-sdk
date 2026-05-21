---
name: tier0-sdk-openapi-create
version: 0.1.0
description: "POST /openapi/v1/uns/create — NodeCreateReq"
---

# create — `POST /openapi/v1/uns/create`

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate(body);
```

## 请求参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `namespace` | array |  **required** |

## 响应类型

`{ code: number, msg: string }`

## 使用示例

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate({
  // 根据实际业务填写参数
});
console.log(result);
```
