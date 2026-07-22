---
name: tier0-sdk-openapi-vue
version: 0.1.1
description: "OpenAPI Vue3 Composables 使用指南"
---

# Vue3 Composables 使用指南

## 前置条件

```bash
npm install vue
```

## 使用模式（先读这一段）

UNS 是数据源，不是界面。把 **topic 路径**和**原始 VQT** 封装在 composable / 数据层里，组件只消费领域对象、渲染业务信息。

不要照抄「按钮 → 读 topic → `JSON.stringify(data)`」这种写法：那会把 topic 路径和原始响应直接暴露给用户，违背 UNS 理念。正确做法是「数据层拿数 → 映射成领域对象 → 视图层渲染业务概念」。

下面的 `refresh` 只演示一次性读取当前快照。需要持续变化、实时或一直监听的数据时，必须使用 MQTT `subscribe`，不要给 OpenAPI `read` 配置定时器或循环轮询。断线补偿仅在 Topic 已开启 `enableHistory` 时使用 OpenAPI `history`。

```ts
// composables/useLine1Temperature.ts —— 数据层：topic 路径与原始 VQT 都留在这里
import { ref } from 'vue';
import { useOpenapiv1unsread } from '@tier0/sdk/openapi/vue';

export function useLine1Temperature() {
  const { loading, error, execute } = useOpenapiv1unsread();
  const celsius = ref<number | null>(null);

  const refresh = async () => {
    const res = await execute({ topics: ['Plant/Line1/Metric/Temperature'] });
    const item = res?.data?.results?.[0];
    // 校验 quality，非 Good 不当作可用数据
    celsius.value =
      item?.success && item.result?.quality === 'Good'
        ? (item.result.value.temperature as number)
        : null;
  };

  return { celsius, loading, error, refresh };
}
```

```vue
<!-- 视图层：只呈现业务概念（产线温度），用户看不到 topic / MQTT / 命名空间 -->
<script setup lang="ts">
import { useLine1Temperature } from '@/composables/useLine1Temperature';

const { celsius, loading, error, refresh } = useLine1Temperature();
</script>

<template>
  <section>
    <h3>产线 1 温度</h3>
    <p>{{ celsius != null ? `${celsius} °C` : '—' }}</p>
    <button @click="refresh" :disabled="loading">
      {{ loading ? '刷新中…' : '刷新' }}
    </button>
    <p v-if="error" role="alert">读取失败，请稍后重试</p>
  </section>
</template>
```

## 所有可用的 Composables

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
} from '@tier0/sdk/openapi/vue';
```

每个 Composable 返回：
- `data` — 响应数据（`ref`）
- `loading` — 是否加载中（`ref<boolean>`）
- `error` — 错误对象（`ref<Error | null>`）
- `execute(body)` — 触发请求（异步函数）
