---
name: tier0-sdk
version: 0.1.0
description: "Tier0 SDK — TypeScript/JavaScript 统一 SDK。涵盖 OpenAPI REST API 封装（支持 React/Vue3）和 MQ（MQTT over WebSocket）消息队列封装。triggers: Tier0, SDK, OpenAPI, REST, API, MQ, MQTT, WebSocket, React, Vue3, TypeScript"
metadata:
  requires:
    npm: ["@tier0/sdk"]
  hermes:
    tags: [sdk, openapi, rest, api, mq, mqtt, websocket, react, vue3]
---

# tier0-sdk — Tier0 平台 TypeScript SDK

## 概述

`@tier0/sdk` 是 Tier0 Cloud 平台的官方 TypeScript/JavaScript SDK，包含两个子模块：

| 模块 | 能力 | 适用场景 |
|------|------|----------|
| **openapi** | REST API 封装，含类型定义、React Hooks、Vue3 Composables | 前端/Node.js 调用 Tier0 后端 API |
| **mq** | MQTT over WebSocket 封装，支持自动重连、断连重订阅 | 实时数据订阅、设备指令下发 |

## 安装

```bash
npm install @tier0/sdk
```

npm 包页面：https://www.npmjs.com/package/@tier0/sdk

## 环境变量

SDK 优先从环境变量读取配置，无需在代码中硬编码 URL 或密钥。

| 环境变量 | 说明 | 适用模块 |
|----------|------|----------|
| `TIER0_BASE_URL` / `VITE_TIER0_BASE_URL` | OpenAPI 基础地址，如 `https://api.tier0.cloud` | openapi |
| `TIER0_API_KEY` / `VITE_TIER0_API_KEY` | API 认证密钥（JWT Bearer Token） | openapi + mq |
| `TIER0_MQTT_URL` / `VITE_TIER0_MQTT_URL` | MQTT WebSocket 地址，如 `wss://mqtt.tier0.cloud` | mq |

> **Vite 项目**：Vite 只暴露以 `VITE_` 开头的环境变量到客户端，因此前端项目请使用 `VITE_TIER0_*` 前缀。
> **Node.js 项目**：直接使用 `TIER0_*` 前缀。

### .env 文件示例

```bash
# .env（Node.js）
TIER0_BASE_URL=https://api.tier0.cloud
TIER0_API_KEY=your-api-key-here
TIER0_MQTT_URL=wss://mqtt.tier0.cloud

# .env（Vite 前端）
VITE_TIER0_BASE_URL=https://api.tier0.cloud
VITE_TIER0_API_KEY=your-api-key-here
VITE_TIER0_MQTT_URL=wss://mqtt.tier0.cloud
```

## 子技能路由

| 意图 | 加载文件 | 说明 |
|------|---------|------|
| 使用 OpenAPI REST API | `openapi/SKILL.md` | 基础客户端、类型安全调用、React/Vue3 集成 |
| 使用 MQ 消息队列 | `mq/SKILL.md` | 订阅/发布、自动重连、通配符、事件监听 |
| 升级 SDK 版本 | 本文档「版本与升级」章节 | npm update、版本差异对照 |

## 版本与升级

### 当前版本

```bash
npm list @tier0/sdk
```

### 升级命令

```bash
# 查看最新版本
npm view @tier0/sdk versions --json

# 升级到最新版
npm install @tier0/sdk@latest

# 升级到指定版本
npm install @tier0/sdk@0.2.0
```

### 版本差异

| 版本 | 变更内容 |
|------|----------|
| `0.1.0` | 初始版本。OpenAPI 18 个端点、MQ 订阅发布、React/Vue3 Hooks、环境变量自动读取 |

### 升级后检查

升级后建议执行以下检查：

```bash
# 1. 确认版本
npm list @tier0/sdk

# 2. 检查 TypeScript 类型（如有类型报错，参考下方「Breaking Changes」）
npx tsc --noEmit

# 3. 运行测试
npm test
```

### Breaking Changes 策略

- **minor 版本（0.x.0）**：可能包含 API 调整，升级前请查看 CHANGELOG
- **patch 版本（0.0.x）**：仅修复 bug，可安全升级
- 所有破坏性变更会在 CHANGELOG 中标注迁移路径

## 快速示例

### OpenAPI — 读取 UNS 数据

```typescript
import { unsApi } from '@tier0/sdk/openapi';

// 环境变量已配置 TIER0_BASE_URL 和 TIER0_API_KEY
const result = await unsApi.openapiv1unsread({
  topics: ['Plant/Line1/Metric/Temperature'],
});
console.log(result);
```

### MQ — 订阅实时数据

```typescript
import { Tier0MQClient } from '@tier0/sdk/mq';

const client = new Tier0MQClient();

// 环境变量已配置 TIER0_MQTT_URL 和 TIER0_API_KEY
client.subscribe('Plant/Line1/Metric/Temperature', (topic, payload) => {
  console.log(topic, JSON.parse(payload));
});
```
