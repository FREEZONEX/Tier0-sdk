import type { components } from '../../src/openapi/types.js';

type Channels = components['schemas']['SendNotificationReq']['channels'];
const defaultChannels: Channels = undefined;
const silent: Channels = [];
const all: Channels = ['web', 'mobile'];
const web: Channels = ['web'];
const mobile: Channels = ['mobile'];
// @ts-expect-error Desktop is covered by web, not a separate channel.
const desktop: Channels = ['desktop'];
// @ts-expect-error Unknown channels are not supported.
const unknown: Channels = ['email'];
void [defaultChannels, silent, all, web, mobile, desktop, unknown];
