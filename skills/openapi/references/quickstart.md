---
name: tier0-sdk-openapi-quickstart
version: 0.1.0
description: "OpenAPI 模块快速开始：环境变量配置、configureClient、基础 API 调用"
---

# OpenAPI 快速开始

## 环境变量配置

SDK 优先从环境变量读取配置，无需代码中硬编码。

| 变量 | 必需 | 说明 |
|------|------|------|
| `TIER0_API_HOST` / `VITE_TIER0_API_HOST` | 是 | OpenAPI 服务地址（gwsvr），如 `api.tier0.cloud` |
| `TIER0_API_KEY` / `VITE_TIER0_API_KEY` | 是 | API 认证密钥 |

### 运行时传入（覆盖环境变量）

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  apiHost: 'gwsvr.default.svc',
  apiKey: 'your-api-key',
});
```

### 动态获取（适用于密钥轮换场景）

```typescript
import { configureClient } from '@tier0/sdk/openapi';

configureClient({
  getApiHost: () => process.env.TIER0_API_HOST,
  getApiKey: () => {
    // 从安全存储或认证服务获取
    return localStorage.getItem('tier0_api_key') || undefined;
  },
});
```

## 基础调用

### 读取 UNS 数据点

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
});
// result: components["schemas"]["NamespaceNode"][]
```

### 浏览命名空间

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const nodes = await unsApi.openapiv1unsbrowse({
  path: 'Plant/Line1',
  include_metadata: true,
});
```

### 写入数据

```typescript
import { unsApi } from '@tier0/sdk/openapi';

await unsApi.openapiv1unswrite({
  writes: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      value: { temperature: 27.5, unit: 'C' },
    },
  ],
});
```

### 列出 Flow

```typescript
import { flowApi } from '@tier0/sdk/openapi';

const flows = await flowApi.openapiv1flowlist({
  flowType: 'source',
});
```

## 类型使用

所有类型从 `types.ts` 导出：

```typescript
import type { components } from '@tier0/sdk/openapi';

type BrowseReq = components['schemas']['BrowseReq'];
type FlowInfo = components['schemas']['FlowInfo'];
```

## 错误处理

```typescript
import { unsApi } from '@tier0/sdk/openapi';

try {
  const result = await unsApi.openapiv1unsread({ topics: ['invalid'] });
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message); // "HTTP 404: ..."
  }
}
```
