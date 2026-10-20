import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = process.argv[2];
if (!output || !isAbsolute(output) || !output.endsWith('.zip') || existsSync(output)) {
  throw new Error('Provide a new absolute output .zip path. Run the SDK build first.');
}
if (!existsSync(join(root, 'dist/esm/cloud.js'))) throw new Error('Run npm run build first.');
const staging = mkdtempSync(join(tmpdir(), 'tier0-cloud-uns-app-'));
try {
  cpSync(join(root, 'examples/cloud-uns-app'), staging, {
    recursive: true,
    filter: (path) => !['.runtime', 'node_modules', 'vendor'].includes(basename(path)) && !basename(path).startsWith('.env'),
  });
  const sdk = join(staging, 'vendor/sdk');
  mkdirSync(sdk, { recursive: true });
  cpSync(join(root, 'dist/esm'), join(sdk, 'lib'), { recursive: true });
  cpSync(join(root, 'dist/cjs'), join(sdk, 'lib-cjs'), { recursive: true });
  // The platform strips generated directories named dist/node_modules from
  // source imports. Preserve compiled SDK source under vendor, then let the
  // offline App build prepare its runtime package through the public exports.
  const rewrite = (value) => typeof value === 'string'
    ? value.replace(/^\.\/dist\/esm\//, './lib/').replace(/^\.\/dist\/cjs\//, './lib-cjs/')
    : Array.isArray(value) ? value.map(rewrite)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(sdk, 'package.json'), `${JSON.stringify(rewrite(pkg), null, 2)}\n`);
  if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(sdk, 'LICENSE'));
  writeFileSync(join(staging, 'sdk-provenance.json'), `${JSON.stringify({
    sdkVersion: pkg.version,
    sdkCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    entryPoint: '@tier0/sdk/cloud',
  }, null, 2)}\n`);
  writeFileSync(join(staging, 'meta.json'), `${JSON.stringify({ name: 'UNS 工单数据', description: 'Cloud App SDK record access and revocation example' })}\n`);
  execFileSync('python3', ['-c', [
    'import pathlib,sys,zipfile',
    'root=pathlib.Path(sys.argv[1])',
    'with zipfile.ZipFile(sys.argv[2],"x",zipfile.ZIP_DEFLATED) as archive:',
    ' for file in sorted(root.rglob("*")):',
    '  if file.is_file(): archive.write(file,file.relative_to(root).as_posix())',
  ].join('\n'), staging, output]);
  chmodSync(output, 0o600);
  console.log(output);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
