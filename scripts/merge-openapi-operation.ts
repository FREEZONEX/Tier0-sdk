import fs from 'fs';

interface SwaggerDoc {
  paths: Record<string, Record<string, any>>;
  components?: Record<string, Record<string, any>>;
  tags?: Array<{ name?: string }>;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function readJson(filePath: string): SwaggerDoc {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let basePath = '';
  let sourcePath = '';
  let outputPath = '';
  const operationIds: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--base':
        basePath = args[++i] || '';
        break;
      case '--source':
        sourcePath = args[++i] || '';
        break;
      case '--output':
        outputPath = args[++i] || '';
        break;
      case '--operation':
        operationIds.push(args[++i] || '');
        break;
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  if (!basePath || !sourcePath || !outputPath || operationIds.some(id => !id) || operationIds.length === 0) {
    throw new Error('Usage: merge-openapi-operation.ts --base <path> --source <path> --output <path> --operation <operationId>');
  }
  return { basePath, sourcePath, outputPath, operationIds };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function findOperation(swagger: SwaggerDoc, operationId: string) {
  for (const [pathName, pathItem] of Object.entries(swagger.paths || {})) {
    for (const [rawMethod, operation] of Object.entries(pathItem)) {
      const method = rawMethod.toLowerCase();
      if (HTTP_METHODS.has(method) && operation?.operationId === operationId) {
        return { pathName, method, operation, pathItem };
      }
    }
  }
  throw new Error(`Operation not found in source Swagger: ${operationId}`);
}

function copyComponentRefs(value: unknown, source: SwaggerDoc, target: SwaggerDoc, seen: Set<string>) {
  if (!value || typeof value !== 'object') return;

  const ref = (value as { $ref?: unknown }).$ref;
  if (typeof ref === 'string' && ref.startsWith('#/components/')) {
    const parts = ref.slice('#/components/'.length).split('/');
    if (parts.length === 2) {
      const [section, name] = parts;
      const key = `${section}/${name}`;
      if (!seen.has(key)) {
        const sourceValue = source.components?.[section]?.[name];
        if (sourceValue === undefined) {
          throw new Error(`Referenced component is missing from source Swagger: ${ref}`);
        }
        seen.add(key);
        target.components ||= {};
        target.components[section] ||= {};
        target.components[section][name] = clone(sourceValue);
        copyComponentRefs(sourceValue, source, target, seen);
      }
    }
  }

  for (const child of Object.values(value)) {
    copyComponentRefs(child, source, target, seen);
  }
}

function mergeTags(source: SwaggerDoc, target: SwaggerDoc, operation: any) {
  const requiredTags = new Set<string>(Array.isArray(operation.tags) ? operation.tags : []);
  if (requiredTags.size === 0 || !Array.isArray(source.tags)) return;

  const existing = new Set((target.tags || []).map(tag => tag.name).filter(Boolean));
  for (const tag of source.tags) {
    if (tag.name && requiredTags.has(tag.name) && !existing.has(tag.name)) {
      target.tags ||= [];
      target.tags.push(clone(tag));
      existing.add(tag.name);
    }
  }
}

function main() {
  const { basePath, sourcePath, outputPath, operationIds } = parseArgs();
  const merged = readJson(basePath);
  const source = readJson(sourcePath);
  const seen = new Set<string>();

  for (const operationId of operationIds) {
    const { pathName, method, operation, pathItem } = findOperation(source, operationId);
    const mergedPathItem = merged.paths[pathName] || {};
    if (Array.isArray(pathItem.parameters)) {
      mergedPathItem.parameters = clone(pathItem.parameters);
    }
    mergedPathItem[method] = clone(operation);
    merged.paths[pathName] = mergedPathItem;
    if (Array.isArray(pathItem.parameters)) {
      copyComponentRefs(pathItem.parameters, source, merged, seen);
    }
    copyComponentRefs(operation, source, merged, seen);
    mergeTags(source, merged, operation);
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
}

main();
