import { client, createClient, type StreamMessage } from '../src/index.js';
import { installAppRuntime } from '../src/runtime.js';

const request = client.streams.requests.use<{ value: number }, { accepted: boolean }>({ code: 'pump.start' });
void request.invoke({ value: 1 }, { idempotencyKey: 'one-intent' }).then(result => {
  const status: 'completed' = result.status;
  void status;
  const accepted: boolean = result.result.accepted;
  return accepted;
});
const topic = createClient().streams.messages.use<{ text: string }>({ topic: 'chat/room' });
void topic.publish({ text: 'hello' });
void topic.subscribe((message: StreamMessage<{ text: string }>) => { message.payload.text.toUpperCase(); })
  .then(subscription => subscription.dispose());
installAppRuntime({ appId: 'trusted-app', request: (_path, _body, { signal }) => fetch('/trusted/bridge', { signal }) });

// @ts-expect-error Retired control runtime surface must not exist.
client.controls;
// @ts-expect-error Physical subjects are not public selector configuration.
client.streams.messages.use({ topic: 'chat', publishSubject: 'raw.subject' });
// @ts-expect-error Broker credentials are host-owned.
createClient({ userJwt: 'secret' });
// @ts-expect-error Caller cannot choose a deployment version.
request.invoke({ value: 1 }, { deploymentVersion: '2' });
// @ts-expect-error No write retry option.
request.invoke({ value: 1 }, { retry: true });
// @ts-expect-error Generic payload shape is preserved.
topic.publish({ other: true });

// @ts-expect-error Retired v2 request aliases are absent; use streams.requests.
client.unsV2.controlInvoke({ code: 'pump.start', input: {} });
// @ts-expect-error Retired root control types must not be exported.
type RetiredControl = import('../src/index.js').ControlHandle;
