import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const source = JSON.parse(readFileSync(join(root, 'contracts/openapi/app-members.swagger.json'), 'utf8'));
function prepare(overlay = source) {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-app-members-')); directories.push(dir);
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(root, 'scripts/generate-openapi.ts'), join(dir, 'scripts/generate-openapi.ts'));
  const baseline = { paths: {
    '/openapi/v1/flow/list': { post: { operationId: 'postOpenapiV1FlowList' } },
    '/openapi/v1/launchpad/{projectName}/getMembers': { post: { operationId: 'postOldMembers' } },
  }, components: { schemas: {} } };
  writeFileSync(join(dir, 'base.json'), JSON.stringify(baseline));
  writeFileSync(join(dir, 'app.json'), JSON.stringify(overlay));
  const args = [join(root, 'node_modules/tsx/dist/cli.mjs'), join(dir, 'scripts/generate-openapi.ts'),
    '--swagger', join(dir, 'base.json'), '--app-members-swagger', join(dir, 'app.json'), '--output', join(dir, 'out')];
  return { dir, args };
}
describe('scoped formal App-members generation', () => {
  it('pins the formal Cloud source separately from retained unrelated legacy SDK routes', () => {
    const provenance = JSON.parse(readFileSync(join(root, 'contracts/openapi/app-members-provenance.json'), 'utf8'));
    expect(provenance.revision).toBe('6c111671a2172eb14c38f2f6d9ec329f4ee08a3d');
    expect(provenance.sourceSHA256).toBe('59e09129666b52a71abec7ee38ed0d224c128f51026efbbcee45d3051460f4b9');
    expect(provenance.appMembersSwaggerSHA256).toBe(createHash('sha256').update(readFileSync(join(root, 'contracts/openapi/app-members.swagger.json'))).digest('hex'));
    expect(Object.keys(source.paths)).toEqual(['/openapi/v1/apps/access-members/list']);
  });
  it('imports the formal App-only route/schema closure and keeps unrelated legacy operations', () => {
    const { dir, args } = prepare(); execFileSync(process.execPath, args);
    const filtered = JSON.parse(readFileSync(join(dir, 'scripts/swagger.filtered.json'), 'utf8'));
    const route = '/openapi/v1/apps/access-members/list';
    expect(filtered.paths[route]).toEqual(source.paths[route]);
    expect(filtered.paths).toHaveProperty('/openapi/v1/flow/list');
    expect(filtered.paths).not.toHaveProperty('/openapi/v1/launchpad/{projectName}/getMembers');
    expect(filtered.components.schemas).toEqual(source.components.schemas);
    const api = readFileSync(join(dir, 'out/api.ts'), 'utf8');
    expect(api).toContain('appsApi'); expect(api).toContain('flowApi'); expect(api).not.toContain('launchpadApi');
    expect(api).toContain('AppAccessMembersListReq');
  });
  it('fails closed if the formal App-members route is absent', () => {
    const { args } = prepare({ paths: {}, components: { schemas: {} } });
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('App access-members source route missing');
  });
  it('refuses to overwrite an unrelated retained schema with different fields', () => {
    const { dir, args } = prepare();
    const baseline = JSON.parse(readFileSync(join(dir, 'base.json'), 'utf8'));
    baseline.components.schemas.AppAccessMemberResp = { type: 'string' };
    writeFileSync(join(dir, 'base.json'), JSON.stringify(baseline));
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('schema conflicts with retained SDK');
  });
  it('fails closed for a missing referenced formal schema', () => {
    const overlay = structuredClone(source); delete overlay.components.schemas.AppAccessMemberResp;
    const { args } = prepare(overlay); const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('App access-members source schema missing');
  });
});
