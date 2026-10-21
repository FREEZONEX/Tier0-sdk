import { describe, expect, it } from 'vitest';
import { decodeUnsV2JSON, encodeUnsV2JSON, UnsV2RawNumber } from '../../src/uns-v2/codec.js';

describe('UNS v2 lossless numeric boundary', () => {
  it('preserves native Source binding IDs, exact revisions and protocol acquisition without inventing credentials', () => {
    const definition = { name: 'native-http', script: '', sdkVersion: 'tier0-stream/v2',
      sourceBindings: [{ sourceId: '9007199254740995', configRevision: new UnsV2RawNumber('9007199254740993'), acquisition: {} }] };
    const text = encodeUnsV2JSON(definition, 'RuntimeStreamDefinition');
    expect(text).toContain('"sourceId":"9007199254740995","configRevision":9007199254740993,"acquisition":{}');
    expect(decodeUnsV2JSON(text, 'RuntimeStreamDefinition')).toEqual(definition);
    expect(text).not.toMatch(/connection|credential|Capture/);
  });

  it('keeps safe schema numbers as numbers on both sides', () => {
    expect(encodeUnsV2JSON({ page: 12, size: 20 }, 'PlatformV2JobListReq')).toBe('{"page":12,"size":20}');
    expect(decodeUnsV2JSON('{"page":12,"size":20}', 'PlatformV2JobListReq')).toEqual({ page: 12, size: 20 });
  });

  it('preserves the complete signed int64 range as number or bigint', () => {
    expect(decodeUnsV2JSON('{"page":9007199254740993}', 'PlatformV2UsersListReq')).toEqual({ page: 9007199254740993n });
    expect(decodeUnsV2JSON('{"page":9223372036854775807}', 'PlatformV2UsersListReq')).toEqual({ page: 9223372036854775807n });
    expect(decodeUnsV2JSON('{"page":-9223372036854775808}', 'PlatformV2UsersListReq')).toEqual({ page: -9223372036854775808n });
    expect(encodeUnsV2JSON({ page: 9223372036854775807n }, 'PlatformV2UsersListReq')).toBe('{"page":9223372036854775807}');
    expect(() => decodeUnsV2JSON('{"page":9223372036854775808}', 'PlatformV2UsersListReq')).toThrow('signed 64-bit');
  });

  it('preserves unsafe integers, long decimals and exponents as exact raw numbers', () => {
    const text = '{"code":200,"msg":"ok","requestId":"r","data":{"integer":9007199254740993,"decimal":1.0000000000000001,"exponent":9.007199254740993e15,"ordinary":1.25}}';
    const decoded = decodeUnsV2JSON(text, 'UnsV2Envelope') as { data: Record<string, unknown> };
    expect(decoded.data.integer).toEqual(new UnsV2RawNumber('9007199254740993'));
    expect(decoded.data.decimal).toEqual(new UnsV2RawNumber('1.0000000000000001'));
    expect(decoded.data.exponent).toEqual(new UnsV2RawNumber('9.007199254740993e15'));
    expect(decoded.data.ordinary).toBe(1.25);
    expect(encodeUnsV2JSON(decoded, 'UnsV2Envelope')).toBe(text);
    expect(() => JSON.stringify(decoded)).toThrow('explicit conversion');
  });

  it('preserves business objects named numeric instead of treating them as parser tokens', () => {
    const value = {
      code: 200,
      msg: 'ok',
      requestId: 'r',
      data: {
        pressure: { numeric: '123', unit: 'bar' },
        disabled: { numeric: false },
        nullable: null,
        omitted: undefined,
      },
    };
    const encoded = encodeUnsV2JSON(value, 'UnsV2Envelope');
    expect(encoded).toBe('{"code":200,"msg":"ok","requestId":"r","data":{"pressure":{"numeric":"123","unit":"bar"},"disabled":{"numeric":false},"nullable":null}}');
    expect(decodeUnsV2JSON(encoded, 'UnsV2Envelope')).toEqual({
      code: 200,
      msg: 'ok',
      requestId: 'r',
      data: {
        pressure: { numeric: '123', unit: 'bar' },
        disabled: { numeric: false },
        nullable: null,
      },
    });
  });

  it('preserves prototype-shaped business keys without prototype mutation', () => {
    const text = '{"code":200,"msg":"ok","requestId":"r","data":{"__proto__":{"polluted":true},"constructor":{"name":"business"},"prototype":{"numeric":"7"}}}';
    const decoded = decodeUnsV2JSON(text, 'UnsV2Envelope') as Record<string, unknown>;
    const data = decoded.data as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(data, '__proto__')).toBe(true);
    expect(data.__proto__).toEqual({ polluted: true });
    expect(data.constructor).toEqual({ name: 'business' });
    expect(data.prototype).toEqual({ numeric: '7' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(encodeUnsV2JSON(decoded, 'UnsV2Envelope')).toBe(text);
  });

  it('accepts only JSON whitespace and preserves large integer decimals', () => {
    expect(() => decodeUnsV2JSON('\u00a0{"code":200}', 'UnsV2Envelope')).toThrow('Invalid JSON');
    expect(() => decodeUnsV2JSON('\ufeff{"code":200}', 'UnsV2Envelope')).toThrow('Invalid JSON');
    const decoded = decodeUnsV2JSON('{"code":200,"data":{"value":9007199254740993.0}}', 'UnsV2Envelope') as { data: { value: unknown } };
    expect(decoded.data.value).toEqual(new UnsV2RawNumber('9007199254740993.0'));
  });
});
