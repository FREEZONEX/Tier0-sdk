export interface MQTTConfig {
  host?: string;
  port?: number;
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
