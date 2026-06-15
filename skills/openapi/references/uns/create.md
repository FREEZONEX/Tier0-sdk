---
name: tier0-sdk-openapi-create
version: 0.2.0
description: "POST /openapi/v1/uns/create — 创建 UNS 命名空间节点"
---

# create — `POST /openapi/v1/uns/create`

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate(body);
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `namespace` | NamespaceNode[] | **是** | 节点树数组，支持嵌套 `children` 批量建树 |

### NamespaceNode 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `topic` | string | **是** | 节点路径（完整路径或相对路径，配合 `parent` 使用） |
| `type` | string | **是** | 节点类型：`topic`（数据点叶子节点）/ `path`（目录） |
| `topicType` | string | 叶子必填 | 数据类型：`METRIC`（时序）/ `ACTION`（下行命令）/ `STATE`（上行状态） |
| `displayName` | string | 否 | 显示名称 |
| `description` | string | 否 | 描述，action/state 节点建议写示例 payload |
| `fields` | FieldDef[] | METRIC 推荐 | 字段定义（仅 METRIC 类型有意义，action/state 可省略） |
| `parent` | string | 否 | 父路径（用于在已有路径下追加节点） |
| `children` | NamespaceNode[] | 否 | 子节点，用于一次性建多层结构 |

### FieldDef 结构（METRIC fields）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 字段名，不能是 `_timestamp`（系统保留） |
| `type` | string | `int` / `float` / `string` / `bool` |
| `unit` | string | 单位（可选），如 `"°C"`、`"bar"` |

> **路径约定（强制）**：叶子节点路径的倒数第二段必须与 topicType 对应：
> - `Plant/Line1/Metric/Temperature` ✓（topicType: METRIC）
> - `Plant/WMS/Action/StockOut` ✓（topicType: ACTION）
> - `Plant/MES/State/OrderStatus` ✓（topicType: STATE）
> - `Plant/Line1/Temperature`（缺少类型目录）✗

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

### 创建单个 METRIC 数据点

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unscreate({
  namespace: [
    {
      topic: 'Plant/Line1/Metric/Temperature',
      type: 'topic',
      topicType: 'METRIC',
      displayName: '产线1温度',
      fields: [
        { name: 'temperature', type: 'float', unit: '°C' },
        { name: 'unit', type: 'string' },
      ],
    },
  ],
});
```

### 一次性建整棵产线树

```typescript
const result = await unsApi.openapiv1unscreate({
  namespace: [
    {
      topic: 'Plant/Line1',
      type: 'path',
      displayName: '产线1',
      children: [
        {
          topic: 'Metric/Temperature',
          type: 'topic',
          topicType: 'METRIC',
          fields: [{ name: 'temperature', type: 'float', unit: '°C' }],
        },
        {
          topic: 'Metric/Pressure',
          type: 'topic',
          topicType: 'METRIC',
          fields: [{ name: 'pressure', type: 'float', unit: 'bar' }],
        },
        {
          topic: 'Action/EmergencyStop',
          type: 'topic',
          topicType: 'ACTION',
          description: '急停指令。payload: { "command": "stop", "reason": "string" }',
        },
      ],
    },
  ],
});

if (!result.data.success) {
  result.data.results
    .filter(r => !r.success)
    .forEach(r => console.error(`创建失败 ${r.topic}: ${r.error?.message}`));
}
```

### 在已有路径下追加节点

```typescript
await unsApi.openapiv1unscreate({
  namespace: [
    {
      parent: 'Plant/Line1',
      topic: 'Metric/Humidity',
      type: 'topic',
      topicType: 'METRIC',
      fields: [{ name: 'humidity', type: 'float', unit: '%' }],
    },
  ],
});
```
