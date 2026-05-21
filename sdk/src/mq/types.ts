export interface MQTTConfig {
  url: string;
  clientId?: string;
  username?: string;
  password?: string;
  reconnectPeriod?: number;
  connectTimeout?: number;
  clean?: boolean;
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
};
