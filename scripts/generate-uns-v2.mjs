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
const contractOperations = new Map(contract.operations.map(operation => [operation.name, operation]));
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
    for (const key of ['request', 'response']) {
      const expected = source[key] || (key === 'response' ? 'UnsV2Envelope' : undefined);
      if (operation[key] !== expected) fail(`${operation.name}.${key} differs from contract.json`);
    }
  }
  if ((source && operation.path !== source.suffix) || !operation.path?.startsWith('/uns/') ||
      operation.method !== 'POST' || operation.supported !== true) {
    fail(`${operation.name} has an unsupported route contract`);
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

const publicOperations = manifest.operations.filter(operation => !operation.coreOnly);
const refName = ref => ref?.startsWith('#/components/schemas/') ? ref.slice('#/components/schemas/'.length) : undefined;
const requestType = operation => refName(operation.requestSchema?.$ref) || operation.request;
const responseType = operation => refName(operation.responseSchema?.$ref) || operation.response;
const literal = value => JSON.stringify(value);
const union = values => [...new Set(values.filter(Boolean))].join(' | ') || 'never';

function typeFor(schema, nested = false) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return 'UnsV2JSONValue';
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
  if (Array.isArray(schema.oneOf)) composed.push(`(${union(schema.oneOf.map(item => typeFor(item, true)))})`);
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
  if (Array.isArray(schema.allOf)) return { k: 'u', a: schema.allOf.map(codecFor).filter(Boolean) };
  if (Array.isArray(schema.oneOf)) return { k: 'u', a: schema.oneOf.map(codecFor).filter(Boolean) };
  if (Array.isArray(schema.anyOf)) return { k: 'u', a: schema.anyOf.map(codecFor).filter(Boolean) };
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

const schemaTypes = Object.entries(manifest.schemas).map(([name, schema]) =>
  `export type ${name} = ${typeFor(schema)};`).join('\n\n');
const operationRows = publicOperations.map(operation =>
  `  ${JSON.stringify(operation.name)}: { path: ${JSON.stringify(`/openapi/v2${operation.path}`)}, request: ${JSON.stringify(requestType(operation))}, response: ${JSON.stringify(responseType(operation))}, mutation: ${JSON.stringify(Boolean(operation.mutation))}, scope: ${JSON.stringify(operation.scope)} },`).join('\n');
const operationTypes = publicOperations.map(operation =>
  `  ${JSON.stringify(operation.name)}: { request: ${requestType(operation)}; response: ${responseType(operation)} };`).join('\n');
const operationMethods = publicOperations.map(operation =>
  `  ${operation.name}(request: ${requestType(operation)}): Promise<${responseType(operation)}>;`).join('\n');
const codecSchemas = Object.fromEntries(Object.entries(manifest.schemas).map(([name, schema]) => [name, codecFor(schema) || {}]));
const hashes = Object.fromEntries(Object.entries(inputs).map(([name, path]) => [name, hash(read(path))]));

const generated = `// Generated by scripts/generate-uns-v2.mjs from the frozen Backend contract. DO NOT EDIT.\n` +
`import type { UnsV2RawNumber } from './codec.js';\n\n` +
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
  console.log(`Verified UNS v2 ${contract.version}: ${publicOperations.length} public operations, ${Object.keys(manifest.schemas).length} schemas.`);
} else {
  writeFileSync(outputPath, generated);
  console.log(`Generated UNS v2 ${contract.version}: ${publicOperations.length} public operations, ${Object.keys(manifest.schemas).length} schemas.`);
}
