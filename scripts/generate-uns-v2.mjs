import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = {
  contract: 'contracts/uns-v2/contract.json',
  cloudSupport: 'contracts/uns-v2/cloud-support.json',
  manifest: 'contracts/uns-v2/manifest.json',
  provenance: 'contracts/uns-v2/provenance.json',
  registry: 'contracts/uns-v2/registry_generated.go',
};
const output = 'src/uns-v2/generated.ts';
const read = path => readFileSync(resolve(root, path), 'utf8');
const parse = path => JSON.parse(read(path));
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`UNS v2 contract: ${message}`); };

const contractText = read(inputs.contract);
const cloudSupportText = read(inputs.cloudSupport);
const manifestText = read(inputs.manifest);
const provenanceText = read(inputs.provenance);
const registryText = read(inputs.registry);
const contract = JSON.parse(contractText);
const cloudSupport = JSON.parse(cloudSupportText);
const manifest = JSON.parse(manifestText);
const provenance = JSON.parse(provenanceText);

if (contract.version !== manifest.version || contract.version !== provenance.version) {
  fail('contract, manifest and provenance versions differ');
}
if (contract.cloudContractRevision !== manifest.cloudContractRevision ||
    manifest.cloudContractRevision !== provenance.cloudContractRevision) {
  fail('contract, manifest and provenance Cloud revisions differ');
}
const contractOperations = new Map(contract.operations.map(operation => [operation.name, operation]));
if (contractOperations.size !== contract.operations.length || contract.operations.length !== manifest.operations.length) {
  fail('resolved contract operation set differs from manifest.json');
}
const cloudOperations = new Map();
for (const operation of cloudSupport.operations || []) {
  if (cloudOperations.has(operation.name)) fail(`duplicate Cloud-supported operation ${operation.name}`);
  cloudOperations.set(operation.name, operation);
}
const seen = new Set();
for (const operation of manifest.operations) {
  if (seen.has(operation.name)) fail(`duplicate operation ${operation.name}`);
  seen.add(operation.name);
  const source = contractOperations.get(operation.name);
  const cloud = cloudOperations.get(operation.name);
  if (!source && !cloud) fail(`manifest operation ${operation.name} is absent from contract.json and cloud-support.json`);
  if (source) {
    for (const key of ['request', 'response', 'method', 'transport', 'coreOnly', 'appAllowed', 'readOnly', 'permission', 'scope', 'minPermission']) {
      const expected = source[key] ?? (key === 'response' ? 'UnsV2Envelope' : undefined);
      if (operation[key] !== expected) fail(`${operation.name}.${key} differs from contract.json`);
    }
  }
  if (typeof operation.readOnly !== 'boolean' || Boolean(operation.mutation) && operation.readOnly) {
    fail(`${operation.name} has inconsistent side-effect metadata`);
  }
  if ((source && operation.path !== source.suffix) || !operation.path?.startsWith('/uns/') ||
      (operation.method !== 'POST' && !(operation.method === 'GET' && operation.transport === 'sse')) || operation.supported !== true) {
    fail(`${operation.name} has an unsupported route contract`);
  }
  const pathParams = operation.path.split('/').filter(part => part.startsWith(':')).map(part => part.slice(1));
  if (JSON.stringify(pathParams) !== JSON.stringify(operation.pathParams || [])) {
    fail(`${operation.name} path parameters differ from its route`);
  }
  if (!manifest.schemas[operation.request] || !manifest.schemas[operation.response]) {
    fail(`${operation.name} references a missing schema`);
  }
}

for (const [name, supported] of cloudOperations) {
  const operation = manifest.operations.find(item => item.name === name);
  if (!operation) fail(`Cloud-supported operation ${name} is absent from manifest.json`);
  for (const key of ['permission', 'scope', 'minPermission']) {
    if (operation[key] !== supported[key]) fail(`${name}.${key} differs from cloud-support.json`);
  }
}

const registryNames = [...registryText.matchAll(/\{Name: "([^"]+)"/g)].map(match => match[1]);
if (registryNames.length !== manifest.operations.length || registryNames.some((name, index) => name !== manifest.operations[index].name)) {
  fail('registry_generated.go operation order differs from manifest.json');
}

// Direct request discovery/execution has one SDK entry: streams.requests (v1).
// Classify by authority metadata so renaming a v2 route cannot restore an alias.
const requestExecution = operation => /^stream\.requests:(read|invoke)$/.test(operation.scope);
const publicOperations = manifest.operations.filter(operation => !operation.coreOnly && !requestExecution(operation));
const refName = ref => ref?.startsWith('#/components/schemas/') ? ref.slice('#/components/schemas/'.length) : undefined;
const requestType = operation => refName(operation.requestSchema?.$ref) || operation.request;
const responseType = operation => refName(operation.responseSchema?.$ref) || operation.response;

function reachableSchemas(operations) {
  const names = new Set();
  const pending = operations.flatMap(operation => [requestType(operation), responseType(operation)]);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    const name = refName(value.$ref);
    if (name) pending.push(name);
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') visit(nested);
    }
  };
  while (pending.length) {
    const name = pending.pop();
    if (names.has(name)) continue;
    if (!manifest.schemas[name]) fail(`missing referenced schema ${name}`);
    names.add(name);
    visit(manifest.schemas[name]);
  }
  return names;
}

const publicSchemaNames = reachableSchemas(publicOperations);
const privateSchemaNames = reachableSchemas(manifest.operations.filter(operation => operation.coreOnly || requestExecution(operation)));
// A resolved Cloud source also contains Core-only schemas. Export only those
// reachable publicly or unrelated to private operations; never expose private DTOs.
const exportedSchemas = Object.fromEntries(Object.entries(manifest.schemas).filter(([name]) =>
  !privateSchemaNames.has(name) || publicSchemaNames.has(name)));
// Retained legacy DTO exports may share query primitives with Core graph schemas.
// Include their transitive dependencies so generated public declarations remain closed.
const dependencyQueue = Object.values(exportedSchemas);
const includeDependencies = value => {
  if (!value || typeof value !== 'object') return;
  const name = refName(value.$ref);
  if (name && !Object.hasOwn(exportedSchemas, name)) {
    if (!manifest.schemas[name]) fail(`missing retained schema dependency ${name}`);
    exportedSchemas[name] = manifest.schemas[name];
    dependencyQueue.push(manifest.schemas[name]);
  }
  for (const nested of Object.values(value)) includeDependencies(nested);
};
while (dependencyQueue.length) includeDependencies(dependencyQueue.pop());
const literal = value => JSON.stringify(value);
const union = values => [...new Set(values.filter(Boolean))].join(' | ') || 'never';

function typeFor(schema, nested = false) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return 'UnsV2JSONValue';
  // 单字段排除可以准确表达，避免 SQL 凭据误带 HTTP method。
  if (schema.properties && schema.not && Object.keys(schema.not).length === 1 && schema.not.required?.length === 1) {
    const { not, ...shape } = schema;
    return `(${typeFor(shape, nested)} & { ${JSON.stringify(not.required[0])}?: never })`;
  }
  if (!schema.$ref && schema.const === undefined && !schema.enum && !schema.type && !schema.properties &&
      schema.additionalProperties === undefined && !schema.oneOf && !schema.anyOf && !schema.allOf) return 'unknown';
  // Required-only alternatives inherit the parent's field definitions.
  // Preserve both the native document/batch XOR and single/composite indexes.
  const excludedFields = branch => {
    if (!branch.not) return [];
    if (Object.keys(branch.not).length !== 1) return undefined;
    if (branch.not.required?.length === 1) return branch.not.required;
    if (branch.not.anyOf?.every(item => Object.keys(item).length === 1 && item.required?.length === 1)) {
      return branch.not.anyOf.flatMap(item => item.required);
    }
    return undefined;
  };
  if (schema.type === 'object' && schema.properties && Array.isArray(schema.oneOf) &&
      schema.oneOf.every(branch => Array.isArray(branch.required) &&
        Object.keys(branch).every(key => key === 'required' || key === 'not') && excludedFields(branch) !== undefined)) {
    const own = { ...schema };
    delete own.oneOf;
    const alternatives = schema.oneOf.map(branch => {
      const shape = typeFor({ ...own, required: [...new Set([...(own.required || []), ...branch.required])] });
      const excluded = excludedFields(branch);
      return `(${shape}${excluded.length ? ` & { ${excluded.map(name => `${JSON.stringify(name)}?: never`).join('; ')} }` : ''})`;
    });
    return `(${union(alternatives)}${schema.nullable === true ? ' | null' : ''})`;
  }
  const composed = [];
  const hasOwnShape = schema.$ref || schema.const !== undefined || schema.enum || schema.type || schema.properties || schema.additionalProperties !== undefined;
  if (hasOwnShape && (schema.oneOf || schema.anyOf || schema.allOf)) {
    const own = { ...schema };
    delete own.oneOf;
    delete own.anyOf;
    delete own.allOf;
    delete own.nullable;
    composed.push(typeFor(own, true));
  }
  if (Array.isArray(schema.allOf)) composed.push(...schema.allOf.map(item => typeFor(item, true)));
  if (Array.isArray(schema.oneOf)) {
    const closedObjects = schema.oneOf.every(item => item.additionalProperties === false && item.properties);
    const keys = closedObjects ? [...new Set(schema.oneOf.flatMap(item => Object.keys(item.properties)))] : [];
    composed.push(`(${union(schema.oneOf.map(item => {
      const excluded = keys.filter(key => !Object.hasOwn(item.properties, key));
      const shape = typeFor(item, true);
      return excluded.length ? `(${shape} & { ${excluded.map(key => `${JSON.stringify(key)}?: never`).join('; ')} })` : shape;
    }))})`);
  }
  if (Array.isArray(schema.anyOf)) composed.push(`(${union(schema.anyOf.map(item => typeFor(item, true)))})`);
  if (composed.length) {
    let combined = composed.join(' & ');
    if (schema.nullable === true) combined = `${combined} | null`;
    return nested ? `(${combined})` : combined;
  }
  let result;
  const reference = refName(schema.$ref);
  if (reference) result = reference;
  else if (schema.const !== undefined) result = literal(schema.const);
  else if (Array.isArray(schema.enum)) result = union(schema.enum.map(literal));
  else if (Array.isArray(schema.type)) result = union(schema.type.map(type => typeFor({ ...schema, type }, true)));
  else if (schema.type === 'string') result = 'string';
  else if (schema.type === 'integer') result = schema.format === 'int64' ? 'UnsV2Int64' : 'UnsV2Integer';
  else if (schema.type === 'number') result = 'UnsV2Number';
  else if (schema.type === 'boolean') result = 'boolean';
  else if (schema.type === 'null') result = 'null';
  else if (schema.type === 'array') result = `Array<${typeFor(schema.items, true)}>`;
  else if (schema.type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    const required = new Set(schema.required || []);
    const properties = Object.entries(schema.properties || {}).map(([name, property]) =>
      `  ${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${typeFor(property, true)};`);
    let object = properties.length ? `{\n${properties.join('\n')}\n}` : '{}';
    if (schema.additionalProperties === true) object = properties.length ? `${object} & Record<string, UnsV2JSONValue>` : 'Record<string, UnsV2JSONValue>';
    else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      object = `${object} & Record<string, ${typeFor(schema.additionalProperties, true)}>`;
    }
    result = object;
  } else result = 'UnsV2JSONValue';
  if (schema.nullable === true && !result.split(' | ').includes('null')) result = `${result} | null`;
  return nested && (result.includes('\n') || result.includes(' & ')) ? `(${result})` : result;
}

function codecFor(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const reference = refName(schema.$ref);
  if (reference) return { r: reference };
  if (schema.format === 'int64') return { k: 'i' };
  if (schema.type === 'integer') return { k: 'j' };
  if (schema.type === 'number') return { k: 'n' };
  if (schema.type === 'array') return { k: 'a', ...(schema.items ? { i: codecFor(schema.items) || {} } : {}) };
  const branches = [...(schema.allOf || []), ...(schema.oneOf || []), ...(schema.anyOf || [])];
  if (branches.length) {
    const own = { ...schema };
    delete own.allOf; delete own.oneOf; delete own.anyOf;
    const alternatives = [codecFor(own), ...branches.map(codecFor)].filter(Boolean);
    if (alternatives.length) return { k: 'u', a: alternatives };
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    const properties = Object.fromEntries(Object.entries(schema.properties || {})
      .map(([name, value]) => [name, codecFor(value)])
      .filter(([, value]) => value));
    const additional = schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? codecFor(schema.additionalProperties) : undefined;
    return { k: 'o', ...(Object.keys(properties).length ? { p: properties } : {}), ...(additional ? { x: additional } : {}) };
  }
  return undefined;
}

const schemaTypes = Object.entries(exportedSchemas).map(([name, schema]) =>
  `export type ${name} = ${typeFor(schema)};`).join('\n\n');
const operationRows = publicOperations.map(operation =>
  `  ${JSON.stringify(operation.name)}: { path: ${JSON.stringify(`/openapi/v2${operation.path}`)}, pathParams: ${JSON.stringify(operation.pathParams || [])}, request: ${JSON.stringify(requestType(operation))}, response: ${JSON.stringify(responseType(operation))}, method: ${JSON.stringify(operation.method)}, transport: ${JSON.stringify(operation.transport || 'json')}, mutation: ${JSON.stringify(!operation.readOnly)}, appAllowed: ${JSON.stringify(operation.appAllowed)}, scope: ${JSON.stringify(operation.scope)} },`).join('\n');
const operationTypes = publicOperations.map(operation =>
  `  ${JSON.stringify(operation.name)}: { request: ${operation.transport === 'sse' ? 'RecordSubscribeRequest' : requestType(operation)}; response: ${operation.transport === 'sse' ? 'RecordSubscribeFrame' : responseType(operation)} };`).join('\n');
const operationMethods = publicOperations.map(operation => operation.transport === 'sse'
  ? `  ${operation.name}(request?: RecordSubscribeRequest, options?: { signal?: AbortSignal }): AsyncIterable<RecordSubscribeFrame>;`
  : `  ${operation.name}(request: ${requestType(operation)}): Promise<${responseType(operation)}>;`).join('\n');
const codecSchemas = Object.fromEntries(Object.entries(exportedSchemas).map(([name, schema]) => [name, codecFor(schema) || {}]));
const hashes = Object.fromEntries(Object.entries(inputs).map(([name, path]) => [name, hash(read(path))]));

const generated = `// Generated by scripts/generate-uns-v2.mjs from the frozen Backend contract. DO NOT EDIT.\n` +
`import type { UnsV2RawNumber } from './codec.js';\n` +
`import type { RecordSubscribeRequest, RecordSubscribeFrame } from './subscribe.js';\n\n` +
`/** Signed int64: safe values use number, larger exact values use bigint. */\n` +
`export type UnsV2Int64 = number | bigint;\n` +
`/** JSON integer outside int64 fields: unsafe values use an exact raw-number wrapper. */\n` +
`export type UnsV2Integer = number | UnsV2RawNumber;\n` +
`/** JSON number: values that cannot round-trip through number use an exact raw-number wrapper. */\n` +
`export type UnsV2Number = number | UnsV2RawNumber;\n` +
`export type UnsV2JSONValue = null | boolean | number | string | UnsV2RawNumber | UnsV2JSONValue[] | { [key: string]: UnsV2JSONValue };\n\n` +
`${schemaTypes}\n\n` +
`export const UNS_V2_OPERATIONS = {\n${operationRows}\n} as const;\n\n` +
`export interface UnsV2OperationMap {\n${operationTypes}\n}\n\n` +
`export interface UnsV2Operations {\n${operationMethods}\n}\n\n` +
`export type UnsV2OperationName = keyof UnsV2OperationMap;\n` +
`export type UnsV2Request<Name extends UnsV2OperationName> = UnsV2OperationMap[Name]['request'];\n` +
`export type UnsV2Response<Name extends UnsV2OperationName> = UnsV2OperationMap[Name]['response'];\n\n` +
`export const UNS_V2_CODEC_SCHEMAS = ${JSON.stringify(codecSchemas)} as const;\n\n` +
`export const UNS_V2_CONTRACT_PROVENANCE = ${JSON.stringify({ ...provenance, hashes, publicOperationCount: publicOperations.length, manifestOperationCount: manifest.operations.length }, null, 2)} as const;\n`;

const outputPath = resolve(root, output);
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== generated) fail(`${output} is stale; run npm run generate:uns-v2`);
  console.log(`Verified UNS v2 ${contract.version}: ${publicOperations.length} public operations, ${Object.keys(exportedSchemas).length} exported schemas.`);
} else {
  writeFileSync(outputPath, generated);
  console.log(`Generated UNS v2 ${contract.version}: ${publicOperations.length} public operations, ${Object.keys(exportedSchemas).length} exported schemas.`);
}
