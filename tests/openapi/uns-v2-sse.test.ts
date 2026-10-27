import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, UnsV2Error, UnsV2OutcomeUnknownError } from '../../src/index.js';

const heartbeat = (id: string) => `event: heartbeat\nid: ${id}\ndata: {"at":1}\n\n`;
const bufferedFrames = {
  heartbeat: heartbeat('cursor.buffered'),
  change: 'event: change\nid: cursor.buffered\ndata: {"eventId":"cursor.buffered","collectionId":"orders","recordId":"order-1","change":"record","revision":1,"occurredAt":1,"restricted":false}\n\n',
  reset: 'event: reset\ndata: {"reason":"SCOPE_CHANGED"}\n\n',
};

function fixture(frame: string) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // All frames are already buffered when the consumer receives the first.
      controller.enqueue(new TextEncoder().encode(heartbeat('cursor.first') + frame + heartbeat('cursor.after')));
    },
    cancel,
  });
  const fetch = vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  const api = createClient({ apiHost: 'http://sse.invalid', transportTimeoutMs: 1000 }).unsV2;
  return { api, body, cancel, fetch };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Native Record SSE buffered frames', () => {
  for (const [event, frame] of Object.entries(bufferedFrames)) {
    it.each(['abort', 'timer', 'deadline'] as const)(`stops buffered ${event} delivery after %s without reconnecting`, async stop => {
      vi.useFakeTimers();
      const { api, body, cancel, fetch } = fixture(frame);
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
      const iterator = api.recordSubscribe({ cursor: 'cursor.original' }, { signal: controller.signal });
      try {
        await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { event: 'heartbeat', id: 'cursor.first' } });
        if (stop === 'abort') controller.abort();
        else if (stop === 'timer') await vi.advanceTimersByTimeAsync(1000);
        else vi.setSystemTime(Date.now() + 1001); // Deadline passed before the timer callback can run.
        const error = await iterator.next().catch(error => error);
        expect(error).toBeInstanceOf(UnsV2Error);
        expect(error).not.toBeInstanceOf(UnsV2OutcomeUnknownError);
        expect(error).toMatchObject({
          code: stop === 'abort' ? 'UNS_V2_TRANSPORT_ERROR' : 'UNS_V2_TRANSPORT_TIMEOUT',
          operation: 'recordSubscribe', status: 200, retryable: false,
        });
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(body.locked).toBe(false);
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(2000);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][1].headers['Last-Event-ID']).toBe('cursor.original');
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
      } finally {
        await iterator.return(undefined);
      }
    });

    it(`delivers buffered ${event} while active and cleans up on return/reset`, async () => {
      vi.useFakeTimers();
      const { api, body, cancel, fetch } = fixture(frame);
      const iterator = api.recordSubscribe();
      try {
        await expect(iterator.next()).resolves.toMatchObject({ value: { event: 'heartbeat', id: 'cursor.first' } });
        await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { event } });
        if (event === 'reset') await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
        else await expect(iterator.next()).resolves.toMatchObject({ value: { event: 'heartbeat', id: 'cursor.after' } });
      } finally {
        await iterator.return(undefined);
      }
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }

  it('resumes only when the caller opens a new subscription with an explicit cursor', async () => {
    vi.useFakeTimers();
    const { api, fetch } = fixture(bufferedFrames.change);
    const controller = new AbortController();
    const first = api.recordSubscribe({}, { signal: controller.signal });
    let cursor: string;
    try {
      const frame = (await first.next()).value;
      if (!frame || frame.event !== 'heartbeat') throw new Error('Expected the initial heartbeat');
      cursor = frame.id;
      controller.abort();
      await expect(first.next()).rejects.toMatchObject({ code: 'UNS_V2_TRANSPORT_ERROR' });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await first.return(undefined);
    }
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(bufferedFrames.change));
      controller.close();
    } });
    fetch.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const resumed = api.recordSubscribe({ cursor });
    try {
      await expect(resumed.next()).resolves.toMatchObject({ value: { event: 'change', id: 'cursor.buffered' } });
      await expect(resumed.next()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      await resumed.return(undefined);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers['Last-Event-ID']).toBe('cursor.first');
    expect(vi.getTimerCount()).toBe(0);
  });
});
