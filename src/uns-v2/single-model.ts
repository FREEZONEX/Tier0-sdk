import { CURRENT_MODEL_SELECTORS } from './source-stream-model.generated.js';

type Document = Record<string, unknown>;
const object = (value: unknown): value is Document => value !== null && typeof value === 'object' && !Array.isArray(value);

function rejectSelectors(value: unknown): void {
  if (object(value) && CURRENT_MODEL_SELECTORS.some(key => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError('Tier0 SDK: Source/Stream model selectors are not accepted; migrate stored documents offline.');
  }
}

/** 只检查模型位置；业务 input、Schema、采集参数及只读历史不做递归转换。 */
export function assertCurrentSourceStreamRequest(operation: string, request: unknown): void {
  if (!/^(source|stream)/.test(operation) || !object(request)) return;
  const inspect = (value: unknown) => {
    if (!object(value)) return;
    rejectSelectors(value);
    if (operation.startsWith('source')) rejectSelectors(value.config);
    else rejectSelectors(value.script);
  };
  const item = (value: unknown) => {
    if (!object(value)) return;
    inspect(value);
    inspect(value.document);
    inspect(value.patch);
    inspect(value.program);
    inspect(value.definition);
  };
  item(request);
  if (Array.isArray(request.items)) request.items.forEach(item);
}
