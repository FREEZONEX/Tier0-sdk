import {
  capabilities, createClient, CapabilityError, type CapabilitiesClient,
  type CapabilityDiscoverResponse, type CapabilityState, type PublicCapability,
} from '../../src/index.js';

const client = createClient({ getApiKey: () => 'runtime-key', transportTimeoutMs: 1000 });
const api: CapabilitiesClient = client.capabilities;
const discovery: Promise<CapabilityDiscoverResponse> = api.discover();
const globalDiscovery: Promise<CapabilityDiscoverResponse> = capabilities.discover();
async function inspect() {
  const response = await discovery;
  const product: 'cloud' | 'enterprise' = response.product;
  const version: '2.0' = response.contractVersion;
  const optionalProductVersion: string | undefined = response.productVersion;
  const capability: PublicCapability | undefined = response.capabilities[0];
  if (capability) {
    const state: CapabilityState = capability.state;
    const reason: string = capability.reasonCode;
    // @ts-expect-error duplicate enabled flag was removed in contract 2.0
    capability.enabled;
    // @ts-expect-error authorization is checked by the real operation
    capability.allowed;
    void [state, reason];
  }
  // @ts-expect-error success is direct public JSON, not an Axios envelope
  response.data;
  void [product, version, optionalProductVersion];
}
// @ts-expect-error workspace is authenticated, never request-selected
api.discover({ workspaceID: 3 });
// @ts-expect-error no body/options even when empty
api.discover({});
// @ts-expect-error retries cannot be enabled per call
api.discover({ retry: true });
// @ts-expect-error transport budget is configured on the factory only
api.discover({ transportTimeoutMs: 10 });
// @ts-expect-error readiness boolean is not a legacy numeric enum
const enabled: PublicCapability['enabled'] = 1;
// @ts-expect-error duplicate availability was removed
const availability: PublicCapability['availability'] = 'ready';
const currentSource: PublicCapability['code'] = 'source';
const currentStream: PublicCapability['code'] = 'stream';
// @ts-expect-error retired standalone control capability is not exported
const retiredControl: PublicCapability['code'] = 'control.v1';
// App request capability labels retain their protocol version over the v2 transport.
const appRequest: PublicCapability['code'] = 'stream.requests.v1';
// @ts-expect-error Source capability does not select an internal generation
const legacySource: PublicCapability['code'] = 'source.v1';
// @ts-expect-error Stream capability does not select an internal generation
const legacyStream: PublicCapability['code'] = 'stream.v2';
const error = new CapabilityError('public', { status: 503, errorCode: 'UNKNOWN_BACKEND_STRING_CODE' });
const retryable: false = error.retryable;
void [globalDiscovery, inspect, enabled, availability, retryable, currentSource, currentStream, legacySource, legacyStream, retiredControl, appRequest];
