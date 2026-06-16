function getProcessEnvVar(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function getEnvVar(key: string): string | undefined {
  return getProcessEnvVar(key);
}
