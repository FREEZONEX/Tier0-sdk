---
name: tier0-sdk-openapi-info
version: 0.2.0
description: "POST /openapi/v1/info — 获取 Tier0 服务信息（连通性验证）"
---

# info — `POST /openapi/v1/info`

获取 Tier0 网关服务的基本信息。常用于验证 API 连通性和认证配置是否正确。

## SDK 调用

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.openapiv1info({});
```

## 请求参数

无参数，传空对象 `{}` 即可。

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    version: string;      // 服务版本号
    buildTime?: string;   // 构建时间
    env?: string;         // 运行环境
  };
}
```

## 使用示例

### 验证连通性与认证

```typescript
import { systemApi } from '@tier0/sdk/openapi';

try {
  const result = await systemApi.openapiv1info({});
  console.log('连接成功，版本:', result.data.version);
} catch (error) {
  if (error instanceof Error) {
    // "HTTP 401" → API Key 无效
    // "HTTP 502" / 网络错误 → Host 配置错误
    console.error('连接失败:', error.message);
  }
}
```
