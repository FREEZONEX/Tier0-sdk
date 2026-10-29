/** Trusted host integration; application code uses client.streams without configuration. */
export interface AppRuntime {
  readonly appId: string;
  /** Authenticated host bridge. Never expose a service key to the browser. */
  request(path: string, body: unknown, options: { signal: AbortSignal }): Promise<Response>;
}

const runtimeKey = Symbol.for('tier0.sdk.app-runtime.v1');
const cleanupKey = Symbol.for('tier0.sdk.app-runtime-cleanup.v1');
type RuntimeGlobal = typeof globalThis & {
  [runtimeKey]?: AppRuntime;
  [cleanupKey]?: Map<AppRuntime, Set<() => void>>;
};

/** Internal lifecycle registration, shared across SDK copies in the host page. */
export function onAppRuntimeDispose(runtime: AppRuntime, callback: () => void): () => void {
  const target = globalThis as RuntimeGlobal;
  const callbacks = target[cleanupKey] ??= new Map();
  const listeners = callbacks.get(runtime) ?? new Set<() => void>();
  callbacks.set(runtime, listeners);
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    if (!listeners.size) callbacks.delete(runtime);
  };
}

function disposeRuntime(runtime: AppRuntime | undefined): void {
  if (!runtime) return;
  const callbacks = (globalThis as RuntimeGlobal)[cleanupKey];
  const listeners = callbacks?.get(runtime);
  callbacks?.delete(runtime);
  if (listeners) for (const listener of listeners) listener();
}

export function getAppRuntime(): AppRuntime | undefined {
  return (globalThis as RuntimeGlobal)[runtimeKey];
}

/** Install before loading App code; disposal removes only this installation. */
export function installAppRuntime(runtime: AppRuntime): () => void {
  if (!runtime.appId?.trim() || typeof runtime.request !== 'function') {
    throw new TypeError('Tier0 SDK: invalid trusted App runtime.');
  }
  const target = globalThis as RuntimeGlobal;
  const previous = target[runtimeKey];
  target[runtimeKey] = runtime;
  if (previous !== runtime) disposeRuntime(previous);
  return () => {
    if (target[runtimeKey] === runtime) {
      delete target[runtimeKey];
      disposeRuntime(runtime);
    }
  };
}
