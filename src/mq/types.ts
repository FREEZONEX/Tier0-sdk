export interface MQTTConfig {
  /**
   * broker 地址。支持三种形态：
   * - 完整 WebSocket URL，如 `wss://host:8084/mqtt`（推荐浏览器场景显式使用）；
   * - 裸 `host`（可含端口，如 `host:8084`）；
   * - 平台 `/openapi/v1/info` 返回的原始 `mqttBroker`（如 `tcp://host:1883`，
   *   建议先用 {@link toWebSocketUrl} 归一后再传入，见 `@tier0/sdk/mq` 的 broker 工具）。
   */
  host?: string;
  port?: number;
  /**
   * 当 host 不带 ws(s) scheme 时，显式指定用 wss(true) 还是 ws(false)。
   * 缺省自适应：浏览器 https 页面用 wss，其余（Node、http 页面）用 ws。
   */
  secure?: boolean;
  clientId?: string;
  username?: string;
  password?: string;
  keepAlive?: number;
  reconnectPeriod?: number;
  connectTimeout?: number;
  clean?: boolean;
  /**
   * 背压保护阈值：handler 连续返回 false（表示下游停滞/消费者已断开）达到
   * 该次数后，SDK 自动移除该订阅并向 broker 退订，避免消息在无消费者的
   * 应用内队列中持续堆积。0 或不设置表示关闭该保护（保持原有行为）。
   */
  maxBackpressuredDeliveries?: number;
}

export type MQTTMessage = {
  topic: string;
  payload: string | Buffer;
  qos: number;
  retain: boolean;
};

export type MQTTEventMap = {
  connect: () => void;
  disconnect: () => void;
  error: (error: Error) => void;
  message: (message: MQTTMessage) => void;
  /** 订阅因持续背压被 SDK 自动移除时触发。 */
  subscriptionDropped: (info: { topic: string; reason: string }) => void;
};
