import { CloudTransport, CloudTransportError } from '../cloud-transport.js';
import { decodeUnsV2JSON } from './codec.js';
import type { CloudRecordChangeEvent, CloudRecordSubscribeReset } from './generated.js';

export interface RecordSubscribeRequest {
  collectionIds?: string[];
  recordIds?: string[];
  cursor?: string;
}

export type RecordSubscribeFrame =
  | { event: 'heartbeat'; id: string; data: { at: unknown } }
  | { event: 'change'; id: string; data: CloudRecordChangeEvent }
  | { event: 'reset'; data: CloudRecordSubscribeReset };

export async function* recordSubscription(transport: CloudTransport, request: RecordSubscribeRequest, signal?: AbortSignal): AsyncGenerator<RecordSubscribeFrame> {
  const invalid = () => new CloudTransportError('PROTOCOL_ERROR', 200);
  if (!request || Object.keys(request).some(key => !['collectionIds', 'recordIds', 'cursor'].includes(key))) {
    throw new TypeError('Tier0 SDK: unsupported SSE request field.');
  }
  const query = new URLSearchParams();
  for (const [key, max] of [['collectionIds', 64], ['recordIds', 100]] as const) {
    const ids = request[key];
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || !ids.length || ids.length > max || new Set(ids).size !== ids.length ||
        ids.some(id => typeof id !== 'string' || !id.length || id.length > 128)) throw new TypeError('Tier0 SDK: invalid SSE identities.');
    for (const id of ids) query.append(key, id);
  }
  if (request.recordIds && request.collectionIds?.length !== 1) throw new TypeError('Tier0 SDK: SSE recordIds require one collection.');
  if (request.cursor !== undefined && (typeof request.cursor !== 'string' || !request.cursor.length || request.cursor.length > 8192 || /[^\x20-\x7e]/.test(request.cursor))) {
    throw new TypeError('Tier0 SDK: invalid SSE cursor.');
  }
  let pending = '';
  let event = '';
  let id = '';
  let lines: string[] = [];
  const search = query.toString();
  for await (const { text, checkActive } of transport.recordEvents(search ? `?${search}` : '', request.cursor, signal)) {
    pending += text;
    while (true) {
      const newline = pending.match(/\r\n|[\r\n]/);
      if (!newline || (newline[0] === '\r' && newline.index === pending.length - 1)) break;
      const line = pending.slice(0, newline.index);
      pending = pending.slice(newline.index! + newline[0].length);
      if (!line) {
        if (lines.length) {
          let data: unknown;
          try { data = decodeUnsV2JSON(lines.join('\n'), event === 'change' ? 'CloudRecordChangeEvent' : event === 'reset' ? 'CloudRecordSubscribeReset' : 'UnsV2Envelope'); }
          catch { throw invalid(); }
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
          const value = data as Record<string, unknown>;
          if (event === 'change') {
            if (!id || value.eventId !== id || typeof value.collectionId !== 'string' || typeof value.recordId !== 'string' ||
                !['record', 'delete'].includes(String(value.change)) || typeof value.restricted !== 'boolean' ||
                value.revision === undefined || value.occurredAt === undefined) throw invalid();
            checkActive();
            yield { event, id, data: data as CloudRecordChangeEvent };
          } else if (event === 'heartbeat') {
            if (!id || value.at === undefined) throw invalid();
            checkActive();
            yield { event, id, data: { at: value.at } };
          } else if (event === 'reset') {
            if (!['CURSOR_EXPIRED', 'SCOPE_CHANGED'].includes(String(value.reason))) throw invalid();
            checkActive();
            yield { event, data: data as CloudRecordSubscribeReset };
            return;
          }
        }
        event = ''; id = ''; lines = [];
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        if (field === 'id') { if (value.length > 8192 || /\0/.test(value)) throw invalid(); id = value; }
        if (field === 'data') lines.push(value);
      }
    }
  }
  // An incomplete frame has no acknowledged cursor and cannot be delivered.
  if (pending || lines.length) throw invalid();
}
