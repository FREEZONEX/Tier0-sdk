import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

mkdirSync(join(root, 'dist', 'cjs'), { recursive: true });
mkdirSync(join(root, 'dist', 'esm'), { recursive: true });

writeFileSync(
  join(root, 'dist', 'cjs', 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);

writeFileSync(
  join(root, 'dist', 'esm', 'package.json'),
  `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
);

writeFileSync(
  join(root, 'dist', 'esm', 'runtime-env.js'),
  `function getProcessEnvVar(key) {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch {
    // ignore
  }
  return undefined;
}

function getImportMetaEnvVar(key) {
  try {
    const env = import.meta.env;
    return env?.[key] || env?.[\`VITE_\${key}\`];
  } catch {
    // ignore
  }
  return undefined;
}

export function getEnvVar(key) {
  return getProcessEnvVar(key) || getImportMetaEnvVar(key);
}
`,
);
