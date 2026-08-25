import fs from 'fs';
import path from 'path';

interface SwaggerDoc {
  paths: Record<string, Record<string, any>>;
  components?: {
    schemas?: Record<string, any>;
  };
}

function loadSwagger(path: string): SwaggerDoc {
  const content = fs.readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, '_')
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('');
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function getResponseType(spec: any): string {
  const responses = spec.responses || {};
  const ok = responses['200'];
  if (!ok || !ok.content) return 'any';
  const json = ok.content['application/json'];
  if (!json || !json.schema) return 'any';
  const schema = json.schema;
  if (schema.$ref) {
    const ref = schema.$ref.split('/').pop();
    return ref ? `components["schemas"]["${ref}"]` : 'any';
  }
  if (schema.type === 'array' && schema.items) {
    if (schema.items.$ref) {
      const ref = schema.items.$ref.split('/').pop();
      return ref ? `components["schemas"]["${ref}"][]` : 'any[]';
    }
    return 'any[]';
  }
  return 'any';
}

function getRequestBodyType(spec: any): string | null {
  if (!spec.requestBody || !spec.requestBody.content) return null;
  const json = spec.requestBody.content['application/json'];
  if (!json || !json.schema) return null;
  const schema = json.schema;
  if (schema.$ref) {
    return schema.$ref.split('/').pop() || null;
  }
  return null;
}

interface PathParameter {
  name: string;
  type: string;
}

interface Operation {
  name: string;
  method: string;
  path: string;
  bodyType: string | null;
  responseType: string;
  pathParameters: PathParameter[];
}

type OperationModules = Record<string, Operation[]>;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// SDK 已纳入的端点白名单：后端 swagger 里存在但尚未接入 SDK 生成面的端点
// （assets 文件族走手写 src/files.ts、mqtt-auth、uns 附件/绑定等）明确排除，接入时逐条加入
const INCLUDED_PATHS = new Set([
  '/gw/reload',
  '/openapi/v1/auth/whoami',
  '/openapi/v1/info',
  '/openapi/v1/flow/create',
  '/openapi/v1/flow/delete',
  '/openapi/v1/flow/deploy',
  '/openapi/v1/flow/flowdata',
  '/openapi/v1/flow/get',
  '/openapi/v1/flow/list',
  '/openapi/v1/flow/nodes',
  '/openapi/v1/flow/update',
  '/openapi/v1/uns/browse',
  '/openapi/v1/uns/create',
  '/openapi/v1/uns/delete',
  '/openapi/v1/uns/history',
  '/openapi/v1/uns/read',
  '/openapi/v1/uns/restore',
  '/openapi/v1/uns/search',
  '/openapi/v1/uns/update',
  '/openapi/v1/uns/write',
  '/openapi/v1/launchpad/{projectName}/getMembers',
  '/openapi/v1/platform/getMembers',
  '/openapi/v1/notifications/send',
  '/openapi/v1/notifications/get',
]);

// 收集一个 JSON 子树里全部 $ref 指向的 schema 名
function collectRefs(node: any, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') {
    const name = node.$ref.split('/').pop();
    if (name) into.add(name);
  }
  for (const value of Object.values(node)) collectRefs(value, into);
}

// 按白名单过滤路径，并把 schema 裁剪到被保留路径传递引用的闭包
function filterSwagger(swagger: SwaggerDoc): SwaggerDoc {
  const paths = Object.fromEntries(
    Object.entries(swagger.paths || {}).filter(([p]) => INCLUDED_PATHS.has(p))
  );

  const allSchemas = swagger.components?.schemas || {};
  const kept = new Set<string>();
  collectRefs(paths, kept);
  let previousSize = 0;
  while (kept.size !== previousSize) {
    previousSize = kept.size;
    for (const name of [...kept]) collectRefs(allSchemas[name], kept);
  }
  const schemas = Object.fromEntries(
    Object.entries(allSchemas).filter(([name]) => kept.has(name))
  );

  return { ...swagger, paths, components: { ...swagger.components, schemas } };
}

function getModuleName(pathStr: string): string {
  if (pathStr.includes('/flow/')) return 'flow';
  if (pathStr.includes('/uns/')) return 'uns';
  if (pathStr.includes('/launchpad/')) return 'launchpad';
  if (pathStr.includes('/platform/')) return 'platform';
  if (pathStr.includes('/notifications/')) return 'notifications';
  if (pathStr.includes('/auth/')) return 'system';
  if (pathStr.includes('/info')) return 'system';
  if (pathStr.includes('/reload')) return 'system';
  return 'common';
}

function getParameterType(parameter: any): string {
  const schema = parameter?.schema || {};
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') {
    return `${getParameterType({ schema: schema.items })}[]`;
  }
  return 'string';
}

function getPathParameters(pathStr: string, pathItem: any, spec: any): PathParameter[] {
  const declaredParameters = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(spec.parameters) ? spec.parameters : []),
  ];
  const placeholders = Array.from(new Set(
    Array.from(pathStr.matchAll(/\{([^}]+)\}/g), match => match[1]),
  ));

  return placeholders.map(name => {
    const parameter = [...declaredParameters]
      .reverse()
      .find(item => item?.in === 'path' && item?.name === name);
    return { name, type: getParameterType(parameter) };
  });
}

function getEnvelopeResponseType(spec: any): string | null {
  const schema = spec.responses?.['200']?.content?.['application/json']?.schema;
  const dataRef = schema?.properties?.data?.$ref;
  if (!dataRef) return null;

  const ref = dataRef.split('/').pop();
  if (!ref) return null;

  return `{ code: number; msg?: string; data?: components["schemas"]["${ref}"] }`;
}

function getFunctionName(operationId: string, pathParameters: PathParameter[]): string {
  let name = operationId;
  if (name.startsWith('get')) name = name.slice(3);
  else if (name.startsWith('post')) name = name.slice(4);
  else if (name.startsWith('put')) name = name.slice(3);
  else if (name.startsWith('patch')) name = name.slice(5);
  else if (name.startsWith('delete')) name = name.slice(6);

  for (const parameter of pathParameters) {
    name = name.split(`:${parameter.name}`).join('');
  }
  return toCamelCase(name);
}

function collectOperations(swagger: SwaggerDoc): OperationModules {
  const modules: OperationModules = {};

  for (const [pathStr, pathItem] of Object.entries(swagger.paths || {})) {
    for (const [rawMethod, spec] of Object.entries(pathItem)) {
      const method = rawMethod.toLowerCase();
      if (!HTTP_METHODS.has(method) || !spec?.operationId) continue;

      const moduleName = getModuleName(pathStr);
      const pathParameters = getPathParameters(pathStr, pathItem, spec);
      const bodyType = getRequestBodyType(spec);
      const responseType = moduleName === 'launchpad' || moduleName === 'platform'
        ? getEnvelopeResponseType(spec) || getResponseType(spec)
        : getResponseType(spec);

      if (!modules[moduleName]) modules[moduleName] = [];
      modules[moduleName].push({
        name: getFunctionName(spec.operationId, pathParameters),
        method,
        path: pathStr,
        bodyType,
        responseType,
        pathParameters,
      });
    }
  }

  return modules;
}

function needsBody(operation: Operation): boolean {
  return operation.method === 'post' || operation.method === 'put' || operation.method === 'patch';
}

function getVariablesType(operation: Operation): string {
  if (operation.pathParameters.length === 0) {
    return operation.bodyType
      ? `components["schemas"]["${operation.bodyType}"]`
      : 'void';
  }

  const fields = operation.pathParameters.map(parameter => `${JSON.stringify(parameter.name)}: ${parameter.type}`);
  if (operation.bodyType) {
    fields.push(`body: components["schemas"]["${operation.bodyType}"]`);
  } else if (needsBody(operation)) {
    fields.push('body?: any');
  }
  return `{ ${fields.join('; ')} }`;
}

function getPathExpression(operation: Operation): string {
  if (operation.pathParameters.length === 0) {
    return `'${operation.path.replace(/'/g, "\\'")}'`;
  }

  const pathTemplate = operation.path
    .replace(/`/g, '\\`')
    .replace(/\{([^}]+)\}/g, (_, name) =>
      '${encodeURIComponent(String(params[' + JSON.stringify(name) + ']))}',
    );
  return '`' + pathTemplate + '`';
}

function generateClient(): string {
  return `// Auto-generated by generate-openapi.ts
// Do not edit manually
import { getEnvVar } from '../runtime-env.js';

export interface ClientConfig {
  apiHost?: string;
  apiKey?: string;
  getApiHost?: () => string | undefined;
  getApiKey?: () => string | undefined;
}

const defaultGetApiHost = () => getEnvVar('TIER0_API_HOST');
const defaultGetApiKey = () => getEnvVar('TIER0_API_KEY');

function normalizeBaseURL(host: string): string {
  const trimmed = host.trim().replace(/\\/+$/, '');
  if (/^https?:\\/\\//i.test(trimmed)) {
    return trimmed;
  }
  return \`http://\${trimmed}\`;
}

/**
 * 结构化 API 错误。后端返回非 2xx 时抛出，携带 HTTP 状态码与后端业务错误码，
 * 供调用方机读（如存储配额超限 CodeStorageQuotaExceeded）。
 * message 保持 \`HTTP <status>: <msg>\` 格式，与既有调用方兼容。
 */
export class ApiError extends Error {
  /** HTTP 状态码 */
  readonly status: number;
  /** 后端业务错误码（响应体 code 字段；解析失败时为 0） */
  readonly code: number;
  /** 后端错误消息（响应体 msg 字段；解析失败时为原始响应文本） */
  readonly msg: string;

  constructor(status: number, code: number, msg: string) {
    super(\`HTTP \${status}: \${msg}\`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.msg = msg;
  }
}

/** 从响应体解析后端 ResultVO 的 code/msg；非 JSON 或缺字段时兜底为原始文本 */
function parseErrorBody(text: string): { code: number; msg: string } {
  try {
    const body = JSON.parse(text) as { code?: unknown; msg?: unknown };
    if (body && typeof body === 'object') {
      const msg = typeof body.msg === 'string' && body.msg ? body.msg : text;
      const code = typeof body.code === 'number' ? body.code : 0;
      return { code, msg };
    }
  } catch {
    // 非 JSON 响应体，兜底原文
  }
  return { code: 0, msg: text };
}

class HttpClient {
  private config: ClientConfig;

  constructor(config: ClientConfig = {}) {
    this.config = config;
  }

  private getBaseURLInternal(): string {
    const host = this.config.apiHost || this.config.getApiHost?.() || defaultGetApiHost();
    if (!host || !host.trim()) {
      throw new Error('Tier0 SDK: apiHost is required. Set it via ClientConfig or TIER0_API_HOST environment variable.');
    }
    return normalizeBaseURL(host);
  }

  private getApiKeyInternal(): string | undefined {
    return this.config.apiKey || this.config.getApiKey?.() || defaultGetApiKey();
  }

  private async request<T>(method: string, path: string, body?: any, options?: { signal?: AbortSignal }): Promise<T> {
    const baseURL = this.getBaseURLInternal();
    const url = \`\${baseURL}\${path}\`;
    const apiKey = this.getApiKeyInternal();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      // 网关各接口认证头不一致：多数接口认 Authorization Bearer，
      // 个别接口（如 /openapi/v1/auth/whoami）只认 X-API-Key，两个都带
      headers['Authorization'] = \`Bearer \${apiKey}\`;
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      const { code, msg } = parseErrorBody(text);
      throw new ApiError(response.status, code, msg);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body: any, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(path: string, body: any, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  async patch<T>(path: string, body: any, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  async delete<T>(path: string, body?: any, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('DELETE', path, body, options);
  }

  /**
   * 获取当前客户端配置的 base URL（末尾不含斜杠）。
   * 供文件下载等需要直接操作完整 URL 的场景使用。
   */
  getBaseURL(): string {
    return this.getBaseURLInternal();
  }

  /**
   * 获取当前客户端配置的 API Key。
   * 供文件下载等需要手动构造请求头的场景使用。
   */
  getApiKey(): string | undefined {
    return this.getApiKeyInternal();
  }
}

let defaultClient = new HttpClient();

export function configureClient(config: ClientConfig): void {
  defaultClient = new HttpClient(config);
}

export function getClient(): HttpClient {
  return defaultClient;
}

export { HttpClient };
`;
}

function generateApi(swagger: SwaggerDoc): string {
  const modules = collectOperations(swagger);

  let code = `// Auto-generated by generate-openapi.ts\n// Do not edit manually\n\n`;
  code += `import { getClient } from './client.js';\n`;
  code += `import type { components } from './types.js';\n\n`;

  for (const [moduleName, fns] of Object.entries(modules)) {
    const apiName = `${moduleName}Api`;
    code += `export const ${apiName} = {\n`;

    for (const operation of fns) {
      const hasPathParameters = operation.pathParameters.length > 0;
      const args = hasPathParameters
        ? `params: ${getVariablesType(operation)}`
        : operation.bodyType
          ? `body: components["schemas"]["${operation.bodyType}"]`
          : needsBody(operation) ? 'body?: any' : '';
      const bodyArg = operation.bodyType || needsBody(operation)
        ? `, ${hasPathParameters ? 'params.body' : 'body'}`
        : '';
      code += `  ${operation.name}: (${args}) => getClient().${operation.method}<${operation.responseType}>(${getPathExpression(operation)}${bodyArg}),\n`;
    }

    code += `};\n\n`;
  }

  return code;
}

function generateReact(swagger: SwaggerDoc): string {
  const modules = collectOperations(swagger);

  let code = `// Auto-generated by generate-openapi.ts\n// Do not edit manually\n\n`;
  code += `// React hooks require @tanstack/react-query to be installed\n`;
  code += `import { useMutation } from '@tanstack/react-query';\n`;
  code += `import { ${Object.keys(modules).map(m => `${m}Api`).join(', ')} } from './api.js';\n`;
  code += `import type { components } from './types.js';\n\n`;

  for (const [moduleName, fns] of Object.entries(modules)) {
    const apiName = `${moduleName}Api`;
    for (const operation of fns) {
      const hookName = `use${toPascalCase(operation.name)}`;
      const variablesType = getVariablesType(operation);
      code += `export function ${hookName}() {\n`;
      code += `  return useMutation<${operation.responseType}, Error, ${variablesType}>({\n`;
      code += `    mutationFn: ${apiName}.${operation.name},\n`;
      code += `  });\n`;
      code += `}\n\n`;
    }
  }

  return code;
}

function generateVue(swagger: SwaggerDoc): string {
  const modules = collectOperations(swagger);

  let code = `// Auto-generated by generate-openapi.ts\n// Do not edit manually\n\n`;
  code += `// Vue composables require vue to be installed\n`;
  code += `import { ref } from 'vue';\n`;
  code += `import { ${Object.keys(modules).map(m => `${m}Api`).join(', ')} } from './api.js';\n`;
  code += `import type { components } from './types.js';\n\n`;

  for (const [moduleName, fns] of Object.entries(modules)) {
    const apiName = `${moduleName}Api`;
    for (const operation of fns) {
      const hookName = `use${toPascalCase(operation.name)}`;
      const variablesType = getVariablesType(operation);
      const hasVariables = variablesType !== 'void';
      const variableName = operation.pathParameters.length > 0 ? 'params' : 'body';
      code += `export function ${hookName}() {\n`;
      code += `  const data = ref<${operation.responseType} | null>(null);\n`;
      code += `  const loading = ref(false);\n`;
      code += `  const error = ref<Error | null>(null);\n\n`;
      if (hasVariables) {
        code += `  const execute = async (${variableName}: ${variablesType}) => {\n`;
      } else {
        code += `  const execute = async () => {\n`;
      }
      code += `    loading.value = true;\n`;
      code += `    error.value = null;\n`;
      code += `    try {\n`;
      if (hasVariables) {
        code += `      data.value = await ${apiName}.${operation.name}(${variableName});\n`;
      } else {
        code += `      data.value = await ${apiName}.${operation.name}();\n`;
      }
      code += `      return data.value;\n`;
      code += `    } catch (e) {\n`;
      code += `      error.value = e as Error;\n`;
      code += `      throw e;\n`;
      code += `    } finally {\n`;
      code += `      loading.value = false;\n`;
      code += `    }\n`;
      code += `  };\n\n`;
      code += `  return { data, loading, error, execute };\n`;
      code += `}\n\n`;
    }
  }

  return code;
}

function generateIndex(): string {
  return `// Auto-generated by generate-openapi.ts\n// Do not edit manually\n\n` +
    `export * from './client.js';\n` +
    `export * from './api.js';\n` +
    `export type { components } from './types.js';\n`;
}

function main() {
  const args = process.argv.slice(2);
  let swaggerPath = '';
  let outputDir = '';

  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--swagger') swaggerPath = args[i + 1];
    if (args[i] === '--output') outputDir = args[i + 1];
  }

  if (!swaggerPath || !outputDir) {
    console.error('Usage: tsx generate-openapi.ts --swagger <path> --output <dir>');
    process.exit(1);
  }

  const swagger = filterSwagger(loadSwagger(swaggerPath));

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 供 openapi-typescript 生成 types.ts 用的过滤后 swagger（白名单端点 + 引用闭包内的 schema），
  // 避免把未纳入 SDK 的端点类型带进发布面
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  fs.writeFileSync(path.join(scriptDir, 'swagger.filtered.json'), JSON.stringify(swagger, null, 2), 'utf-8');

  // Write generated files
  fs.writeFileSync(path.join(outputDir, 'client.ts'), generateClient(), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'api.ts'), generateApi(swagger), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'react.ts'), generateReact(swagger), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'vue.ts'), generateVue(swagger), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'index.ts'), generateIndex(), 'utf-8');

  console.log(`Generated OpenAPI SDK files in ${outputDir}`);
}

main();
