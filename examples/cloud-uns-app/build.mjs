import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, '.runtime');
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'node_modules', '@tier0'), { recursive: true });
cpSync(join(root, 'vendor', 'sdk'), join(output, 'node_modules', '@tier0', 'sdk'), { recursive: true });
cpSync(join(root, 'vendor', 'runtime-dependencies'), join(output, 'node_modules'), { recursive: true });
cpSync(join(root, 'server.mjs'), join(output, 'server.mjs'));
cpSync(join(root, 'public'), join(output, 'public'), { recursive: true });
