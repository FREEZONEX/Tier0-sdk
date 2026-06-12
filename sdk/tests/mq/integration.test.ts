import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Tier0MQClient } from '../../src/mq/client.js';

const mqttHost = process.env.TIER0_MQTT_HOST;
const mqttPort = process.env.TIER0_MQTT_PORT
  ? parseInt(process.env.TIER0_MQTT_PORT)
  : 8084;
const apiKey = process.env.TIER0_API_KEY;

const shouldRun = mqttHost && apiKey;

const run = shouldRun ? describe : describe.skip;

run('MQ Integration Tests', () => {
  let client: Tier0MQClient;

  beforeAll(() => {
    // clientId 不可随意自定义：broker 要求 `{workspaceID}&xxx` 格式，
    // 留空让 SDK 从 apiKey 解析 workspaceID 自动生成
    client = new Tier0MQClient({
      host: mqttHost,
      port: mqttPort,
      password: apiKey,
    });
  });

  afterAll(() => {
    client.disconnect();
  });

  it('should connect to MQTT broker', async () => {
    await client.connect();
    expect(client.isConnected).toBe(true);
  });

  it('should subscribe and receive message', async () => {
    const testTopic = `sdk/test/${Date.now()}`;
    const received = new Promise<{ topic: string; payload: string }>((resolve) => {
      client.subscribe(testTopic, (topic, payload) => {
        resolve({ topic, payload });
      });
    });

    // 给订阅一点时间注册
    await new Promise((r) => setTimeout(r, 500));

    await client.publish(testTopic, JSON.stringify({ hello: 'world' }));

    const msg = await Promise.race([
      received,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for message')), 10000)
      ),
    ]);

    expect(msg.topic).toBe(testTopic);
    expect(JSON.parse(msg.payload)).toEqual({ hello: 'world' });
  });

  it('should publish with qos and retain', async () => {
    const testTopic = `sdk/test/qos/${Date.now()}`;

    // 发布 retain 消息
    await client.publish(testTopic, 'retained-test', { qos: 1, retain: true });

    // 短暂等待 broker 处理
    await new Promise((r) => setTimeout(r, 200));

    // 只要能发布成功即可（MQTT 不保证 QoS 1 的确认同步返回）
    expect(client.isConnected).toBe(true);
  });

  it('should disconnect cleanly', async () => {
    client.disconnect();
    expect(client.isConnected).toBe(false);
    expect(client.subscribedTopics).toHaveLength(0);
  });
});
