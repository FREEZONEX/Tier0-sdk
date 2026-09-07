import { describe, it, expect, afterEach } from 'vitest';
import {
  parseMqttBroker,
  toWebSocketUrl,
  DEFAULT_WSS_PORT,
  DEFAULT_WS_PATH,
} from '../../src/mq/broker.js';

describe('parseMqttBroker', () => {
  it('解析 enterprise 兜底格式 tcp://host:1883', () => {
    expect(parseMqttBroker('tcp://enterprise-dev.tier0.dev:1883')).toEqual({
      hostname: 'enterprise-dev.tier0.dev',
      port: 1883,
      scheme: 'tcp',
    });
  });

  it('解析带 scheme 的 mqtts URL（路径被剥离）', () => {
    expect(parseMqttBroker('mqtts://broker.example.com:8883/path?x=1')).toEqual({
      hostname: 'broker.example.com',
      port: 8883,
      scheme: 'mqtts',
    });
  });

  it('解析 host:port（无 scheme，Cloud 常见格式）', () => {
    expect(parseMqttBroker('host.docker.internal:11883')).toEqual({
      hostname: 'host.docker.internal',
      port: 11883,
    });
  });

  it('解析裸 host', () => {
    expect(parseMqttBroker('emqx')).toEqual({ hostname: 'emqx' });
  });

  it('空串 / 空白 / null / undefined 返回 undefined', () => {
    expect(parseMqttBroker('')).toBeUndefined();
    expect(parseMqttBroker('   ')).toBeUndefined();
    expect(parseMqttBroker(null)).toBeUndefined();
    expect(parseMqttBroker(undefined)).toBeUndefined();
  });

  it('非法输入返回 undefined 而不是抛错', () => {
    expect(parseMqttBroker('://bad')).toBeUndefined();
  });
});

describe('toWebSocketUrl', () => {
  afterEach(() => {
    // 清掉测试中伪造的 window，避免影响其他用例
    delete (globalThis as Record<string, unknown>).window;
  });

  it('tcp://host:1883 + secure:true → wss://host:8084/mqtt（不沿用 tcp 端口）', () => {
    expect(toWebSocketUrl('tcp://enterprise-dev.tier0.dev:1883', { secure: true })).toBe(
      `wss://enterprise-dev.tier0.dev:${DEFAULT_WSS_PORT}${DEFAULT_WS_PATH}`,
    );
  });

  it('host:port + secure:false → ws://host:8084/mqtt', () => {
    expect(toWebSocketUrl('broker:11883', { secure: false })).toBe(
      `ws://broker:${DEFAULT_WSS_PORT}${DEFAULT_WS_PATH}`,
    );
  });

  it('裸 host 使用自定义 wssPort', () => {
    expect(toWebSocketUrl('emqx', { secure: true, wssPort: 9001 })).toBe(
      'wss://emqx:9001/mqtt',
    );
  });

  it('输入已是 wss URL 时直通并补路径（保留其端口）', () => {
    expect(toWebSocketUrl('wss://broker:8084')).toBe('wss://broker:8084/mqtt');
    expect(toWebSocketUrl('wss://broker:8084/mqtt')).toBe('wss://broker:8084/mqtt');
    expect(toWebSocketUrl('ws://broker:8083')).toBe('ws://broker:8083/mqtt');
  });

  it('Node 环境（无 window）缺省走 ws', () => {
    expect(toWebSocketUrl('tcp://broker:1883')).toBe(
      `ws://broker:${DEFAULT_WSS_PORT}${DEFAULT_WS_PATH}`,
    );
  });

  it('浏览器 https 页面缺省走 wss', () => {
    (globalThis as Record<string, unknown>).window = {
      location: { protocol: 'https:' },
    };
    expect(toWebSocketUrl('broker:1883')).toBe(
      `wss://broker:${DEFAULT_WSS_PORT}${DEFAULT_WS_PATH}`,
    );
  });

  it('空输入返回 undefined，交由调用方回退', () => {
    expect(toWebSocketUrl(undefined)).toBeUndefined();
    expect(toWebSocketUrl('')).toBeUndefined();
    expect(toWebSocketUrl(parseMqttBroker(''))).toBeUndefined();
  });
});
