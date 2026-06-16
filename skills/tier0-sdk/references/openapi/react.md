---
name: tier0-sdk-openapi-react
version: 0.1.0
description: "OpenAPI React Hooks 使用指南 — @tanstack/react-query 集成"
---

# React Hooks 使用指南

## 前置条件

```bash
npm install @tanstack/react-query
```

并在应用根节点包裹 `QueryClientProvider`：

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <YourApp />
    </QueryClientProvider>
  );
}
```

## 使用 Hooks

```tsx
import { useOpenapiv1unsread, useOpenapiv1flowlist } from '@tier0/sdk/openapi/react';

function TemperatureDisplay() {
  const mutation = useOpenapiv1unsread();

  const handleRead = async () => {
    const result = await mutation.mutateAsync({
      topics: ['Plant/Line1/Metric/Temperature'],
    });
    console.log(result);
  };

  return (
    <div>
      <button onClick={handleRead} disabled={mutation.isPending}>
        {mutation.isPending ? '读取中...' : '读取温度'}
      </button>
      {mutation.isError && <p>错误: {mutation.error.message}</p>}
      {mutation.data && <pre>{JSON.stringify(mutation.data, null, 2)}</pre>}
    </div>
  );
}
```

## 所有可用的 Hooks

```typescript
import {
  useGwreload,
  useOpenapiv1info,
  useOpenapiv1flowcreate,
  useOpenapiv1flowdelete,
  useOpenapiv1flowdeploy,
  useOpenapiv1flowflowdata,
  useOpenapiv1flowget,
  useOpenapiv1flowlist,
  useOpenapiv1flowupdate,
  useOpenapiv1unsbrowse,
  useOpenapiv1unscreate,
  useOpenapiv1unsdelete,
  useOpenapiv1unshistory,
  useOpenapiv1unsread,
  useOpenapiv1unsrestore,
  useOpenapiv1unssearch,
  useOpenapiv1unsupdate,
  useOpenapiv1unswrite,
} from '@tier0/sdk/openapi/react';
```

每个 Hook 返回 `UseMutationResult`，包含：
- `mutate(body)` — 触发请求
- `mutateAsync(body)` — 异步触发，返回 Promise
- `data` — 响应数据
- `isPending` — 是否加载中
- `isError` / `error` — 错误状态
- `isSuccess` — 是否成功
