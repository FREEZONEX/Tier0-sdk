---
name: tier0-sdk-openapi-update
version: 0.4.0
description: "POST /openapi/v1/uns/update — 更新 UNS 节点元数据（字段定义/描述/名称）"
---

# update — `POST /openapi/v1/uns/update`

更新节点的元数据（字段定义、描述、显示名称等）。**不用于写入 VQT 数据**（那是 write 的职责）。

## 目录

- SDK 调用和请求参数
- 字段更新规则与响应结构
- 描述、字段和多属性更新示例

## SDK 调用

```typescript
import { unsApi } from '@tier0/sdk/openapi';

const result = await unsApi.openapiv1unsupdate(body);
```

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | **是** | 目标节点完整路径 |
| `fields` | FieldDef[] | 否 | 新的字段定义（仅 METRIC 节点有效）。**全量替换策略**，详见下方「fields 更新规则」 |
| `description` | string | 否 | 新描述 |
| `displayName` | string | 否 | 新显示名称 |
| `alias` | string | 否 | 别名 |
| `updateMask` | string[] | 否 | 指定要更新的字段名列表。建议显式传入，如 `["description"]`、`["displayName","description"]` 或 `["fields"]`，避免后端误更新未打算修改的字段 |
| `extendProperties` | object | 否 | 自定义扩展属性（key-value 对） |

### fields 更新规则（重要）

`fields` 是**全量替换**（Replace）策略，传入的列表会完整覆盖原有 schema。但不同节点类型有严格限制：

| 操作 | Metric 节点 | State / Action 节点 |
|------|------------|-------------------|
| 新增 field | ✅ 允许 | ✅ 允许 |
| 删除 field（传入列表少于原有） | ❌ **报错** | ✅ 允许 |
| 修改 field 类型（type） | ❌ **报错** | ❌ **报错** |
| 修改 field 单位（unit） | ✅ 允许 | ✅ 允许 |
| 重命名 field（改 name） | ❌ 等价于删旧增新，**报错** | ⚠️ 等价于删旧增新 |

**Metric 节点是 add-only**：只能在原有 fields 基础上追加新字段，必须把原有 fields 完整传入，不能减少，不能改类型，不能改名。

> **操作示例（Metric 新增字段）：**
> 原有 fields：`[{name:"temperature", type:"float"}]`
> 正确做法：传入 `[{name:"temperature", type:"float"}, {name:"humidity", type:"float"}]`（包含原有字段 + 新增字段）
> 错误做法：只传 `[{name:"humidity", type:"float"}]`（缺少原有字段 temperature，会报错 `metric schema 不允许删除字段: temperature`）

### FieldDef 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 字段名，不能是 `_timestamp`（系统保留） |
| `type` | string | `int` / `float` / `string` / `bool` |
| `unit` | string | 单位（可选） |

## 响应结构

```typescript
{
  code: number;   // 200 = 成功
  msg: string;    // "success"
  data: {};       // 空对象，成功与否依靠外层 code/msg 判断
}
```

## 使用示例

### 只更新描述（用 updateMask 精确控制）

```typescript
import { unsApi } from '@tier0/sdk/openapi';

await unsApi.openapiv1unsupdate({
  path: 'Plant/Line1/Metric/Temperature',
  description: '产线1温度传感器，量程 -20~80°C',
  updateMask: ['description'],  // 只更新 description，不动 fields
});
```

### 更新字段定义（新增 unit 字段）

```typescript
await unsApi.openapiv1unsupdate({
  path: 'Plant/Line1/Metric/Temperature',
  fields: [
    { name: 'temperature', type: 'float', unit: '°C' },
    { name: 'unit', type: 'string' },
    { name: 'status', type: 'string' },  // 新增字段
  ],
  updateMask: ['fields'],
});
```

### 同时更新多个属性

```typescript
await unsApi.openapiv1unsupdate({
  path: 'Plant/Line1/Metric/Temperature',
  displayName: '产线1温度（修正）',
  description: '已校准的温度传感器数据',
  updateMask: ['displayName', 'description'],
});
```
