---
name: tier0-sdk-openapi-browse
version: 0.2.0
description: "POST /openapi/v1/uns/browse — 浏览 UNS 命名空间树形结构"
---

# browse — `POST /openapi/v1/uns/browse`

**探索未知路径结构时的首选操作**。不知道完整 topic 路径时，先 browse 再 read/write。

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsbrowse(body);
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 起始路径。留空或不传则从根节点浏览 |
| `include_metadata` | boolean | 否 | 返回节点的 topicType、fields、description 等元数据。**首次了解 topic 结构时建议开启** |
| `include_leaf_value` | boolean | 否 | 同时返回叶子节点（数据点）的当前 VQT 值 |
| `max_depth` | integer | 否 | 最大递归深度，默认 1（只展开下一层） |

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    success: boolean;
    results: Array<{
      success: boolean;
      topic: string;  // 节点完整路径
      result?: {
        type: 'path' | 'file';   // path = 目录，file = 数据点
        topicType?: 'METRIC' | 'ACTION' | 'STATE';  // 仅 file 节点有
        displayName?: string;
        description?: string;
        fields?: Array<{ name: string; type: string; unit?: string }>;  // include_metadata: true 时
        value?: Record<string, unknown>;    // include_leaf_value: true 时
        quality?: string;                   // include_leaf_value: true 时
        timeStamp?: number;                 // include_leaf_value: true 时
        children?: Array<...>;             // 子节点（max_depth > 1 时）
      };
      error?: { code: number; message: string };
    }>;
  };
}
```

## 使用示例

### 查看根节点下有哪些路径

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsbrowse({});
// 或 { path: '' }

for (const item of result.data.results) {
  if (item.success) {
    console.log(item.topic, item.result?.type);
    // Plant  path
    // Warehouse  path
  }
}
```

### 查看某路径下的子节点，含字段定义

```typescript
const result = await unsApi.openapiv1unsbrowse({
  path: 'Plant/Line1',
  include_metadata: true,
  max_depth: 2,
});

for (const item of result.data.results) {
  if (!item.success) continue;
  const node = item.result!;
  if (node.type === 'file') {
    console.log(item.topic, node.topicType, node.fields);
    // Plant/Line1/Metric/Temperature  METRIC  [{ name: 'temperature', type: 'float', unit: '°C' }]
  }
}
```

### 查看某节点当前值（browse + leaf value）

```typescript
const result = await unsApi.openapiv1unsbrowse({
  path: 'Plant/Line1/Metric',
  include_leaf_value: true,
});

for (const item of result.data.results) {
  if (item.success && item.result?.value) {
    console.log(item.topic, item.result.value, item.result.quality);
  }
}
```
