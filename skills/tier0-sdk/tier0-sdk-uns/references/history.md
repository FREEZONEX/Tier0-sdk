---
name: tier0-sdk-openapi-history
version: 0.6.0
description: "POST /openapi/v1/uns/history — 查询 UNS topic 历史数据"
---

# history — `POST /openapi/v1/uns/history`

**⚠️ 时间格式和聚合参数极易出错，务必读完本文档再调用。**

## 目录

- SDK 调用与请求参数
- App 生成时的服务端调用方式
- 聚合和响应结构
- 原始数据、聚合、多 Topic 与分页示例
- 常见错误

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unshistory(body);
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `topics` | string[] | **是** | topic 路径列表（叶子节点，不支持通配符） |
| `start_time` | string | **是** | 起始时间，**ISO 8601 格式**，如 `"2026-01-01T00:00:00Z"` |
| `end_time` | string | **是** | 结束时间，**ISO 8601 格式**，如 `"2026-01-02T00:00:00Z"` |
| `page` | integer | 否 | 显式分页页码；不传 `page`/`size` 时进入自动稀疏模式 |
| `size` | integer | 否 | **每个 topic** 的页大小，不是整个请求的总条数 |
| `countMode` | `none` \| `exact` | 否 | 默认 `exact` 以兼容已有调用；不需要精确总数时显式传 `none` 免 COUNT |
| `aggregation` | object | 否 | 聚合配置，不传则返回原始数据点 |

### 返回量与自动稀疏

- 不传 `page`/`size`：服务端进入自动稀疏模式，按查询时间窗分桶、每桶取最后一条；例如百万条分钟级数据不会原样返回。默认精确计数后，数据不超过点数上限时仍原样返回。
- 传 `page`/`size`：按原始数据或聚合桶分页，通过 `meta.hasMore` 继续翻页。
- 为保持兼容，显式传入的 `size` 仍是**每个 topic** 的页大小，服务端不会根据 topic 数静默缩小。因此大批量请求应由调用方合理分批并控制响应体。
- 省略 `countMode` 等同于 `countMode=exact`，会执行精确计数；大范围、多 topic 查询会因 COUNT 明显变慢。为兼容旧返回，自动稀疏模式的 `total` 是实际返回点数，原始精确总数见每项 `meta.rawTotal`；显式分页时 `total` 是原始数据或聚合桶的精确总数。
- `countMode=none` 时不执行精确 COUNT，`total=-1`、`totalExact=false`；通过每项 `meta.hasMore` 判断是否继续翻页。
- 自动稀疏与免 COUNT 相互独立：不传 `page`/`size` 控制返回点数，显式 `countMode=none` 控制是否计算精确总数。

### Performance parameter selection

| Scenario | Recommended parameters | Caller behavior |
|---|---|---|
| Raw pages without an exact total | `countMode: 'none'`, explicit `page` and `size` | Treat `size` as the limit **per topic**, batch 50–100 topics per request, keep total HTTP concurrency at 2, and follow each item's `meta.hasMore` |
| UI must display an exact total/page count | Omit `countMode` or set `countMode: 'exact'` | Accept the additional exact `COUNT` cost |
| Trend chart with bounded points | Set `countMode: 'none'` and omit both `page` and `size` | Let automatic sparse sampling choose bounded points; omitting only one pagination field does not select this mode |
| One aggregate for a complete window | `countMode: 'none'`, `aggregation.interval` covering the whole window | Return at most one aggregate bucket per topic; select only the required fields |
| Cumulative Daily/Monthly usage | Two aggregate calls over the same window, one `first` and one `last` | Compute `last - first` in the application; do not use `avg` or `sum` as usage |

`countMode: 'none'` removes exact counting work only; it does **not** reduce the
number or size of returned values. Reduce `size`, use automatic sampling or
aggregation, and batch topics when the response body is the bottleneck. Never
treat `size` as a request-wide limit.

## App 生成时的调用方式

App 页面需要历史列表、趋势图、时间范围数据或历史聚合时，应由服务端调用 history。浏览器只提交业务筛选和时间范围，不接触 Tier0 凭证、原始 topic 路径或 SDK 请求体。

生成 App 时遵循以下边界：

1. 在服务端 service、server action 或 API route 中通过 scaffold 的 `getTier0UnsApi()` 获取客户端。
2. 将页面的设备、产线或指标选择映射为服务端维护的精确叶子 topic；history 不支持通配符，也不接受浏览器提供的任意 topic。
3. 仅查询创建时已开启 `enableHistory` 的 Topic。
4. 趋势图默认使用 `countMode: 'none'` 并同时省略 `page`、`size`，让服务端自动稀疏；原始明细分页才同时传 `page`、`size`，并按每个结果的 `meta.hasMore` 翻页。
5. 检查外层 `data.success` 和每个 topic 的 `success`，再把成功记录转换为页面需要的 DTO。不要把 SDK envelope、topic、VQT 或分页元数据直接返回给 UI。
6. 页面加载或用户改变时间范围时可以重新查询；持续变化和实时监听必须使用 MQTT subscribe，不能轮询 history。

```typescript
// src/services/equipment-history.ts
import { getTier0UnsApi } from '@/lib/tier0';

const TEMPERATURE_TOPICS = {
  line1: 'Plant/Line1/Metric/Temperature',
  line2: 'Plant/Line2/Metric/Temperature',
} as const;

export async function getTemperatureTrend(input: {
  line: keyof typeof TEMPERATURE_TOPICS;
  start: Date;
  end: Date;
}) {
  const topic = TEMPERATURE_TOPICS[input.line];
  const unsApi = await getTier0UnsApi();
  const response = await unsApi.openapiv1unshistory({
    topics: [topic],
    start_time: input.start.toISOString(),
    end_time: input.end.toISOString(),
    countMode: 'none',
    // 同时省略 page/size，趋势图使用自动稀疏模式。
  });

  const item = response.data.results?.[0];
  if (!response.data.success || !item?.success) {
    throw new Error(item?.error?.message ?? 'History query failed');
  }

  return {
    points: (item.result?.values ?? []).map(record => ({
      timestamp: record.timeStamp,
      temperature: (record.value as { temperature?: number }).temperature,
      quality: record.quality,
    })),
  };
}
```

多个 topic 应优先放入同一个 `topics` 数组。数量较多时每批 50–100 个 topic、总 HTTP 并发不超过 2；`size` 是每个 topic 的限制，不是整次请求的总限制。

### aggregation 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `function` | string | 否 | 旧版单字段写法的聚合函数：`avg` / `max` / `min` / `sum` / `count` / `first` / `last` |
| `interval` | string | **是** | 聚合时间窗口：`1m`（分钟）/ `1h`（小时）/ `1d`（天） |
| `field` | string | 否 | 旧版单字段写法的字段名（value 对象内的某个字段，如 `"temperature"`） |
| `fields` | object[] | 否 | 多字段聚合；元素为 `{ name, function? }`，同一字段在一次请求中只能出现一次 |

`fields[].function` 对数值字段默认使用 `avg`，其他字段默认使用 `last`。需要同一字段的 `first` 和 `last` 时分两次请求，不要把累计读数误用 `avg` 或 `sum`。

> **时间格式注意**：`start_time`/`end_time` 必须是 ISO 8601 字符串，**不能传毫秒整数**。CLI 支持相对时间表达式（如 `-1h`、`-7d`），但 SDK 直接调用 API，需要自行在代码中把相对时间转换为 ISO 8601 字符串。

## 响应结构

批量接口，HTTP 200 **不代表每项成功**，需检查 `data.success` 和 `data.results[i].success`：

```typescript
{
  code: number;
  msg: string;
  data: {
    success: boolean;
    total: number;  // 兼容值；自动模式为返回点数，分页模式为精确总数，countMode=none 时为 -1
    totalExact: boolean;
    page: number;
    size: number;
    results: Array<{
      success: boolean;
      topic: string;
      result?: {
        values: Array<{
          value: Record<string, unknown>;  // 业务数据对象
          quality: 'Good' | 'Uncertain' | 'Bad';
          timeStamp: number;              // 数据采集时间，毫秒
        }>;
        meta: {
          aggregated: boolean;
          sampled: boolean;
          rawTotal: number;       // countMode=none 时为 -1
          returnedTotal: number;
          requestedIntervalMs: number;
          actualIntervalMs: number;
          strategy: 'lastRow' | 'timeBucket' | '';
          totalExact: boolean;
          hasMore: boolean;
        };
      };
      error?: { code: number; message: string };
    }>;
  };
}
```

## 使用示例

### 查询最近 1 小时原始数据

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature'],
  start_time: oneHourAgo.toISOString(),  // "2026-06-15T10:00:00.000Z"
  end_time: now.toISOString(),
  // 不传 page/size：由服务端按时间窗自动稀疏
});

const item = result.data.results[0];
if (item.success) {
  for (const record of item.result!.values) {
    const temp = record.value as { temperature: number };
    console.log(new Date(record.timeStamp), temp.temperature);
  }
}
```

### 查询 24 小时按小时聚合均值

```typescript
const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature'],
  start_time: '2026-06-14T00:00:00Z',
  end_time: '2026-06-15T00:00:00Z',
  aggregation: {
    function: 'avg',
    interval: '1h',
    field: 'temperature',  // value 对象内的字段名
  },
});

if (result.data.success) {
  const values = result.data.results[0].result?.values ?? [];
  // 每条 value 代表一个小时的均值
  values.forEach(r => {
    console.log(new Date(r.timeStamp).toISOString(), r.value);
  });
}
```

### 累计表读数：窗口两端相减

Daily/Monthly 冻结寄存器的用量应由应用计算 `last - first`。不新增平台业务表，也不要用 `avg`/`sum` 代替增量。下面两次聚合都省略 `page`/`size`，并让 `interval` 覆盖整个查询窗口，因此每个 topic 最多返回一个边界桶：

```typescript
const topics = ['Plant/Area1/Meter01/Metric/Daily'];
const window = {
  start_time: '2026-06-01T00:00:00Z',
  end_time: '2026-06-08T00:00:00Z',
};
const fields = ['electricity', 'water', 'heat'];

const queryBoundary = (fn: 'first' | 'last') =>
  unsApi.openapiv1unshistory({
    topics,
    ...window,
    countMode: 'none',
    aggregation: {
      interval: '8d', // 必须不小于完整查询窗口
      fields: fields.map(name => ({ name, function: fn })),
    },
  });

const [first, last] = await Promise.all([
  queryBoundary('first'),
  queryBoundary('last'),
]);

// 应用层按 topic 和字段计算 last - first。
```

### 多 topic + 分页

```typescript
const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature', 'Plant/Line1/Metric/Humidity'],
  start_time: '2026-06-01T00:00:00Z',
  end_time: '2026-06-08T00:00:00Z',
  page: 1,
  size: 100,
  countMode: 'none',
});

for (const item of result.data.results) {
  if (!item.success) {
    console.error(`${item.topic} 查询失败: ${item.error?.message}`);
    continue;
  }
  console.log(`${item.topic}: ${item.result!.values.length} 条记录`, item.result!.meta.hasMore);
}
```

下面写法与省略 `countMode` 等价，适用于必须显示精确总页数的兼容调用：

```typescript
const result = await unsApi.openapiv1unshistory({
  topics: ['Plant/Line1/Metric/Temperature'],
  start_time: '2026-06-01T00:00:00Z',
  end_time: '2026-06-08T00:00:00Z',
  page: 1,
  size: 100,
  countMode: 'exact',
});
```

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `start_time` 格式报错 | 传入了毫秒整数（如 `1733382000000`） | 改为 ISO 字符串：`new Date(ts).toISOString()` |
| `aggregation.field` 无数据 | 字段名和 value 对象里的 key 不一致 | 先 `read` 一条确认 value 的字段名 |
| `values` 为空 | 时间范围内无数据，或 topic 路径错误 | 确认 topic 存在且时间范围正确 |
| `total` 为 `-1` | 请求显式设置了 `countMode: 'none'` | 使用每项 `meta.hasMore` 分页；必须展示总页数时省略该字段或设为 `exact` |
