---
name: tier0-sdk-openapi-react
version: 0.1.1
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

## 使用模式（先读这一段）

UNS 是数据源，不是界面。把 **topic 路径**和**原始 VQT** 封装在 feature hook / 数据层里，组件只消费领域对象、渲染业务信息。

不要照抄「按钮 → 读 topic → `JSON.stringify(data)`」这种写法：那会把 topic 路径和原始响应直接暴露给用户，违背 UNS 理念。正确做法是「数据层拿数 → 映射成领域对象 → 视图层渲染业务概念」。

下面的 `refresh` 只演示一次性读取当前快照。需要持续变化、实时或一直监听的数据时，必须使用 MQTT `subscribe`，不要给 OpenAPI `read` 配置 `setInterval`、`refetchInterval` 或循环轮询。断线补偿仅在 Topic 已开启 `enableHistory` 时使用 OpenAPI `history`。

```tsx
import { useState } from 'react';
import { useOpenapiv1unsread } from '@tier0/sdk/openapi/react';

// 数据层：topic 路径与原始 VQT 都留在这里，对外只暴露领域对象
function useLine1Temperature() {
  const read = useOpenapiv1unsread();

  const refresh = async () => {
    const res = await read.mutateAsync({
      topics: ['Plant/Line1/Metric/Temperature'],
    });
    const item = res.data.results?.[0];
    // 校验 quality，非 Good 不当作可用数据
    if (!item?.success || item.result?.quality !== 'Good') return null;
    return {
      celsius: item.result.value.temperature as number,
      updatedAt: item.result.timeStamp as number,
    };
  };

  return { refresh, isLoading: read.isPending, error: read.error };
}

// 视图层：只呈现业务概念（产线温度），用户看不到 topic / MQTT / 命名空间
function Line1TemperatureCard() {
  const { refresh, isLoading, error } = useLine1Temperature();
  const [celsius, setCelsius] = useState<number | null>(null);

  return (
    <section>
      <h3>产线 1 温度</h3>
      <p>{celsius != null ? `${celsius} °C` : '—'}</p>
      <button
        onClick={async () => setCelsius((await refresh())?.celsius ?? null)}
        disabled={isLoading}
      >
        {isLoading ? '刷新中…' : '刷新'}
      </button>
      {error && <p role="alert">读取失败，请稍后重试</p>}
    </section>
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
