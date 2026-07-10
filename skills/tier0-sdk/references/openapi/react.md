---
name: tier0-sdk-openapi-react
version: 0.2.0
description: "OpenAPI React hooks guide — @tanstack/react-query integration, including polling reads for dashboards"
---

# React Hooks Guide

## Prerequisites

```bash
npm install @tanstack/react-query
```

Wrap the app root with `QueryClientProvider`:

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

## Usage Pattern (read this first)

UNS is a data source, not a UI. Encapsulate **topic paths** and **raw VQT** inside a feature hook / data layer; components consume domain objects and render business information only.

Do not copy the "button → read topic → `JSON.stringify(data)`" shape: it exposes topic paths and raw responses to users, violating the UNS doctrine. The correct shape is "data layer fetches → maps to a domain object → view renders business concepts".

```tsx
import { useState } from 'react';
import { useOpenapiv1unsread } from '@tier0/sdk/openapi/react';

// Data layer: topic paths and raw VQT stay here; only domain objects leave.
function useLine1Temperature() {
  const read = useOpenapiv1unsread();

  const refresh = async () => {
    const res = await read.mutateAsync({
      topics: ['Plant/Line1/Metric/Temperature'],
    });
    const item = res.data.results?.[0];
    // Validate quality; non-Good values are not usable data.
    if (!item?.success || item.result?.quality !== 'Good') return null;
    return {
      celsius: item.result.value.temperature as number,
      updatedAt: item.result.timeStamp as number,
    };
  };

  return { refresh, isLoading: read.isPending, error: read.error };
}

// View layer: renders the business concept (line temperature); users never see topics / MQTT / namespaces.
function Line1TemperatureCard() {
  const { refresh, isLoading, error } = useLine1Temperature();
  const [celsius, setCelsius] = useState<number | null>(null);

  return (
    <section>
      <h3>Line 1 Temperature</h3>
      <p>{celsius != null ? `${celsius} °C` : '—'}</p>
      <button
        onClick={async () => setCelsius((await refresh())?.celsius ?? null)}
        disabled={isLoading}
      >
        {isLoading ? 'Refreshing…' : 'Refresh'}
      </button>
      {error && <p role="alert">Read failed, please retry later</p>}
    </section>
  );
}
```

## Polling Reads for Dashboards (`useQuery` + `refetchInterval`)

The SDK's generated hooks are all mutation-style (imperative trigger). For screens that must stay fresh — dashboards, KPI cards, status boards — wrap the raw API client in a `useQuery` with `refetchInterval` instead of hand-rolling `setInterval`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { unsApi } from '@tier0/sdk/openapi';

// Data layer: polls the current value every 5 s and maps VQT to a domain object.
function useLine1TemperatureLive() {
  return useQuery({
    queryKey: ['line1-temperature'],
    queryFn: async () => {
      const res = await unsApi.openapiv1unsread({
        topics: ['Plant/Line1/Metric/Temperature'],
      });
      const item = res.data.results?.[0];
      if (!item?.success || item.result?.quality !== 'Good') return null;
      return {
        celsius: item.result.value.temperature as number,
        updatedAt: item.result.timeStamp as number,
      };
    },
    refetchInterval: 5_000,        // poll every 5 s
    refetchIntervalInBackground: false, // pause when the tab is hidden
  });
}

function Line1TemperatureLiveCard() {
  const { data, isError } = useLine1TemperatureLive();
  return (
    <section>
      <h3>Line 1 Temperature</h3>
      <p>{data ? `${data.celsius} °C` : '—'}</p>
      {isError && <p role="alert">Connection problem, retrying…</p>}
    </section>
  );
}
```

Guidance:

- Polling `read` is appropriate for **current values** (Metric snapshots, per-instance State topics). Pick an interval matched to how fast the value actually changes (2–10 s for live telemetry, 30 s+ for KPIs).
- Polling is **not** a substitute for subscribing to a shared event-stream topic — intermediate messages are lost between polls (last-write-wins). For event streams, a server-side MQTT subscriber persists events to the app DB and the UI polls the app's own API instead. See `references/core/data-integration.md` → "Transport selection".
- In scaffold apps (MonoApp), the browser should poll the app's own API routes, not Tier0 directly — see `references/scaffolds/monoapptemplate.md`.

## All Available Hooks

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

Each hook returns a `UseMutationResult` with:
- `mutate(body)` — trigger the request
- `mutateAsync(body)` — async trigger, returns a Promise
- `data` — response data
- `isPending` — loading state
- `isError` / `error` — error state
- `isSuccess` — success state
