---
name: tier0-sdk-app-statistics-design
version: 0.3.0
description: "使用 Tier0 数据能力或运行于 Tier0 托管环境的 App 统计需求设计：业务口径、UNS topic、Source Flow、App 服务与前端调用。"
---

# App 统计需求设计

用于 Dashboard、Trend、范围分布、多维分析、同比/环比等重复访问的业务统计。仅使用其他 API 或数据库、没有 Tier0 依赖的 App 不适用。

## 1. 选择实现方式

| 场景 | 实现 |
|---|---|
| 少量实体的临时趋势或诊断 | 直接查原始 topic；按需使用 history 聚合、自动稀疏或 `countMode: 'none'` |
| 固定口径且反复访问的统计 | Source Flow 持续物化有界统计 topic；App 批量读取 |
| 任意维度组合、高基数钻取或事务统计 | App 统计表、分析库或数仓 |

默认链路：

```text
Telemetry / Daily / Monthly
  -> Source Flow：规范化、增量、范围汇总、分桶、校准
  -> _Statistics：Current + Minute/Hourly/Daily/Monthly/Yearly
  -> App Server：选择范围和粒度，读取 UNS，组合 App DB
  -> Frontend：一次页面级 bundle 请求
```

前端不接收 topic、VQT、分页或统计公式。一个页面按数据集请求，不能让每张卡片分别查询 history。

## 2. 定义数据契约

先读取真实 topic schema，再确定以下内容：

| 数据类型 | 处理 |
|---|---|
| 累计寄存器 `register` | 相邻有效值求增量；处理 reset、rollover、换表和异常回退 |
| 区间值 `interval` | 按业务时间直接归桶，不再求差 |
| 瞬时值 `gauge` | 保存每个实体的最新值，再做范围求和或时间加权平均 |

必须明确：

- 业务时间字段、时区和周期边界；平台接收时间只作兜底。
- 指标单位、可加性和覆盖率；不同单位不能相加。
- 主源与校准源；例如 Telemetry 提供实时估算，Daily/Monthly 校准，不能重复累加。
- reset、换表、缺数、迟到、修订和开放周期口径。
- 源数据可承诺的粒度；日冻结数据不能生成伪分钟统计。

累计值的持久 cursor 至少包含：

```text
anchorValue, carryUsage, lastRawValue, lastNormalizedUsage,
lastBusinessTime, lastFingerprint, epoch
```

正常增量：

```text
normalized = carryUsage + currentRaw - anchorValue
delta      = normalized - lastNormalizedUsage
```

## 3. 建模统计 topic

### 路径

只为产品预声明的聚合范围建 topic：

```text
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Current
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Minute
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Hourly
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Daily
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Monthly
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Yearly
```

统计范围是固定 schema 规则的受限例外：

- Topic manifest 必须列出范围并声明正整数 `maxStatisticScopes`；达到上限后拒绝创建。
- `scopeSlug` 必须稳定、可读且不含 `/`；禁止 UUID、数据库主键和用户查询值。
- 新增范围必须修改 manifest；禁止按 App 目录记录在运行时无限建 topic。
- 普通设备、订单和客户仍使用共享 topic，实例 id 放在 payload。

所有叶子必须满足 `.../(Metric|Action|State)/<leaf>`，并在 App 初始化时通过 UNS `create` 显式建模。

### 写入和历史

| Topic | create | write/publish | 用途 |
|---|---|---|---|
| `Current` | `enableHistory: false` | 单独写入，显式 `retain: true` | 当前 KPI、开放周期、实时 gauge、覆盖率 |
| 时间桶 | `enableHistory: true` | 通常 `retain: false`，`timeStamp=periodEnd` | 趋势、分布和周期比较 |

`retain` 是写入参数，不是 topic schema 属性。输入订阅必须排除 `{namespace}/_Statistics/#`，避免 Flow 消费自己的输出。

### 粒度和 payload

| 粒度 | 典型窗口 | 每 topic 建议上限 |
|---|---|---:|
| Minute/FiveMinute | 24h | 1,500 |
| Hourly | 7d/30d | 1,000 |
| Daily | 中长期 | 800 |
| Monthly/Yearly | 同比和多年趋势 | 240 / 产品窗口 |

选择满足展示要求且不超过上限的最细粒度；超限时换更粗 topic，不翻页拼接细粒度响应。

Metric payload 保持平铺，只声明页面需要的字段。以下是片段，不是完整字段清单：

```typescript
type CurrentValue = {
  currentDayUsage: number;
  currentMonthUsage: number;
  currentYearUsage: number;
  currentGauge?: number;
  actualCount: number;
  expectedCount: number;
  revision: number;
  statusCode?: string;
};

type PeriodValue = {
  usage: number;
  actualCount: number;
  expectedCount: number;
  revision: number;
  statusCode?: string;
};
```

VQT `quality` 只使用 `Good | Uncertain | Bad`。无法解释的累计值使用 `quality=Bad`；业务状态可用 `statusCode=Invalid`，`Invalid` 不是 VQT quality。

## 4. 实现六段 Source Flow

| 阶段 | 必须实现 |
|---|---|
| Catalog | 维护实体到范围的有效期、权重、`leaf/subtotal/excluded` 和 `joinOffset`；防止总表与分表重复统计 |
| Normalize | 统一 profile、业务时间、register/interval/gauge、质量和 fingerprint；拦截坏 schema、坏质量及统计输出 topic |
| Meter Delta | 持久化 cursor；处理去重、reset、rollover、换表和异常下降 |
| Scope Accumulator | 将有效 delta fan-out 到已声明范围；gauge 使用“减旧值、加新值”，不能按上报次数累加 |
| Close Period | 按业务时区封桶；Current 合并写入，关闭桶才写 history；失败进入有界重试和死信 |
| Reconcile | 用更权威的冻结数据重算受影响桶和上级范围；变化时增加 `revision` |

累计事件必须先按 `sourceKey` 进入业务时间缓冲区。维护 `maxSeenBusinessTime`、`watermark`、排序后的 `pendingEvents` 和 `lastAppliedBusinessTime`，只按业务时间顺序推进 cursor。越过水位线的迟到或修订事件不能直接与最新 cursor 求差，必须重算该源受影响的 delta 链，再以 `correction = newValue - oldValue` 修正相关桶。

App 对同一范围、粒度和周期选择最高 `revision`，并过滤 VQT `quality=Bad` 或 `statusCode=Invalid` 的记录。Flow 状态使用 Redis 或 Node-RED 持久 context，不能只放进程内存。

## 5. App 服务和前端调用

App Server 只接受业务范围、窗口和允许的筛选项；topic allowlist、粒度选择、质量检查和 DTO 映射留在服务端。

浏览器只调用一个页面 bundle。服务端可把精确 topic 列表按每批 50–100 个拆分，总并发不超过 2；不能循环发出几十次原始 history。

```typescript
import { getTier0UnsApi } from '@/lib/tier0';

const MAX_POINTS_PER_TOPIC = 1500;
const TOPICS_PER_REQUEST = 100;
const MAX_UNS_CONCURRENCY = 2;

export async function getAnalyticsBundle(input: AnalyticsQuery) {
  const plan = resolveStatisticsPlan(input); // 服务端 allowlist
  assertExpectedPointsAtMost(plan, MAX_POINTS_PER_TOPIC);

  const unsApi = await getTier0UnsApi();
  const responses = await mapWithConcurrency(
    chunk(plan.scopeTopics, TOPICS_PER_REQUEST),
    MAX_UNS_CONCURRENCY,
    topics => unsApi.openapiv1unshistory({
      topics,
      start_time: plan.start.toISOString(),
      end_time: plan.end.toISOString(),
      page: 1,
      size: MAX_POINTS_PER_TOPIC,
      countMode: 'none',
    }),
  );

  responses.forEach(response => {
    assertBatchSuccess(response);
    assertNoTruncation(response); // 每项 meta.hasMore=false
  });
  return buildAnalyticsDto(mergeBatchResponses(responses), plan);
}
```

24 小时 Minute 约 1,440 点，可被 1,500 点预算覆盖。出现 `hasMore=true` 时改用更粗 topic。批量 Current `read` 使用相同 topic 分批和并发限制。

前端只消费业务 DTO，并对筛选切换做 debounce、取消旧请求、相同查询键合并和短 TTL 缓存。

## 6. 业务示例

| 需求 | UNS | Flow / App 输出 |
|---|---|---|
| 范围 Dashboard 与当前周期总览 | 所选范围 `Current` | Accumulator 维护当前周期和 gauge；bundle 合并目录、在线与告警摘要 |
| 电、水、热用量趋势 | 按窗口选 Hourly/Daily/Monthly/Yearly | Delta 后分桶；一次 bundle 返回不同单位的 series，不跨单位相加 |
| 范围分布 | 子范围 Current 或 Daily/Monthly | 按受控 topic 批次读取，返回占比、排名和 Top N |
| 多维分析 | 既有范围及预声明的有限 Dimension | 只 fan-out 到声明维度；App pivot 为 series、matrix 或 ranking |
| 同比、环比 | Daily/Monthly/Yearly | 一次 history 覆盖当前、上一周期和去年同期，App 按固定周期口径切分 |

任意字段、任意组合或高基数钻取改用 App 分析表或数仓，不生成 topic 笛卡尔积。

## 7. 交付检查

1. 定义指标、单位、业务时间、register/interval/gauge、主源/校准源和异常口径。
2. 提交 Topic manifest：范围、`maxStatisticScopes`、粒度、fields、`enableHistory`、单位和 point limit。
3. 实现六段 Flow：持久 cursor、去重、事件时间排序、修订、重启恢复、死信和防反馈环路。
4. Current 单独写入并设置 `retain: true`；时间桶使用 `timeStamp=periodEnd`。
5. 页面只调用一个 App bundle；服务端每批 50–100 topics、总并发不超过 2，并使用 `countMode: 'none'`。
6. 覆盖重复、乱序、迟到、reset/rollover/换表、范围迁移、时区边界、坏质量、空窗口和点数上限。
7. Dashboard 等主路径不遍历原始实体 history，也不把它作为隐藏兜底。
