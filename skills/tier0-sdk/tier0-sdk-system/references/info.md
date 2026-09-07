---
name: tier0-sdk-openapi-info
version: 0.3.1
description: "POST /openapi/v1/info — 获取 Tier0 服务信息（连通性验证；mqttBroker 为服务端连接串，浏览器 wss 勿直接当 hostname 用）"
---

# info — `POST /openapi/v1/info`

获取 Tier0 网关服务的基本信息。常用于验证 API 连通性和认证配置是否正确。

## SDK 调用

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.openapiv1info({});
```

## 请求参数

无参数，传空对象 `{}` 即可。

## 响应结构

```typescript
{
  code: number;
  msg: string;
  data: {
    name: string;           // 服务名称，如 "Tier0 UNS OpenAPI"
    version: string;        // API 版本，如 "v1"
    capabilities: string[]; // 支持的操作列表，如 ["read","write","browse","search","create","update","delete"]
    mqttBroker: string;     // 服务端/边缘用 MQTT 连接串（见下节契约，格式随环境变化，勿当裸主机名用）
  };
}
```

## `mqttBroker` 字段契约（重要）

`mqttBroker` 是**给服务端 / 边缘客户端用的 MQTT 连接串**，不是浏览器 wss 直连地址：

- **enterprise 环境**：后端取 `EMQX_EXTERNAL_BROKER_HOST`（env 透传）；为空时兜底拼
  `tcp://<ENTRANCE_DOMAIN>:<OS_MQTT_TCP_PORT>`（如 `tcp://example.tier0.dev:1883`）。
- **SaaS（Tier0 Cloud）环境**：原样透传部署配置的 broker 地址，可能是裸主机、`host:port`，也可能带 scheme。
- 因此**格式不保证统一**，消费方必须解析后再取主机部分，而不是按"裸主机名"切分。
  推荐直接用 `@tier0/sdk/mq` 的 `parseMqttBroker`（兼容带/不带 scheme、含/不含端口）：
  ```typescript
  import { parseMqttBroker } from '@tier0/sdk/mq';

  const endpoint = parseMqttBroker(result.data.mqttBroker);
  const host = endpoint?.hostname;   // 'tcp://host:1883' / 'host:1883' / 'host' 都能取到裸主机
  ```
- **浏览器 / MQTT.js wss 客户端**：不要直接 `` `wss://${mqttBroker}` ``（会得到
  `wss://tcp://host:1883` 这类非法 URL）。正确做法：URL 解析取 `hostname`，再拼浏览器可达的
  wss 端点（如 `wss://<hostname>:8084/mqtt`）；wss 端口与 tcp 端口（1883）不同，需来自部署配置
  或约定，不能从 `mqttBroker` 里照搬。
- **推荐**：直接使用 `@tier0/sdk/mq` 提供的 `parseMqttBroker` / `toWebSocketUrl`
  处理以上归一化逻辑（见 tier0-sdk-mq skill）。

## 使用示例

### 验证连通性与认证

```typescript
import { systemApi } from '@tier0/sdk/openapi';

try {
  const result = await systemApi.openapiv1info({});
  console.log('连接成功');
  console.log('  服务:', result.data.name);      // "Tier0 UNS OpenAPI"
  console.log('  版本:', result.data.version);    // "v1"
  console.log('  能力:', result.data.capabilities.join(', '));
  console.log('  MQTT Broker:', result.data.mqttBroker);
} catch (error) {
  if (error instanceof Error) {
    // "HTTP 401" → API Key 无效
    // "HTTP 502" / 网络错误 → Host 配置错误
    console.error('连接失败:', error.message);
  }
}
```
