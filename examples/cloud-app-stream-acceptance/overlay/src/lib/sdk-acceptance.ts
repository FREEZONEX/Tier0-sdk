import type { StreamJSON } from '@tier0/sdk';

export function parseBusinessJSON(text: string): StreamJSON {
  if (new TextEncoder().encode(text).length > 65536) throw new Error('Fixture JSON limit is 64 KiB.');
  return JSON.parse(text) as StreamJSON;
}

export function businessSelector(value: string): string {
  const selector = value.trim();
  if (!selector || selector.length > 200 || /[\s:*?>\\]/.test(selector) || selector.includes('://')) {
    throw new Error('Enter a business code or exact business topic (slashes are allowed); no URL or wildcard.');
  }
  return selector;
}

/** Only public error metadata enters the evidence view; never serialize transport internals. */
export function publicFailure(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const outcomeUnknown = source.outcomeUnknown === true || source.errorCode === 'STREAM_REQUEST_RESULT_UNKNOWN';
  return {
    message: error instanceof Error ? error.message
      .replace(/(?:https?|wss?):\/\/[^\s]+/g, '[runtime endpoint]')
      .replace(/\b[A-Za-z0-9_=-]{80,}\b/g, '[redacted]') : 'Unknown SDK failure',
    errorCode: typeof source.errorCode === 'string' ? source.errorCode : 'FIXTURE_CLIENT_ERROR',
    status: source.status,
    runID: source.runID,
    contractVersion: source.contractVersion,
    runStatus: source.runStatus,
    replayed: source.replayed,
    retryable: source.retryable,
    outcomeUnknown,
  };
}

export type DisposableSubscription = { readonly disposed: boolean; dispose(): Promise<void> };

/** A cancelled pending subscribe must dispose its eventual handle rather than attach it. */
export class SubscriptionSlot {
  private generation = 0;
  private handle?: DisposableSubscription;

  begin(): number { return ++this.generation; }
  current(ticket: number): boolean { return ticket === this.generation; }
  async attach(ticket: number, handle: DisposableSubscription): Promise<boolean> {
    if (!this.current(ticket)) { await handle.dispose(); return false; }
    this.handle = handle;
    return true;
  }
  async dispose(): Promise<void> {
    ++this.generation;
    const handle = this.handle;
    if (handle) {
      await handle.dispose();
      if (this.handle === handle) this.handle = undefined;
    }
  }
}
