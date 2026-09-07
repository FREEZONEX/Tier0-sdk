import type { components } from './types.js';

type SendNotificationReq = components['schemas']['SendNotificationReq'];

/** Expand SDK defaults without modifying caller-owned requests or arrays. */
export function normalizeNotificationRequest(body: SendNotificationReq): SendNotificationReq {
  const channels: NonNullable<SendNotificationReq['channels']> =
    body.channels === undefined ? ['web', 'mobile'] : body.channels;
  if (!Array.isArray(channels) || [...channels].some(channel => channel !== 'web' && channel !== 'mobile')) {
    throw new TypeError('Notification channels must contain only web or mobile');
  }
  return { ...body, channels: [...new Set(channels)] };
}
