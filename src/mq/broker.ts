/**
 * MQTT broker 地址归一化工具。
 *
 * 平台 `/openapi/v1/info` 返回的 `mqttBroker` 格式随环境变化，不保证统一：
 * - enterprise：env 为空时后端兜底返回 `tcp://<host>:1883`（面向边缘/服务端客户端的连接串）；
 * - SaaS（Tier0 Cloud）：env 原样透传，常见为 `host:port` 或裸 `host`。
 *
 * 浏览器 wss 客户端不应直接把它当 hostname 拼 URL（会得到 `wss://tcp://...`
 * 这类非法地址），先经本模块解析/推导，再交给 `Tier0MQClient`。
 */

/** 解析后的 broker 端点。hostname 保证为裸主机（无 scheme、无端口、无路径）。 */
export interface MqttBrokerEndpoint {
  /** 裸主机名（已剥离 scheme/path/query，不含端口）。 */
  hostname: string;
  /**
   * 原始端口。注意：对 `tcp://host:1883` 这是 **tcp 端口**，浏览器 wss 场景
   * 不能直接沿用（wss 通常是 8084），由 `toWebSocketUrl` 的 `wssPort` 决定。
   */
  port?: number;
  /** 原始 scheme（tcp/mqtt/mqtts/ws/wss/...），裸 host 输入时为 undefined。 */
  scheme?: string;
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/**
 * 解析各种形态的 broker 字符串为结构化端点。
 *
 * 兼容输入：`tcp://host:1883`、`mqtts://host:8883`、`wss://host:8084/mqtt`、
 * `host:1883`、裸 `host`。无法解析（空串、非法 URL）返回 undefined。
 */
export function parseMqttBroker(broker?: string | null): MqttBrokerEndpoint | undefined {
  const raw = broker?.trim();
  if (!raw) return undefined;

  if (SCHEME_RE.test(raw)) {
    try {
      const u = new URL(raw);
      if (!u.hostname) return undefined;
      const scheme = SCHEME_RE.exec(raw)?.[1]?.toLowerCase();
      return {
        hostname: u.hostname,
        port: u.port ? Number.parseInt(u.port, 10) : undefined,
        scheme,
      };
    } catch {
      return undefined;
    }
  }

  // 无 scheme：`host:port` 或裸 `host`；含路径/空白的是垃圾输入，拒绝
  if (/[\s/]/.test(raw)) return undefined;
  const i = raw.lastIndexOf(':');
  if (i > 0 && /^\d+$/.test(raw.slice(i + 1))) {
    const hostname = raw.slice(0, i);
    if (!hostname) return undefined;
    return { hostname, port: Number.parseInt(raw.slice(i + 1), 10) };
  }
  return { hostname: raw };
}

/** 浏览器 wss 默认端口（与平台 OS_MQTT_WEBSOCKET_TSL_PORT 默认值一致）。 */
export const DEFAULT_WSS_PORT = 8084;
/** MQTT over WebSocket 路径。 */
export const DEFAULT_WS_PATH = '/mqtt';

export interface ToWebSocketUrlOptions {
  /** wss 端口，默认 {@link DEFAULT_WSS_PORT}（8084）。 */
  wssPort?: number;
  /**
   * 显式指定 ws(false)/wss(true)。缺省自适应：浏览器 https 页面用 wss，
   * 其余（Node、http 页面）用 ws。
   */
  secure?: boolean;
}

/**
 * 当前运行环境是否处于 https 安全上下文。
 *
 * 用 `globalThis.location` 而不是 `window.location`：Web Worker
 * （dedicated/shared）里 `window` 不存在，但 `location.protocol` 同样是 `https:`，
 * 应同等视为安全上下文（否则会被降级为 ws 而被浏览器按 mixed content 拦截）。
 */
export function isBrowserHttps(): boolean {
  const loc = (globalThis as { location?: { protocol?: string } }).location;
  return typeof loc?.protocol === 'string' && loc.protocol === 'https:';
}

/**
 * 把 `mqttBroker`（或 {@link MqttBrokerEndpoint}）推导为可直接传给
 * `Tier0MQClient` 的 WebSocket URL。
 *
 * 规则：
 * - 输入已是 `ws(s)://` URL：原样归一（补 `/mqtt` 路径，端口、path、query 均保留）；
 * - 输入 `tcp://host:1883` / `host:port` / 裸 `host`：按 `secure` 推导 scheme，
 *   端口一律用 `wssPort`（8084），**不沿用** tcp 端口；
 * - 输入为空/无法解析：返回 undefined（调用方应回退或报错，勿硬拼 URL）。
 *
 * @example
 * toWebSocketUrl('tcp://example.tier0.dev:1883', { secure: true });
 * // → 'wss://example.tier0.dev:8084/mqtt'
 */
export function toWebSocketUrl(
  broker: string | MqttBrokerEndpoint | undefined | null,
  opts: ToWebSocketUrlOptions = {},
): string | undefined {
  if (broker == null || broker === '') return undefined;

  // 已是 ws(s) URL：解析后归一直通（保留其 scheme/端口/path/query，仅补 /mqtt 路径）
  if (typeof broker === 'string' && /^wss?:\/\//i.test(broker.trim())) {
    try {
      const u = new URL(broker.trim());
      if (!u.hostname) return undefined;
      if (!u.pathname || u.pathname === '/') {
        u.pathname = DEFAULT_WS_PATH;
      }
      return u.toString();
    } catch {
      return undefined;
    }
  }

  const endpoint = typeof broker === 'string' ? parseMqttBroker(broker) : broker;
  if (!endpoint?.hostname) return undefined;

  // ws(s) 端点：保留其 scheme 与端口（"已是 WebSocket 地址"的直通语义）
  if (endpoint.scheme === 'ws' || endpoint.scheme === 'wss') {
    const port = endpoint.port ? `:${endpoint.port}` : '';
    return `${endpoint.scheme}://${endpoint.hostname}${port}${DEFAULT_WS_PATH}`;
  }

  const secure = opts.secure ?? isBrowserHttps();
  const port = opts.wssPort ?? DEFAULT_WSS_PORT;
  return `${secure ? 'wss' : 'ws'}://${endpoint.hostname}:${port}${DEFAULT_WS_PATH}`;
}
