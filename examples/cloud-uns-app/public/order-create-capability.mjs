const version = 'cloud-app-create-capability/v1';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysWithin = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const revision = (value) => Number.isSafeInteger(value) && value > 0;

// This fixed form can supply only these two fields. Prove that at least one
// supported input exists; the actual values and every write/replay still go
// through live Core authorization. Never derive write input from read schema.
export function orderCreateHint(capability, appRevision) {
  if (!object(capability) || capability.version !== version || typeof capability.allowed !== 'boolean' ||
      typeof capability.reason !== 'string' || !revision(appRevision) || !revision(capability.appRevision) ||
      capability.appRevision !== appRevision || !revision(capability.collectionRevision) ||
      typeof capability.binding !== 'string' || !/^[a-f0-9]{64}$/.test(capability.binding)) return 'createUnavailable';
  // binding is only a cache invalidation hint, never an authorization token.
  // This example fetches context per request and does not cache or return it.
  if (!capability.allowed) return 'createDenied';
  const schema = capability.inputSchema;
  if (!keysWithin(schema, ['type', 'properties', 'required', 'additionalProperties', 'title', 'description', 'unit']) ||
      schema.type !== 'object' || schema.additionalProperties !== false || !object(schema.properties) ||
      (schema.required !== undefined && (!Array.isArray(schema.required) ||
        new Set(schema.required).size !== schema.required.length || schema.required.some((key) => !['orderNo', 'amount'].includes(key)))) ||
      !['orderNo', 'amount'].every((key) => Object.hasOwn(schema.properties, key))) return 'createUnsupported';
  const order = schema.properties.orderNo, amount = schema.properties.amount;
  if (!keysWithin(order, ['type', 'enum', 'title', 'description', 'unit']) || order.type !== 'string' ||
      (Object.hasOwn(order, 'enum') && (!Array.isArray(order.enum) ||
        !order.enum.some((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value))))) return 'createUnsupported';
  if (!keysWithin(amount, ['type', 'enum', 'minimum', 'maximum', 'title', 'description', 'unit']) ||
      !['integer', 'number'].includes(amount.type) ||
      ['minimum', 'maximum'].some((key) => Object.hasOwn(amount, key) &&
        (typeof amount[key] !== 'number' || !Number.isFinite(amount[key]) || Math.abs(amount[key]) > Number.MAX_SAFE_INTEGER))) return 'createUnsupported';
  const minimum = Math.max(0, Math.ceil(amount.minimum ?? 0));
  const maximum = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(amount.maximum ?? Number.MAX_SAFE_INTEGER));
  if (minimum > maximum || (Object.hasOwn(amount, 'enum') && (!Array.isArray(amount.enum) ||
      !amount.enum.some((value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum)))) return 'createUnsupported';
  return 'createAllowed';
}
