import { createClient, controls, type ControlHandle, type ControlInvokeResponse, type PublicControl } from '../../src/index.js';

const client = createClient({ getApiKey: () => 'runtime-key', transportTimeoutMs: 60000 });
const handle = client.controls.use<{ timeoutMs: number; streamId: string }, { started: boolean }>({ code: 'pump.start' });
const typedHandle: ControlHandle<{ timeoutMs: number; streamId: string }, { started: boolean }> = handle;
const description: Promise<PublicControl> = handle.describe();
const invocation: Promise<ControlInvokeResponse<{ started: boolean }>> = handle.invoke(
  { timeoutMs: 1, streamId: 'business' }, { idempotencyKey: 'intent' },
);
// @ts-expect-error server timeout cannot be overridden by invoke options
handle.invoke({ timeoutMs: 1, streamId: 'business' }, { timeoutMs: 500 });
// @ts-expect-error HTTP deadline is client-level only
handle.invoke({ timeoutMs: 1, streamId: 'business' }, { transportTimeoutMs: 500 });
// @ts-expect-error server execution timeout is not a client configuration option
createClient({ timeoutMs: 500 });
// @ts-expect-error deployment version belongs to business input, never top-level options
handle.invoke({ timeoutMs: 1, streamId: 'business' }, { deploymentVersion: 'v2' });
// @ts-expect-error selection is by public code only
client.controls.use({ code: 'pump.start', streamId: 'internal' });
// @ts-expect-error no target on discovery
client.controls.discover({ target: 'internal' });
// @ts-expect-error default input must be JSON
controls.use({ code: 'pump.start' }).invoke({ invalid: () => true });
// @ts-expect-error replay flag is boolean, never a numeric enum
const replayed: ControlInvokeResponse['replayed'] = 1;
void [typedHandle, description, invocation, replayed];
