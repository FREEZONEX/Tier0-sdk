import { UNS_V2_CODEC_SCHEMAS } from './generated.js';

type Codec = { readonly k?: string; readonly r?: string; readonly i?: Codec; readonly p?: Record<string, Codec>; readonly x?: Codec; readonly a?: readonly Codec[] };
const numericBrand: unique symbol = Symbol('UnsV2NumericToken');
type NumericToken = { readonly [numericBrand]: string };
const schemas = UNS_V2_CODEC_SCHEMAS as unknown as Record<string, Codec>;
const jsonNumberPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const int64Min = -(1n << 63n);
const int64Max = (1n << 63n) - 1n;

/** Exact JSON number used when JavaScript number cannot preserve the wire value. */
export class UnsV2RawNumber {
  readonly lexeme: string;

  constructor(lexeme: string) {
    if (!jsonNumberPattern.test(lexeme)) throw new TypeError('Tier0 SDK: invalid raw JSON number.');
    this.lexeme = lexeme;
    Object.freeze(this);
  }

  toNumber(): number { return Number(this.lexeme); }
  toBigInt(): bigint {
    if (!/^-?(?:0|[1-9]\d*)$/.test(this.lexeme)) throw new TypeError('Tier0 SDK: raw JSON number is not an integer.');
    return BigInt(this.lexeme);
  }
  toString(): string { return this.lexeme; }
  toJSON(): never {
    throw new TypeError('Tier0 SDK: UnsV2RawNumber requires encodeUnsV2JSON or explicit conversion.');
  }
}

function numeric(value: unknown): value is NumericToken {
  return value !== null && typeof value === 'object' && numericBrand in value;
}

class JSONParser {
  private offset = 0;
  constructor(private readonly text: string) {}

  parse(): unknown {
    const value = this.value();
    this.space();
    if (this.offset !== this.text.length) throw new SyntaxError('Trailing JSON content.');
    return value;
  }

  private space(): void {
    while (this.text[this.offset] === ' ' || this.text[this.offset] === '\t' ||
      this.text[this.offset] === '\r' || this.text[this.offset] === '\n') this.offset += 1;
  }

  private value(): unknown {
    this.space();
    const char = this.text[this.offset];
    if (char === '"') return this.string();
    if (char === '{') return this.object();
    if (char === '[') return this.array();
    if (this.text.startsWith('true', this.offset)) { this.offset += 4; return true; }
    if (this.text.startsWith('false', this.offset)) { this.offset += 5; return false; }
    if (this.text.startsWith('null', this.offset)) { this.offset += 4; return null; }
    const match = this.text.slice(this.offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (match) { this.offset += match[0].length; return { [numericBrand]: match[0] }; }
    throw new SyntaxError(`Invalid JSON at offset ${this.offset}.`);
  }

  private string(): string {
    const start = this.offset++;
    let escaped = false;
    while (this.offset < this.text.length) {
      const char = this.text[this.offset++];
      if (char === '"' && !escaped) return JSON.parse(this.text.slice(start, this.offset)) as string;
      if (char === '\\' && !escaped) escaped = true;
      else escaped = false;
    }
    throw new SyntaxError('Unterminated JSON string.');
  }

  private object(): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    this.offset += 1;
    this.space();
    if (this.text[this.offset] === '}') { this.offset += 1; return result; }
    while (true) {
      this.space();
      if (this.text[this.offset] !== '"') throw new SyntaxError('Expected JSON object key.');
      const key = this.string();
      this.space();
      if (this.text[this.offset++] !== ':') throw new SyntaxError('Expected JSON object colon.');
      result[key] = this.value();
      this.space();
      const delimiter = this.text[this.offset++];
      if (delimiter === '}') return result;
      if (delimiter !== ',') throw new SyntaxError('Expected JSON object delimiter.');
    }
  }

  private array(): unknown[] {
    const result: unknown[] = [];
    this.offset += 1;
    this.space();
    if (this.text[this.offset] === ']') { this.offset += 1; return result; }
    while (true) {
      result.push(this.value());
      this.space();
      const delimiter = this.text[this.offset++];
      if (delimiter === ']') return result;
      if (delimiter !== ',') throw new SyntaxError('Expected JSON array delimiter.');
    }
  }
}

function variants(codec: Codec | undefined, seen = new Set<string>()): Codec[] {
  if (!codec) return [];
  if (codec.r) {
    if (seen.has(codec.r)) return [];
    const next = new Set(seen);
    next.add(codec.r);
    return variants(schemas[codec.r], next);
  }
  if (codec.k === 'u') return (codec.a || []).flatMap(item => variants(item, seen));
  return [codec];
}

function kind(codec: Codec | undefined, expected: string): Codec | undefined {
  return variants(codec).find(item => item.k === expected);
}

function property(codec: Codec | undefined, name: string): Codec | undefined {
  const objects = variants(codec).filter(candidate => candidate.k === 'o');
  const explicit = objects.flatMap(candidate => candidate.p && Object.prototype.hasOwnProperty.call(candidate.p, name) ? [candidate.p[name]] : []);
  const matches = explicit.length ? explicit : objects.flatMap(candidate => candidate.x ? [candidate.x] : []);
  return matches.length > 1 ? { k: 'u', a: matches } : matches[0];
}

function decimalIdentity(token: string): string {
  const match = token.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) throw new SyntaxError('Invalid JSON number.');
  const negative = match[1] === '-';
  const fraction = match[3] || '';
  let digits = `${match[2]}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  let power = Number(match[4] || 0) - fraction.length;
  const trailing = digits.match(/0+$/)?.[0].length || 0;
  if (trailing) {
    digits = digits.slice(0, -trailing);
    power += trailing;
  }
  return `${negative ? '-' : ''}${digits}e${power}`;
}

function decode(value: unknown, codec: Codec | undefined): unknown {
  if (numeric(value)) {
    const token = value[numericBrand];
    if (kind(codec, 'i')) {
      if (!/^-?(?:0|[1-9]\d*)$/.test(token)) throw new SyntaxError('Invalid int64 JSON token.');
      const integer = BigInt(token);
      if (integer < int64Min || integer > int64Max) throw new SyntaxError('UNS v2 int64 exceeds the signed 64-bit range.');
      return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(integer) : integer;
    }
    if (kind(codec, 'j') && !/^-?(?:0|[1-9]\d*)$/.test(token)) {
      throw new SyntaxError('Invalid integer JSON token.');
    }
    const number = Number(token);
    if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)) &&
      decimalIdentity(token) === decimalIdentity(JSON.stringify(number))) return number;
    return new UnsV2RawNumber(token);
  }
  if (Array.isArray(value)) {
    const item = kind(codec, 'a')?.i;
    return value.map(entry => decode(entry, item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, decode(entry, property(codec, name))]));
  }
  return value;
}

function encode(value: unknown, codec: Codec | undefined, seen: Set<unknown>): string | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') {
    if (!kind(codec, 'i') || value < int64Min || value > int64Max) {
      throw new TypeError('Tier0 SDK: bigint is only valid for signed int64 contract fields.');
    }
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Tier0 SDK: UNS v2 request contains a non-finite number.');
    if (kind(codec, 'j') && !Number.isInteger(value)) {
      throw new TypeError('Tier0 SDK: UNS v2 integer field requires an integer.');
    }
    if (kind(codec, 'i') && !Number.isSafeInteger(value)) {
      throw new TypeError('Tier0 SDK: UNS v2 int64 must be a safe integer; string coercion is forbidden.');
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError('Tier0 SDK: UNS v2 request integer exceeds the JavaScript safe-integer range.');
    }
    return JSON.stringify(value);
  }
  if (value instanceof UnsV2RawNumber) {
    if (kind(codec, 'i')) {
      if (!/^-?(?:0|[1-9]\d*)$/.test(value.lexeme)) throw new TypeError('Tier0 SDK: int64 requires an integer.');
      const integer = BigInt(value.lexeme);
      if (integer < int64Min || integer > int64Max) throw new TypeError('Tier0 SDK: int64 exceeds the signed 64-bit range.');
    }
    if (kind(codec, 'j') && !/^-?(?:0|[1-9]\d*)$/.test(value.lexeme)) {
      throw new TypeError('Tier0 SDK: integer field requires an integer.');
    }
    return value.lexeme;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Tier0 SDK: UNS v2 request must be acyclic JSON.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const item = kind(codec, 'a')?.i;
      return `[${value.map(entry => {
        const encoded = encode(entry, item, seen);
        if (encoded === undefined) throw new TypeError('Tier0 SDK: UNS v2 arrays cannot contain undefined.');
        return encoded;
      }).join(',')}]`;
    }
    const entries: string[] = [];
    for (const [name, entry] of Object.entries(value)) {
      const encoded = encode(entry, property(codec, name), seen);
      if (encoded !== undefined) entries.push(`${JSON.stringify(name)}:${encoded}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function encodeUnsV2JSON(value: unknown, schemaName: string): string {
  const encoded = encode(value, { r: schemaName }, new Set());
  if (encoded === undefined) throw new TypeError('Tier0 SDK: UNS v2 request body is required.');
  return encoded;
}

export function decodeUnsV2JSON(text: string, schemaName: string): unknown {
  return decode(new JSONParser(text).parse(), { r: schemaName });
}
