import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, UNS_V2_OPERATIONS, UnsV2Error, UnsV2OutcomeUnknownError, UnsV2RawNumber } from '../../src/index.js';
import { decodeUnsV2JSON, encodeUnsV2JSON } from '../../src/uns-v2/codec.js';

const manifest = JSON.parse(readFileSync(new URL('../../contracts/uns-v2/manifest.json', import.meta.url), 'utf8'));
const sapSchema = manifest.schemas.CloudSourceConfig.oneOf.find((schema: { properties: { sourceType?: { const: string } } }) =>
  schema.properties.sourceType?.const === 'sap-odata');
const api = () => createClient({ apiHost: 'https://gateway.example.test', apiKey: 'fixture-management-key' }).unsV2;
const sap = {
  configVersion: 3 as const, sourceType: 'sap-odata' as const, endpoint: 'https://sap.example.test/service/',
  options: { headers: { 'X-Vendor-Scope': 'fixture-scope' } }, auth: { kind: 'vendorBasic' as const, credentialRef: 'opaque-sap-ref' },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('frozen v5 Source management contract', () => {
  it('exposes discovery as an audited management operation without App authority', () => {
    const discovery = manifest.operations.find((operation: { name: string }) => operation.name === 'sourceDiscover');
    expect(discovery.coreOnly === true).toBe(false);
    expect(discovery).toMatchObject({
      permission: 'uns.source.manage', scope: 'source:manage', minPermission: 3, appAllowed: false,
      readOnly: false, sideEffect: true,
      requestSchema: { $ref: '#/components/schemas/CloudSourceDiscoverReq' },
      responseSchema: { $ref: '#/components/schemas/CloudSourceDiscoverResponse' },
    });
    expect(UNS_V2_OPERATIONS.sourceDiscover).toMatchObject({
      path: '/openapi/v2/uns/sources/discover', method: 'POST', mutation: true,
      request: 'CloudSourceDiscoverReq', response: 'CloudSourceDiscoverResponse',
    });
    expect(manifest.schemas.CloudSourceDiscoverReq).toMatchObject({
      additionalProperties: false, required: ['id', 'expectedRevision'],
    });
    expect(sapSchema).toMatchObject({ additionalProperties: false, required: ['configVersion', 'sourceType', 'endpoint', 'options', 'auth'] });
    expect(sapSchema.properties.auth.properties.kind.enum).toEqual(['vendorNative', 'vendorBasic']);
    expect(sapSchema.properties).not.toHaveProperty('tls');
    expect(sapSchema.properties.options.additionalProperties).toBe(false);
  });

  it('retains all native vendor contracts without exposing credential material in Source configuration', () => {
    const vendors = manifest.schemas.CloudSourceConfig.oneOf.filter((schema: { properties: { configVersion: { const: number } } }) =>
      schema.properties.configVersion.const === 3);
    expect(vendors).toHaveLength(11);
    expect(new Set(vendors.map((schema: { properties: { sourceType: { const: string } } }) => schema.properties.sourceType.const))).toEqual(
      new Set(['sap-odata', 'pi-web-api', 'plex-mes', 'wms-rest', 'yonyou-yonbip', 'kingdee-jdy', 'ngp', 'kingdee-k3cloud', 'salesforce', 'teamcenter', 'hikvision-isapi'])
    );
    for (const schema of vendors) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.auth.properties.kind.enum).toContain('vendorNative');
      expect(schema.properties.auth.properties).not.toHaveProperty('fields');
      expect(schema.properties.auth.properties).not.toHaveProperty('password');
      const endpoint = new RegExp(schema.properties.endpoint.pattern);
      expect(endpoint.test('http://vendor.example.test/service/')).toBe(schema.properties.sourceType.const === 'wms-rest');
      expect(endpoint.test('https://vendor.example.test/service/')).toBe(true);
    }
  });

  it('keeps write-only credential creation inside the Core management boundary', () => {
    const credential = manifest.operations.find((operation: { name: string }) => operation.name === 'sourceCredentialCreate');
    expect(credential).toMatchObject({ coreOnly: true, appAllowed: false });
    expect(Object.hasOwn(UNS_V2_OPERATIONS, 'sourceCredentialCreate')).toBe(false);
    expect(manifest.schemas.CloudSourceCredentialCreateReq.properties.kind.enum).toContain('vendorNative');
  });

  it('maps discovery to its native route and preserves resources without widening their authority', async () => {
    const data = { id: '9007199254740995', revision: 3, sourceType: 'sap-odata', resources: [
      { ref: 'vendor:sap-odata:service', name: 'service', readOnly: true },
      { ref: 'vendor:sap-odata:entity:Materials', name: 'Materials', readOnly: true },
    ] };
    const fetch = vi.fn(async () => json({ code: 200, msg: 'ok', requestId: 'discover-fixture', data }));
    vi.stubGlobal('fetch', fetch);
    expect((await api().sourceDiscover({ id: data.id, expectedRevision: 3 })).data).toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.example.test/openapi/v2/uns/sources/discover');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ id: data.id, expectedRevision: 3 });
  });

  it.each([
    [403, 'FORBIDDEN', 'notStarted', false],
    [409, 'VERSION_CONFLICT', 'notStarted', false],
    [503, 'TEMPORARILY_UNAVAILABLE', 'unknown', true],
  ] as const)('preserves discovery %s/%s execution without retry', async (status, code, execution, unknown) => {
    const fetch = vi.fn(async () => json({ code: status, msg: 'fixture rejection', requestId: 'rejected-discovery', data: null,
      error: { code, reason: 'fixture rejection', details: [], execution, retry: { safe: false } } }, status));
    vi.stubGlobal('fetch', fetch);
    const error = await api().sourceDiscover({ id: '101', expectedRevision: 2 }).catch(value => value);
    expect(error).toBeInstanceOf(UnsV2Error);
    expect(error instanceof UnsV2OutcomeUnknownError).toBe(unknown);
    expect(error).toMatchObject({ code, status, execution, retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['transport', 'invalid-json', 'invalid-envelope'] as const)(
    'keeps discovery outcome unknown after %s without retry', async kind => {
      const fetch = vi.fn(async () => {
        if (kind === 'transport') throw new TypeError('fixture transport failure');
        return kind === 'invalid-json' ? new Response('{', { status: 200 }) : json({ code: 200, data: null });
      });
      vi.stubGlobal('fetch', fetch);
      const error = await api().sourceDiscover({ id: '101', expectedRevision: 2 }).catch(value => value);
      expect(error).toBeInstanceOf(UnsV2OutcomeUnknownError);
      expect(error).toMatchObject({ operation: 'sourceDiscover', retryable: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves sourceTypes and the upstream SAP schema through the open protocols response', async () => {
    const sourceTypes = [{ id: 'sap-odata', protocol: 'http', configVersion: 3, configSchema: sapSchema, credentialKinds: ['vendorBasic'] }];
    const fetch = vi.fn(async () => json({ code: 200, msg: 'ok', requestId: 'protocols-fixture', data: { sourceTypes } }));
    vi.stubGlobal('fetch', fetch);
    expect((await api().sourceProtocolsList({})).data.sourceTypes).toEqual(sourceTypes);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://gateway.example.test/openapi/v2/uns/sources/protocols/list');
  });

  it.each([
    { configVersion: 2, endpoint: 'https://generic.example.test/data', options: { custom: 1.25 } }, sap,
  ])('retains numeric codecs across configVersion $configVersion schema alternatives and batch items', config => {
    const request = { dryRun: true, items: [{ id: '101', expectedRevision: new UnsV2RawNumber('9007199254740993'),
      document: { name: 'Source fixture', protocol: 'http', config } }] };
    const wire = encodeUnsV2JSON(request, 'CloudSourceDocumentUpdateReq');
    expect(wire).toContain('"expectedRevision":9007199254740993');
    expect(decodeUnsV2JSON(wire, 'CloudSourceDocumentUpdateReq')).toEqual(request);
    const invalid = { ...request, items: [{ ...request.items[0], document: { ...request.items[0].document,
      config: { ...config, configVersion: 1.5 } } }] };
    expect(() => encodeUnsV2JSON(invalid, 'CloudSourceDocumentUpdateReq')).toThrow('integer');
    expect(() => decodeUnsV2JSON(wire.replace(`"configVersion":${config.configVersion}`, '"configVersion":1.5'),
      'CloudSourceDocumentUpdateReq')).toThrow('integer');
  });

  it('maps SAP create/update/patch requests through every supported request schema shape', async () => {
    const fetch = vi.fn(async () => json({ code: 200, msg: 'ok', requestId: 'source-preview', data: { dryRun: true } }));
    vi.stubGlobal('fetch', fetch);
    const document = { name: 'SAP fixture', protocol: 'http' as const, config: sap };
    const sdk = api();
    await sdk.sourceDocumentCreate({ dryRun: true, document });
    await sdk.sourceDocumentCreate({ dryRun: true, items: [{ document }] });
    await sdk.sourceDocumentUpdate({ dryRun: true, id: '101', expectedRevision: 2, document });
    await sdk.sourceDocumentUpdate({ dryRun: true, items: [{ id: '101', expectedRevision: 2, patch: { config: sap } }] });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string))).toEqual([
      { dryRun: true, document }, { dryRun: true, items: [{ document }] },
      { dryRun: true, id: '101', expectedRevision: 2, document },
      { dryRun: true, items: [{ id: '101', expectedRevision: 2, patch: { config: sap } }] },
    ]);
  });
});
