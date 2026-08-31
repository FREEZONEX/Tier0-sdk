---
name: tier0-sdk-app-statistics-design
version: 0.2.1
description: "Builder 在使用 Tier0 数据能力或运行于 Tier0 托管环境的 App 中实现统计需求时的设计方法，包括业务口径、UNS topic、Source Flow、数据结构、App 服务和前端单次调用。"
---

# App 中涉及统计需求时的设计

当一个使用 Tier0 数据能力或运行于 Tier0 托管环境的 App 包含 Dashboard、Trend、范围分布、多维分析或同比/环比等统计需求时，先完成统计数据链路设计，再写页面。仅使用其他 API 或数据库、没有 Tier0 依赖的 App 不适用本文。

本文的业务示例来自一个真实的综合表计 App，已经泛化掉项目名、设备数量和完整业务字段。它不是要求 Builder 生成一类独立的“统计 App”，而是要求任何 App 在出现统计需求时，正确设计原始数据、UNS 统计 topic、Flow 物化、App 服务和前端调用。

## 目录

- 设计目标和选择边界
- 源数据语义
- 通用 UNS 统计 topic
- 六段 Source Flow
- App 服务与前端调用
- 真实业务需求示例
- Builder 交付清单

## 1. 设计目标和选择边界

### 1.1 默认架构

```text
原始 Telemetry / Daily / Monthly topics
  -> Source Flow：目录映射、业务时间、去重、增量、范围汇总、分桶、校准
  -> _Statistics：Current + Hourly/Daily/Monthly/Yearly 等有界统计 topics
  -> App Server：选择范围和粒度，执行受控批量 read/history，组合 App DB 数据
  -> Frontend：一次页面级 bundle 请求，直接渲染业务 DTO
```

关键原则：

- 高频访问且口径固定的统计，在数据到达时持续物化，不在页面请求时扫描所有原始 topic。
- 前端不认识 UNS topic、VQT、分页、`first/last` 或统计公式；这些都属于 App 服务层和 Flow。
- 一个页面按“数据集”请求，不按“KPI 卡片”请求。同一批数据必须同时服务总量、趋势、范围分布和周期比较等多个组件。
- “一次页面调用”指浏览器只调用一个 App bundle。App 服务可以把精确 topic 列表按每批 50–100 个拆成少数有界 UNS 请求，总并发不超过 2，并与 App DB 查询并行；不能循环发出几十次原始 history。
- 不把图表类型当成数据模型。先定义业务指标、范围、时间语义和可加性，再决定折线图、饼图或表格。

### 1.2 三种实现方式

| 场景 | 默认实现 |
|---|---|
| 单个或少量实体的临时趋势、详情和诊断 | 直接读取原始 topic；按需使用 history 聚合、自动稀疏和 `countMode: 'none'` |
| Dashboard、Trend、范围分布、多维分析、同比/环比等重复统计 | Source Flow 物化范围统计 topic，App 批量读取 |
| 任意维度组合、高基数钻取、复杂关联或事务型统计 | App 自有统计表、分析库或数仓；不要创建无限增长的 topic 立方体 |

UNS statistic topics 适合表达可共享、持续更新、范围和维度有界的业务指标。App DB 继续负责范围目录、权限、设备资料和其他 App 自有数据。

## 2. 源数据语义

综合表计场景至少要区分下面三类源数据。字段名因接入协议而异，Builder 必须读取真实 schema，不能照抄示例名。

| Profile | 常见语义 | 统计用途 |
|---|---|---|
| Telemetry | 业务时间、累计寄存器、功率/电压/电流等瞬时值 | 实时状态、短周期增量和瞬时趋势 |
| Daily | 日冻结累计值，或已经按小时拆分的区间值 | 日用量权威校准、小时/日统计 |
| Monthly | 月账期累计值或月初/月末边界 | 月度对账和历史修订 |

必须先冻结以下口径：

- **业务时间**：优先使用 payload 中的 RTC、日期或账期时间；平台接收时间只作为兜底和审计时间。
- **累计值**：通过相邻有效值求 delta，处理 reset、rollover、换表和异常回退。
- **区间值**：直接归入对应桶，不再做一次差值。
- **瞬时 gauge**：功率、电压和电流不能按消息累加；范围当前值按每个实体的最新状态汇总。
- **主源和校准源**：例如 Telemetry 可提供及时估算，Daily/Monthly 负责校准；禁止把两套 profile 同时累加。
- **单位**：电、水、热等不同单位分别统计，不能为了“总能耗”直接相加。
- **可承诺粒度**：如果源数据只有日冻结，就不能生成看似精确的分钟/小时用量。

## 3. 通用 UNS 统计 topic

### 3.1 范围模型

只为 App 实际需要集合统计的稳定范围建 topic，例如：

- `Root`：整个业务命名空间。
- `Region`：区域筛选、对比和排名。
- `Building`：楼栋概览、排名和单位面积指标。
- `Household`：只有产品确实需要批量住户统计时才建；单户详情通常直接读少量原始 topic。
- `Dimension`：业务明确且成员有限的派生维度，如住户类型；不能由任意查询动态创建。

范围成员关系必须来自 App 目录或明确配置，并保存 `leaf/subtotal/excluded`、有效期、权重和加入偏移。不能仅凭 topic 字符串猜归属，也不能把总表和分表同时计入上级范围。

统计范围 topic 是固定 schema 规则的受限例外。只有产品预先声明、数量有硬上限、需要独立 retained Current 或独立历史的聚合范围才允许占用路径段；路径使用不含 `/` 的人类可读稳定 `scopeSlug`，不能使用 UUID、数据库主键或用户查询值。Topic manifest 必须列出范围并声明正整数 `maxStatisticScopes`，新增范围走 manifest 变更，达到上限后拒绝创建，禁止根据 App 目录记录在运行时无限建 topic。普通设备、订单、客户等实体仍使用共享 topic，并把实例 id 放进 payload。

### 3.2 Topic 家族

沿用一个范围、一个粒度、一个组合 payload 的设计，使同一响应可同时派生多个指标：

```text
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Current
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Minute
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Hourly
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Daily
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Monthly
{namespace}/_Statistics/{scopeType}/{scopeSlug}/Metric/Yearly
```

约束：

- 所有叶子符合 `.../(Metric|Action|State)/<leaf>`，统计结果通常使用 `Metric`。
- topic 必须在 App 初始化阶段通过 UNS `create` 显式建模，禁止依赖首次 publish 懒创建。
- `Current` 创建时通常设置 `enableHistory: false`；Publisher 每次写入 Current 时必须在 UNS write 或 MQTT publish 上显式设置 `retain: true`，只保存最新统计包。`retain` 是写入参数，不是 topic schema 属性。
- 时间桶 topic 开启 history；`WriteItem.timeStamp` 使用业务周期的 `periodEnd`，不是 Flow 补算或接收时间。
- 只创建页面实际使用的粒度。Minute 通常只用于 Root 或少量高频范围，Building 可从 Hourly/Daily 开始。
- 输入订阅必须排除 `{namespace}/_Statistics/#`，防止 Flow 消费自己的统计输出。

### 3.3 粒度职责

| Topic | 典型用途 | 建议每条 series 上限 |
|---|---|---:|
| `Current` | 当前 KPI、今天/本月/本年开放周期、实时 gauge、覆盖率 | 最新 1 点 |
| `Minute` 或 `FiveMinute` | 24h 精细趋势 | 1,500 点 |
| `Hourly` | 7d/30d 趋势 | 1,000 点 |
| `Daily` | 中长期趋势和周期比较 | 800 点 |
| `Monthly` | 同比和多年趋势 | 240 点 |
| `Yearly` | 多年汇总 | 按产品窗口限制 |

App 根据时间范围选择满足展示要求且不超过点数上限的最细可用粒度。超过上限时逐级切换到更粗的 topic，不通过翻页拼接细粒度大响应。

### 3.4 最小 payload 片段

Metric schema 使用平铺基础字段。下面只展示少量语义片段，不是完整字段清单：

```typescript
type CurrentStatistics = {
  currentDayUsage: number;
  currentMonthUsage: number;
  currentGauge: number;
  actualCount: number;
  expectedCount: number;
  revision: number;
  statusCode?: string;
};

type PeriodStatistics = {
  usage: number;
  cumulativeEnd?: number;
  averageGauge?: number;
  actualCount: number;
  expectedCount: number;
  revision: number;
  statusCode?: string;
};
```

真实 topic 只声明页面所需字段，并给字段附上明确单位。VQT 已提供 `timeStamp` 和 `quality`；业务周期由 topic 粒度和 `timeStamp=periodEnd` 表达，无需复制完整时间对象。

## 4. 六段 Source Flow

统计 Flow 应拆成可观察、可重放的六段，而不是一个巨大的 Function 节点。

### Flow 1：Catalog

维护实体到 Root/Region/Building/Household/Dimension 的有效范围关系：

```text
entity -> scopes[] + aggregationRole + weight + validFrom/validTo + joinOffset
scope  -> expected leaf members
```

实体迁移时先关闭旧归属，再加入新归属，并只修订受影响范围。`joinOffset` 防止一台已经运行很久的累计表在加入新范围时把全部历史一次性带入。

### Flow 2：Normalize and Deduplicate

把不同 profile 规范成内部事件：

```text
sourceKey, resourceType, profile, businessTime,
valueKind(register | interval | gauge), value, quality, fingerprint
```

去重键至少包含源、profile、业务时间和 payload hash。相同业务时间但内容发生变化时视为修订，而不是重复累加。无效 schema、坏质量和 `/_Statistics/` 输出 topic 必须在这里拦截。

累计源必须按 `sourceKey` 维护事件时间缓冲区：`maxSeenBusinessTime`、`watermark`、按 `businessTime` 排序的 `pendingEvents` 和 `lastAppliedBusinessTime`。在允许迟到窗口内，只按业务时间顺序释放 `businessTime <= watermark` 的事件给 Meter Delta。已经早于 `lastAppliedBusinessTime` 才到达的事件或历史修订不能直接与最新 cursor 求差，必须进入该源受影响窗口的重算队列，再由 Reconcile 修正相关桶。

### Flow 3：Meter Delta

为每个累计源保存持久 cursor：

```text
anchorValue, carryUsage, lastRawValue, lastNormalizedUsage,
lastBusinessTime, lastFingerprint, epoch, quality
```

正常累计值：

```text
normalized = carryUsage + currentRaw - anchorValue
delta      = normalized - lastNormalizedUsage
```

处理规则：

- 重复值产生 `delta=0`，不重复累计。
- 可确认 reset/rollover/换表时开启新 epoch，但范围累计不归零。
- 无法解释的下降不写负用量，将来源 VQT `quality` 标为 `Bad`，并把业务字段 `statusCode` 标为 `Invalid` 后进入补算队列；`Invalid` 不是 VQT quality。
- 直接区间值跳过 register delta，按业务时间归桶。

### Flow 4：Scope Accumulator

每个有效 delta fan-out 到 Catalog 声明的范围：

```text
entity delta
  -> Root
  -> Region
  -> Building
  -> bounded Dimension（适用时）
```

瞬时 gauge 采用最新状态替换：

```text
scopeCurrent = scopeCurrent - entityPrevious + entityCurrent
```

不能把每次上报的功率直接相加。平均值按时间加权；超过新鲜度阈值的实体从 `actualCount` 中移除。

### Flow 5：Close Period and Publish

- Current：有效事件后合并写入，避免同一批上报造成写放大；调用 UNS write 或 MQTT publish 时显式设置 `retain: true`。
- Minute/Hourly/Daily/Monthly/Yearly：按业务时区封桶。
- Current 和时间桶必须分开写；时间桶通常使用 `retain: false`，不能把 `retain` 当作 UNS create 参数。
- 每个桶使用确定的业务键；payload 写 `revision`、`actualCount/expectedCount`，`WriteItem` 顶层写受支持的 VQT `quality`。
- `timeStamp=periodEnd`；开放桶只更新 Current，关闭桶才写 history。
- 写失败进入有界重试和死信，不静默丢失。

### Flow 6：Reconcile and Revision

使用更权威的 Daily/Monthly 冻结数据校准实时估算：

1. 找到受影响的小时、日、月、年桶。
2. 重算正确值，并以 `correction = newValue - oldValue` 修正所有上级范围。
3. 结果未变化时不发布；变化时增加 revision。
4. App 对相同范围、粒度和周期只使用最高 revision，并过滤 VQT `quality=Bad` 或业务字段 `statusCode=Invalid` 的记录。
5. Flow 重启后从持久 context 恢复，并只补最近小窗口，不扫描全部历史。

持久状态可使用平台允许的 Redis 或 Node-RED 持久 context。不能只放进程内存。

## 5. App 服务与前端调用

### 5.1 服务入口

App Server 建立统一统计访问层，例如：

```text
getDashboardBundle(scope)
getTrendBundle(scope, range)
getScopeDistributionBundle(scope, range)
getMultiDimensionalBundle(scope, range, dimensions)
getPeriodComparisonBundle(scope, range)
```

这些入口只接收业务范围、窗口和允许的筛选项，不接收浏览器提交的任意 topic。topic allowlist、范围成员、粒度选择和字段映射全部留在服务端。

### 5.2 单次 App bundle 内的受控批量读取

MonoApp 服务端通过 `getTier0UnsApi()` 延迟加载 SDK。下面示例只展示调用形态：

```typescript
import { getTier0UnsApi } from '@/lib/tier0';

const MAX_POINTS_PER_TOPIC = 1500;
const TOPICS_PER_REQUEST = 100;
const MAX_UNS_CONCURRENCY = 2;

export async function getAnalyticsBundle(input: AnalyticsQuery) {
  const plan = resolveStatisticsPlan(input); // 服务端 allowlist
  const unsApi = await getTier0UnsApi();
  assertExpectedPointsAtMost(plan, MAX_POINTS_PER_TOPIC);
  const topicBatches = chunk(plan.scopeTopics, TOPICS_PER_REQUEST);
  const responses = await mapWithConcurrency(
    topicBatches,
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

  for (const response of responses) {
    assertBatchSuccess(response);
    assertNoTruncation(response); // 每项 meta.hasMore 都必须为 false
  }
  return buildAnalyticsDto(mergeBatchResponses(responses), plan);
}
```

`chunk` 和 `mapWithConcurrency` 是 App 服务层的有界批处理辅助函数。Planner 必须先选择满足展示要求且预计每个 topic 不超过 1,500 点的最细可用粒度；24 小时 Minute 最多约 1,440 点。若仍出现 `hasMore=true`，应拒绝该计划并选择更粗的统计 topic，不能在页面请求内继续翻页拼接。批量 Current `read` 也遵守每批 50–100 topics、总并发不超过 2 的预算。

Dashboard 对精确 Current topics 执行一次逻辑批量读取；超过 100 个 topics 时按上述预算拆批。范围目录或页面权限等 App DB 查询可以与 UNS 请求放入同一个 `Promise.all`，最终仍只暴露一个前端 bundle。

### 5.3 前端边界

```typescript
import { apiUrl } from '@/lib/utils';

const bundle = await fetch(apiUrl(`/api/analytics/bundle?${query}`)).then(r => {
  if (!r.ok) throw new Error('数据加载失败');
  return r.json() as Promise<AnalyticsBundle>;
});
```

前端只渲染业务 DTO。切换筛选要 debounce 并取消旧请求；同一个查询键要做 in-flight request coalescing 和短 TTL 缓存，不能由多张卡片各自重复请求。

## 6. 真实业务需求示例

以下五个示例来自同一个实际综合表计 App 的核心业务能力，经泛化后供 Builder 复用。每个示例都说明应该读哪些统计 topic、由哪段 Flow 形成，以及 App 如何收敛调用。

### 示例 1：范围 Dashboard 与当前周期总览

需求包括今日/本月/本年各资源用量、当前总功率、覆盖率，以及设备和告警摘要。

- **UNS**：读取所选范围的 `Metric/Current`。
- **Flow**：Meter Delta 更新开放周期；Scope Accumulator 更新范围累计和当前 gauge；Publisher 合并写 Current。
- **App**：一次 `read` 获取统计分子和覆盖率；面积、设备目录、在线状态和告警从 App DB 并行获取，组合成 `getDashboardBundle`。
- **前端**：一次请求返回所有 KPI，不允许每张卡片分别调用 history。

### 示例 2：电、水、热用量趋势

需求包括 24h、7d、30d 和自定义窗口的多资源趋势。

- **UNS**：按跨度选择同一范围的 Hourly、Daily、Monthly 或 Yearly；同一个 period payload 包含所需资源字段。
- **Flow**：累计寄存器先转 delta，直接区间值直接归桶，再按范围汇总和封桶。
- **App**：单次页面 bundle 内的受控 history 批次返回所有资源 series；不同单位分别生成曲线，不能跨单位相加。
- **前端**：从同一个 bundle 切换指标，不重新请求同一时间窗。

### 示例 3：范围分布

需求是在一个上级范围内查看各子范围的用量、占比、排名和“其他”分组。

- **UNS**：当前分布批量 read 各子范围 Current；周期分布批量 history 各子范围 Daily/Monthly。
- **Flow**：Catalog 维护父子范围和成员有效期；Scope Accumulator 为每个子范围维护相同口径的统计 topic。
- **App**：在单次页面 bundle 内按每批 50–100 topics、总并发不超过 2 读取后排序、计算占比和 Top N；topic 数等于参与展示的受控子范围数，不等于原始实体数。
- **前端**：饼图、条形图和排行榜复用同一个 distribution DTO，不分别请求。

### 示例 4：多维分析

实际维度可能包括范围、资源类型、住户类型或其他有限业务分类。

- **UNS**：Region/Building 等既有范围直接复用；高频且成员有限的其他维度建为稳定 `Dimension` 范围 topic。
- **Flow**：Catalog 保存维度成员和有效期；每条 delta 只 fan-out 到产品声明的范围和维度，不生成任意笛卡尔积。
- **App**：把所选维度成员的同粒度 topics 放进同一个受控批次计划，在内存中 pivot 成 series、matrix 或 ranking DTO。
- **边界**：如果用户需要任意字段和任意组合钻取，改用 App 分析表或数仓。

### 示例 5：同比、环比和连续周期比较

需求包括当前周期、上一周期、去年同期、变化量和变化率。

- **UNS**：按窗口选择 Daily/Monthly/Yearly，并让一次 history 的 start 覆盖所有比较周期。
- **Flow**：只维护可复用的周期事实，不为“同比”单独写一份重复数据。
- **App**：从同一批记录切分 current/previous/yearAgo，应用完整自然周期或截至同日的固定产品口径。
- **前端**：同比和环比卡片共享同一个 comparison DTO。

## 7. Builder 交付清单

生成任何包含统计需求的 App 时，必须先产出并实现下面五份契约。

### 7.1 业务指标契约

- 指标定义、单位、业务时区和业务时间字段。
- register、interval 或 gauge 类型。
- 聚合函数、可加性、主源/校准源和开放周期语义。
- 同比、环比、reset、换表、缺数和修订口径。

### 7.2 Topic manifest

- 实际需要的 scope、粒度和固定维度。
- 每个 topic 的 `enableHistory`、最小 fields、单位和描述。
- 统计范围的稳定 `scopeSlug`、正整数 `maxStatisticScopes`、范围清单和 manifest 变更流程；禁止 UUID、数据库主键和运行时无限建 topic。
- `timeStamp=periodEnd` 与 point limit。
- 显式创建顺序和版本升级策略。

### 7.3 Flow contract

- Catalog、Normalize、Delta、Accumulator、Publisher、Reconcile 六段输入输出。
- 去重键、持久 cursor、range membership、joinOffset 和 correction。
- 业务时区、水位线、迟到数据、revision、重启恢复和死信。
- 累计事件按业务时间缓冲排序；越过水位线的迟到/修订走受影响窗口重算，不能直接推进最新 cursor。
- Publisher 的写入契约：Current 单独写并显式 `retain: true`，时间桶通常 `retain: false`。
- 防止 `/_Statistics/` 反馈环路。

### 7.4 App API contract

- 页面级 bundle、服务端 topic allowlist 和粒度选择。
- 单次页面 bundle 的 read/history 批次预算：每批 50–100 topics、总并发不超过 2、`countMode: 'none'` 和 `hasMore=false` 断言。
- UNS 与 App DB 的并行组合边界。
- 缓存键、TTL、请求合并、取消和稳定 DTO。

### 7.5 验收矩阵

至少覆盖：重复消息、乱序、迟到修订、reset/rollover/换表、范围迁移、总表/分表防重复、业务时区边界、Flow 重启、坏质量、空窗口、开放周期、不同单位、点数上限和页面 OpenAPI 调用次数。

最终验收必须确认：

1. Dashboard 每次加载只有一个页面 bundle，统计主路径不遍历原始实体 history。
2. Analytics 每次筛选使用一个有界批次计划；每批不超过 100 topics、总并发不超过 2，topic 总数只与选择的受控范围数有关。
3. 同比/环比的当前、上一周期和去年同期来自同一批统计记录。
4. 范围分布和多维分析的 topic 数只与受控范围/维度成员有关，不与原始实体数线性增长。
5. 原始 history 不会成为 Dashboard、Trend、范围分布、多维分析或同比/环比的隐藏兜底。
