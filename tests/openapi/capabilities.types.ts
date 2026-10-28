import {
  capabilities, createClient, CapabilityError, type CapabilitiesClient,
  type CapabilityDiscoverResponse, type CapabilityState, type CapabilityAvailability, type PublicCapability,
} from '../../src/index.js';

const client = createClient({ getApiKey: () => 'runtime-key', transportTimeoutMs: 1000 });
const api: CapabilitiesClient = client.capabilities;
const discovery: Promise<CapabilityDiscoverResponse> = api.discover();
const globalDiscovery: Promise<CapabilityDiscoverResponse> = capabilities.discover();
async function inspect() {
  const response = await discovery;
  const product: 'cloud' | 'enterprise' = response.product;
  const version: '1.0' = response.contractVersion;
  const optionalProductVersion: string | undefined = response.productVersion;
  const capability: PublicCapability | undefined = response.capabilities[0];
  if (capability) {
    const release: boolean = capability.releaseEnabled;
    const allowed: boolean = capability.allowed;
    const enabled: boolean = capability.enabled;
    const state: CapabilityState = capability.state;
    const availability: CapabilityAvailability = capability.availability;
    void [release, allowed, enabled, state, availability];
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
// @ts-expect-error unknown availability cannot be treated as ready
const availability: CapabilityAvailability = 'ready';
const currentSource: PublicCapability['code'] = 'source';
const currentStream: PublicCapability['code'] = 'stream';
// @ts-expect-error Source capability does not select an internal generation
const legacySource: PublicCapability['code'] = 'source.v1';
// @ts-expect-error Stream capability does not select an internal generation
const legacyStream: PublicCapability['code'] = 'stream.v2';
const error = new CapabilityError('public', { status: 503, errorCode: 'UNKNOWN_BACKEND_STRING_CODE' });
const retryable: false = error.retryable;
void [globalDiscovery, inspect, enabled, availability, retryable, currentSource, currentStream, legacySource, legacyStream];
