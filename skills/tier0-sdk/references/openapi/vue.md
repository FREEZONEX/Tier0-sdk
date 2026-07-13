---
name: tier0-sdk-openapi-vue
version: 0.2.0
description: "OpenAPI Vue3 composables guide"
---

# Vue3 Composables Guide

## Prerequisites

```bash
npm install vue
```

## Usage Pattern (read this first)

UNS is a data source, not a UI. Encapsulate **topic paths** and **raw VQT** inside a composable / data layer; components consume domain objects and render business information only.

Do not copy the "button → read topic → `JSON.stringify(data)`" shape: it exposes topic paths and raw responses to users, violating the UNS doctrine. The correct shape is "data layer fetches → maps to a domain object → view renders business concepts".

```ts
// composables/useLine1Temperature.ts — data layer: topic paths and raw VQT stay here
import { ref } from 'vue';
import { useOpenapiv1unsread } from '@tier0/sdk/openapi/vue';

export function useLine1Temperature() {
  const { loading, error, execute } = useOpenapiv1unsread();
  const celsius = ref<number | null>(null);

  const refresh = async () => {
    const res = await execute({ topics: ['Plant/Line1/Metric/Temperature'] });
    const item = res?.data?.results?.[0];
    // Validate quality; non-Good values are not usable data.
    celsius.value =
      item?.success && item.result?.quality === 'Good'
        ? (item.result.value.temperature as number)
        : null;
  };

  return { celsius, loading, error, refresh };
}
```

```vue
<!-- View layer: renders the business concept (line temperature); users never see topics / MQTT / namespaces -->
<script setup lang="ts">
import { useLine1Temperature } from '@/composables/useLine1Temperature';

const { celsius, loading, error, refresh } = useLine1Temperature();
</script>

<template>
  <section>
    <h3>Line 1 Temperature</h3>
    <p>{{ celsius != null ? `${celsius} °C` : '—' }}</p>
    <button @click="refresh" :disabled="loading">
      {{ loading ? 'Refreshing…' : 'Refresh' }}
    </button>
    <p v-if="error" role="alert">Read failed, please retry later</p>
  </section>
</template>
```

## All Available Composables

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

Each composable returns:
- `data` — response data (`ref`)
- `loading` — loading state (`ref<boolean>`)
- `error` — error object (`ref<Error | null>`)
- `execute(body)` — trigger the request (async function)
