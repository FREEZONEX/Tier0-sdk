---
name: tier0-sdk-openapi-info
version: 0.4.0
description: "POST /openapi/v1/info — get Tier0 service info (connectivity check)"
---

# info — `POST /openapi/v1/info`

Gets basic information about the Tier0 gateway service. Commonly used to verify API connectivity and authentication configuration.

## SDK Call

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.openapiv1info({});
```

## Request Parameters

None — pass an empty object `{}`.

## Response Structure

```typescript
{
  code: number;
  msg: string;
  data: {
    name: string;           // service name, e.g. "Tier0 UNS OpenAPI"
    version: string;        // API version, e.g. "v1"
    capabilities: string[]; // supported operations, e.g. ["read","write","browse","search","create","update","delete"]
    mqttBroker: string;     // MQTT broker address for the current environment
  };
}
```

## Example

### Verify connectivity and authentication

```typescript
import { systemApi } from '@tier0/sdk/openapi';

try {
  const result = await systemApi.openapiv1info({});
  console.log('Connected');
  console.log('  Service:', result.data.name);      // "Tier0 UNS OpenAPI"
  console.log('  Version:', result.data.version);    // "v1"
  console.log('  Capabilities:', result.data.capabilities.join(', '));
  console.log('  MQTT Broker:', result.data.mqttBroker);
} catch (error) {
  if (error instanceof Error) {
    // "HTTP 401" → invalid API key
    // "HTTP 502" / network error → wrong host configuration
    console.error('Connection failed:', error.message);
  }
}
```
