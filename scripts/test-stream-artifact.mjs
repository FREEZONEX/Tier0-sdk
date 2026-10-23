import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';

// Actual offline source pack; no npm install, workspace resolution or broker mock.
// Native fixture uses production Go issuer with fixed authority, not SYS/GW E2E.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(process.env.TIER0_STREAM_MESSAGES_FIXTURE_URL, 'Run through test:streams:artifact');
const directory = await mkdtemp(join(tmpdir(), 'tier0-sdk-stream-artifact-'));
const runtimeKey = Symbol.for('tier0.sdk.app-runtime.v1');
try {
  const archive = join(directory, 'app.zip');
  execFileSync(process.execPath, [join(root, 'scripts/package-cloud-uns-app.mjs'), archive]);
  const app = join(directory, 'app');
  await mkdir(app);
  execFileSync('python3', ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, app]);
  execFileSync(process.execPath, ['build.mjs'], { cwd: app });
  const runtime = join(app, '.runtime');
  const require = createRequire(join(runtime, 'probe.cjs'));
  const esm = await import(pathToFileURL(join(runtime, 'node_modules/@tier0/sdk/lib/cloud.js')).href);
  const cjs = require('@tier0/sdk/cloud');
  globalThis[runtimeKey] = {
    appId: process.env.TIER0_STREAM_MESSAGES_FIXTURE_APP_ID,
    request(path, body, { signal }) {
      return fetch(new URL(path, process.env.TIER0_STREAM_MESSAGES_FIXTURE_URL), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      });
    },
  };
  for (const [format, sdk] of [['ESM', esm], ['CJS', cjs]]) {
    const client = sdk.createClient();
    const errors = [];
    const off = client.streams.messages.onError(error => errors.push(error));
    let subscription;
    let timer;
    try {
      assert.equal(typeof client.unsV2.recordFind, 'function');
      assert.equal(client.controls, undefined);
      const message = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${format} packaged native publish timeout`)), 5000);
        subscription = client.streams.messages.use({ topic: process.env.TIER0_STREAM_MESSAGES_FIXTURE_TOPIC })
          .subscribe(resolve);
      });
      const handle = await subscription;
      subscription = handle;
      await client.streams.messages.use({ topic: process.env.TIER0_STREAM_MESSAGES_FIXTURE_TOPIC }).publish({ format });
      assert.deepEqual((await message).payload, { format });
      assert.deepEqual(errors, []);
      console.log(`PASS: offline ${format} SDK native TLS NATS delivery and disposal`);
    } finally {
      clearTimeout(timer);
      try { await (await subscription)?.dispose(); } finally { off(); await client.dispose(); }
    }
  }
  if (process.env.TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL) {
    let stats;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(new URL('/__fixture/stats', process.env.TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL), { signal: AbortSignal.timeout(3000) });
      assert.equal(response.ok, true);
      stats = await response.json();
      if (!stats.connections && !stats.subscriptions) break;
      await delay(20);
    }
    assert.equal(stats.connections, 0);
    assert.equal(stats.subscriptions, 0);
    console.log('PASS: native broker reports zero packaged-client connections/subscriptions after disposal');
  }
  // Bundle an actual public import with browser resolution, including lazy NATS
  // chunks. Resolution is rooted in the extracted offline artifact.
  const entry = join(runtime, 'browser.mjs');
  await writeFile(entry, "export { createClient } from '@tier0/sdk/cloud';\n");
  const result = await build({
    root: runtime, configFile: false, logLevel: 'error',
    build: { write: false, minify: false, target: 'es2022',
      rollupOptions: { input: entry, preserveEntrySignatures: 'strict',
        onwarn(warning) { throw new Error(warning.message); } } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const chunks = outputs.filter(item => item.type === 'chunk');
  const names = new Set(chunks.map(chunk => chunk.fileName));
  assert.ok(chunks.some(chunk => Object.keys(chunk.modules).some(name => name.includes('@nats-io/nats-core'))));
  for (const chunk of chunks) for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
    assert.ok(names.has(dependency), `Unbundled browser dependency: ${dependency}`);
  }
  console.log('PASS: offline browser SDK bundles complete native NATS dependency closure (build check, not browser E2E)');
} finally {
  delete globalThis[runtimeKey];
  await rm(directory, { recursive: true, force: true });
}
