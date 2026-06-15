---
name: tier0-sdk-openapi-search
version: 0.2.0
description: "POST /openapi/v1/uns/search — 按关键词搜索 UNS 节点"
---

# search — `POST /openapi/v1/uns/search`

按关键词检索节点名称。**已知名称片段时用 search；探索树形结构用 browse**。

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unssearch(body);
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `keyword` | string | 否 | 关键词（模糊匹配节点名称/路径），留空则返回所有节点 |
| `path_prefix` | string | 否 | 限制搜索范围到指定路径前缀，如 `"Plant/Line1"` |
| `topicType` | string | 否 | 按数据类型过滤：`METRIC` / `ACTION` / `STATE`（仅叶子节点） |
| `include_metadata` | boolean | 否 | 返回 fields、description 等元数据 |
| `include_leaf_value` | boolean | 否 | 返回叶子节点的当前 VQT 值 |
| `page` | integer | 否 | 页码，默认 1 |
| `size` | integer | 否 | 每页条数，默认 20 |

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    total: number;
    page: number;
    size: number;
    list: Array<{
      topic: string;
      type: 'path' | 'file';
      topicType?: 'METRIC' | 'ACTION' | 'STATE';
      displayName?: string;
      description?: string;
      fields?: Array<{ name: string; type: string; unit?: string }>;
      value?: Record<string, unknown>;
      quality?: string;
      timeStamp?: number;
    }>;
  };
}
```

## 使用示例

### 按名称搜索

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unssearch({
  keyword: 'Temperature',
});

for (const node of result.data.list) {
  console.log(node.topic, node.topicType);
  // Plant/Line1/Metric/Temperature  METRIC
  // Plant/Line2/Metric/Temperature  METRIC
}
```

### 在指定路径下搜索 METRIC 节点

```typescript
const result = await unsApi.openapiv1unssearch({
  keyword: 'temp',
  path_prefix: 'Plant/Line1',
  topicType: 'METRIC',
  include_metadata: true,
});

for (const node of result.data.list) {
  console.log(node.topic, node.fields);
}
```

### 分页搜索所有节点

```typescript
let page = 1;
const size = 50;
let total = Infinity;
const allNodes = [];

while (allNodes.length < total) {
  const result = await unsApi.openapiv1unssearch({ page, size });
  total = result.data.total;
  allNodes.push(...result.data.list);
  if (result.data.list.length < size) break;
  page++;
}
```
