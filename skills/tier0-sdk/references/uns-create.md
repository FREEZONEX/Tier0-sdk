---
name: tier0-sdk-openapi-create
version: 0.5.2
description: "POST /openapi/v1/uns/create — 创建 UNS 命名空间节点"
---

# create — `POST /openapi/v1/uns/create`

## 目录

- SDK 调用与节点/字段参数
- 响应结构
- 单节点和完整树创建示例
- 常见错误

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate(body);
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `namespace` | NamespaceNode[] | **是** | 节点树数组，通过 `children` 嵌套构建层级 |

### NamespaceNode 结构

> ⚠️ `name` 是**单段名称**，不含 `/`。多层路径通过 `children` 嵌套表达，不要把完整路径放进 `name`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | **是** | 单段节点名，不含 `/`，如 `"Production"`、`"mixing_tank_01"` |
| `type` | string | **是（不可省略）** | 节点类型：`"path"`（目录）/ `"topic"`（数据点），**大小写不敏感**（`PATH`/`path` 均可）。后端兼容旧值 `path/topic/folder/file`，但新契约建议用 `PATH`/`TOPIC` |
| `topicType` | string | topic 必填 | `"metric"` / `"action"` / `"state"`（小写） |
| `displayName` | string | 否 | 显示名称 |
| `description` | string | 否 | 描述，action/state 节点强烈建议写示例 payload |
| `fields` | FieldDef[] | metric **必填** | 字段定义。metric 缺失会报 `schema required for metric`。action/state 可选但**强烈建议声明**：payload 顶层是平铺键值时（绝大多数命令/状态都是），声明 fields 后 UNS 里才能看到该 topic 的 schema；嵌套结构无法用 fields 表达的部分，用 `description` 写示例 payload 补充 |
| `enableHistory` | boolean | 否 | 是否持久化历史 |
| `children` | NamespaceNode[] | 否 | 子节点，用于一次性建多层结构 |

### FieldDef 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 字段名，不能是 `_timestamp`（系统保留） |
| `type` | string | `"int"` / `"float"` / `"string"` / `"bool"` |
| `unit` | string | 单位（可选），如 `"°C"`、`"bar"` |

> **命名约定（强制）**：节点名必须是稳定的、人类可读的业务名（`Temperature`、`Order`、`Packer01`）。**禁止**用 UUID、数据库主键、时间戳等运行时生成的值当节点名；**禁止**按数据库行/业务记录动态建 topic（每条订单/客户一个 topic 是错误建模）。命名空间是一次性设计好的固定 schema，业务实体用**每实体类型一个共享 topic**，实例 id 放进 payload 字段——粒度选择见 `references/uns-data-integration.md`。
>
> **显式建模（强制，schema-first）**：业务应用的全部 topic 必须在应用集成/初始化阶段用本接口显式创建（声明 `fields`、`enableHistory`、`description`），然后才开始写入。**禁止依赖懒创建**——不要靠 write/publish 让 topic "自己出现"。
>
> **路径约定（强制）**：数据点路径的倒数第二段必须是类型目录之一：`Metric` / `Action` / `State`（大小写不敏感）：
> - `Plant/Line1/Metric/Temperature` ✓（topicType: metric）
> - `Plant/WMS/Action/StockOut` ✓（topicType: action）
> - `Plant/MES/State/OrderStatus` ✓（topicType: state）
> - `Plant/Line1/Temperature` ✗（缺少类型目录）
>
> `topicType` 直接从路径倒数第二段推导，无需手动指定；旧参数 `topicType` 仍被接受但会打印警告。
>
> **不会自动插入类型目录**——路径中没写的段不会出现。

## 响应结构

批量接口，HTTP 200 **不代表所有节点创建成功**，需检查 `data.success` 和 `data.results[i].success`：

```typescript
{
  code: number;
  msg: string;
  data: {
    success: boolean;
    results: Array<{
      success: boolean;
      topic: string;       // 已创建节点的完整路径
      error?: { code: number; message: string };
    }>;
  };
}
```

## 使用示例

### 创建单个 Metric 数据点

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate({
  namespace: [
    {
      name: 'Plant',
      type: 'path',
      children: [
        {
          name: 'Line1',
          type: 'path',
          children: [
            {
              name: 'Metric',
              type: 'path',
              children: [
                {
                  name: 'Temperature',
                  type: 'topic',
                  topicType: 'metric',
                  displayName: '产线1温度',
                  fields: [
                    { name: 'temperature', type: 'float', unit: '°C' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

if (!result.data.success) {
  for (const item of result.data.results) {
    if (!item.success) {
      console.error(`创建失败 ${item.topic}: ${item.error?.message}`);
    }
  }
}
```

## 常见错误

| 现象 | 原因 | 处理 |
|------|------|------|
| `segment before leaf must be a type folder` | 路径叶子前一段不是 Metric/Action/State | 在叶子名前补类型目录，如 `.../Metric/ProductionCount` |
| `a topic node needs at least two segments` | 路径只有一段，缺少类型目录 | 至少写 `Metric/Count`，不能只写 `Count` |
| `metric schema 不允许删除字段: {字段名}` | Metric 节点传入的 fields 少于原有 | Metric 字段是 add-only，更新时必须包含原有字段 |
| `metric定义不能为空` | Metric 节点传入空 fields | METRIC 节点必须提供 fields |
| `字段类型不能修改: {字段名}` | 修改了同名字段的 type | 字段类型一旦创建不可修改 |

## 完整树示例

### 一次性建完整产线树（含多种 topicType）

```typescript
const result = await unsApi.openapiv1unscreate({
  namespace: [
    {
      name: 'Choco_Factory',
      type: 'path',
      children: [
        {
          name: 'Production',
          type: 'path',
          children: [
            {
              name: 'Metric',
              type: 'path',
              children: [
                {
                  name: 'OvenTemp',
                  type: 'topic',
                  topicType: 'metric',
                  fields: [{ name: 'temperature', type: 'float', unit: '°C' }],
                },
              ],
            },
            {
              name: 'Action',
              type: 'path',
              children: [
                {
                  name: 'StartBatch',
                  type: 'topic',
                  topicType: 'action',
                  // action/state 也声明 fields，UNS 里才能看到 schema
                  fields: [
                    { name: 'batch_id', type: 'string' },
                    { name: 'recipe', type: 'string' },
                    { name: 'qty', type: 'int' },
                  ],
                  description: '启动批次指令。示例: {"batch_id":"B-001","recipe":"dark_choco","qty":500}',
                },
              ],
            },
            {
              name: 'State',
              type: 'path',
              children: [
                {
                  name: 'BatchStatus',
                  type: 'topic',
                  topicType: 'state',
                  fields: [
                    { name: 'batch_id', type: 'string' },
                    { name: 'status', type: 'string' },
                    { name: 'progress', type: 'int' },
                  ],
                  description: '批次状态回报。示例: {"batch_id":"B-001","status":"running","progress":42}',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
```
