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

// ⚠️ HTTP 200 不代表每项成功，必须检查 results[i].success
const item = result.data.results[0];
if (item.success && item.result?.quality === 'Good') {
  // item.result.value — 业务数据对象，如 { temperature: 27.5, unit: 'C' }
  // item.result.timeStamp — 数据采集时间（毫秒）
  console.log(item.result.value);
}
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

// value 必须是对象（字段名→值），不能是裸数字/字符串
// 如需记录采集时刻，用 timeStamp（毫秒），禁止在 value 里写 _timestamp
const result = await unsApi.openapiv1unswrite({
  writes: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      value: { temperature: 27.5, unit: 'C' },
      timeStamp: Date.now(),
    },
  ],
});

// 检查写入结果
if (!result.data.success) {
  result.data.results.filter(r => !r.success)
    .forEach(r => console.error(r.topic, r.error?.message));
}
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

SDK 有两层错误需要处理：

```typescript
import { unsApi } from '@tier0/sdk/openapi';

// 层级 1：网络/认证错误 → try/catch
try {
  const result = await unsApi.openapiv1unsread({
    topics: ['Plant/Line1/Metric/Temperature'],
  });

  // 层级 2：批量接口业务错误 → 检查 results[i].success
  // HTTP 200 不代表每项成功！
  for (const item of result.data.results) {
    if (!item.success) {
      console.error(`${item.topic} 失败: ${item.error?.message}`);
    }
  }
} catch (error) {
  if (error instanceof Error) {
    // HTTP 4xx/5xx 或网络错误
    console.error(error.message); // "HTTP 401: Unauthorized"
  }
}
```
