import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Requires Go, nats-server, Node >=22 and a backend checkout containing the real
// share/streammessages issuer. No backend files or module dependencies are changed.
// --serve provisions only; SIGINT/SIGTERM stops the broker and removes TLS files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serve = process.argv.includes('--serve');
let fixture;
let active;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  active?.kill('SIGTERM');
  fixture?.kill('SIGTERM');
});

function run(command, args, options = {}) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    active = child;
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.once('error', error => { clearTimeout(timer); active = undefined; no(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); active = undefined;
      if (code === 0) yes();
      else no(new Error(`${command} failed (${signal ?? code})`));
    });
  });
}

async function backendDirectory() {
  const paths = process.env.TIER0_STREAM_MESSAGES_BACKEND_DIR
    ? [resolve(process.env.TIER0_STREAM_MESSAGES_BACKEND_DIR)]
    : [resolve(root, '../backend-app-stream-interactions'), resolve(root, '../backend')];
  for (const path of paths) {
    try { await access(join(path, 'share/streammessages/issuer.go')); return path; } catch {}
  }
  throw new Error('Set TIER0_STREAM_MESSAGES_BACKEND_DIR to the backend checkout containing share/streammessages/issuer.go.');
}

async function waitReady(directory) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !interrupted) {
    if (fixture.exitCode !== null) throw new Error('Native NATS fixture exited before readiness.');
    try { return JSON.parse(await readFile(join(directory, 'ready.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await delay(25);
  }
  throw new Error('Native NATS fixture readiness deadline exceeded.');
}

async function stopFixture() {
  if (!fixture || fixture.exitCode !== null) return;
  const stopped = new Promise(resolve => fixture.once('exit', resolve));
  fixture.kill('SIGTERM');
  const timer = setTimeout(() => fixture.kill('SIGKILL'), 5_000);
  await stopped;
  clearTimeout(timer);
}

const directory = await mkdtemp(join(tmpdir(), 'tier0-sdk-nats-'));
try {
  let env = { ...process.env };
  if (!env.TIER0_STREAM_MESSAGES_FIXTURE_URL) {
    const backend = await backendDirectory();
    console.log(`Building fixture with production issuer from ${backend}`);
    const binary = join(directory, 'fixture');
    await run('go', ['build', '-mod=readonly', '-o', binary, join(root, 'tests/fixtures/stream-messages/main.go')], { cwd: backend });
    if (interrupted) throw new Error('Interrupted.');
    fixture = spawn(binary, ['-dir', directory, '-nats-server', env.TIER0_NATS_SERVER ?? 'nats-server'], { stdio: 'inherit' });
    let spawnError;
    fixture.once('error', error => { spawnError = error; });
    const ready = await waitReady(directory);
    if (spawnError) throw spawnError;
    const caPath = join(directory, 'trusted-ca.pem');
    const existingCA = env.NODE_EXTRA_CA_CERTS ? await readFile(env.NODE_EXTRA_CA_CERTS, 'utf8') : '';
    await writeFile(caPath, `${existingCA}\n${await readFile(ready.caPath, 'utf8')}`, { mode: 0o600 });
    env = {
      ...env, NODE_EXTRA_CA_CERTS: caPath,
      TIER0_STREAM_MESSAGES_FIXTURE_URL: ready.url,
      TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL: ready.controlUrl,
      TIER0_STREAM_MESSAGES_FIXTURE_APP_ID: ready.appId,
      TIER0_STREAM_MESSAGES_FIXTURE_TOPIC: ready.topic,
    };
    console.log(`Native TLS NATS ready; production Go issuer TTL ${ready.ttlMs} ms; fixture ${ready.url}`);
  }
  if (serve) {
    for (const key of ['TIER0_STREAM_MESSAGES_FIXTURE_URL', 'TIER0_STREAM_MESSAGES_FIXTURE_CONTROL_URL',
      'TIER0_STREAM_MESSAGES_FIXTURE_APP_ID', 'TIER0_STREAM_MESSAGES_FIXTURE_TOPIC', 'NODE_EXTRA_CA_CERTS']) {
      if (env[key]) console.log(`${key}=${env[key]}`);
    }
    if (!fixture) throw new Error('--serve requires local provisioning, not an existing fixture URL.');
    await new Promise(resolve => fixture.once('exit', resolve));
  } else {
    await run(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/stream-messages.integration.test.ts'], { env });
    if (process.argv.includes('--artifact')) await run(process.execPath, [join(root, 'scripts/test-stream-artifact.mjs')], { env });
  }
} catch (error) {
  console.error(error.message);
  try { console.error((await readFile(join(directory, 'broker.log'), 'utf8')).split('\n').slice(-30).join('\n')); } catch {}
  process.exitCode = 1;
} finally {
  await stopFixture();
  await rm(directory, { recursive: true, force: true });
}
