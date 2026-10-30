import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootSkillUrl = new URL('../skills/tier0-sdk/SKILL.md', import.meta.url);
const filesSkillUrl = new URL('../skills/tier0-sdk/tier0-sdk-files/SKILL.md', import.meta.url);
const historyReferenceUrl = new URL(
  '../skills/tier0-sdk/tier0-sdk-uns/references/history.md',
  import.meta.url,
);
const monoAppReferenceUrl = new URL(
  '../skills/tier0-sdk/references/scaffold-monoapp.md',
  import.meta.url,
);
const packageUrl = new URL('../package.json', import.meta.url);

function rootDescription(): string {
  const skill = readFileSync(rootSkillUrl, 'utf8');
  const match = skill.match(/^description:\s*["'](.+)["']\s*$/m);
  if (!match) throw new Error('Root Skill description is missing or is not a single quoted line');
  return match[1];
}

describe('single-root Skill routing', () => {
  it('documents probe retirement without reintroducing a readiness call in README or Skill examples', () => {
    const reference = readFileSync(new URL('../skills/tier0-sdk/references/openapi.md', import.meta.url), 'utf8');
    expect(reference).toContain('unsV2.streamRuntimeCapabilitiesGet');
    expect(reference).toContain('is retired');
    expect(reference).toContain('../tier0-sdk-system/references/info.md');
    const visit = (directory: URL): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
        if (entry.isDirectory()) {
          if (!['node_modules', 'dist', '.git'].includes(entry.name)) visit(file);
        } else if (/\.(md|mdx|markdown)$/i.test(entry.name)) {
          for (const block of readFileSync(file, 'utf8').matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
            expect(block[1], file.pathname).not.toMatch(/streamRuntimeCapabilitiesGet\s*\(|stream\.runtime\.capabilities\s*\(/);
          }
        }
      }
    };
    visit(new URL('../skills/', import.meta.url));
    visit(new URL('../examples/', import.meta.url));
    for (const entry of readdirSync(new URL('../', import.meta.url))) {
      if (!/^readme(?:[.-].*)?$/i.test(entry)) continue;
      const file = new URL('../' + entry, import.meta.url);
      for (const block of readFileSync(file, 'utf8').matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
        expect(block[1], entry).not.toMatch(/streamRuntimeCapabilitiesGet\s*\(|stream\.runtime\.capabilities\s*\(/);
      }
    }
  });

  it('exposes common file intents before the root Skill is loaded', () => {
    const description = rootDescription();

    for (const intent of [
      /上传|upload/i,
      /附件|attachment/i,
      /头像|avatar/i,
      /导入|import/i,
      /生成|generated/i,
      /导出|export/i,
      /持久化|persist/i,
      /下载|download/i,
      /删除|delet/i,
    ]) {
      expect(description).toMatch(intent);
    }

    expect(description).toContain('tier0-sdk-files');
    expect(description).toContain('@tier0/sdk/files');
  });

  it('ships the root and nested Files Skill through the declared bundle layout', () => {
    const manifest = JSON.parse(readFileSync(packageUrl, 'utf8')) as {
      files: string[];
      agents: { skills: Array<{ name: string; path: string }> };
    };

    expect(existsSync(rootSkillUrl)).toBe(true);
    expect(existsSync(filesSkillUrl)).toBe(true);
    expect(manifest.files).toContain('skills/tier0-sdk/**');
    expect(manifest.agents.skills).toContainEqual({
      name: 'tier0-sdk-files',
      path: './skills/tier0-sdk/tier0-sdk-files',
    });
  });

  it('routes generated App history views to server-side UNS history guidance', () => {
    const description = rootDescription();
    const rootSkill = readFileSync(rootSkillUrl, 'utf8');
    const historyReference = readFileSync(historyReferenceUrl, 'utf8');
    const monoAppReference = readFileSync(monoAppReferenceUrl, 'utf8');

    expect(description).toMatch(/历史数据|history/i);
    expect(description).toMatch(/趋势图|trend/i);
    expect(rootSkill).toContain('tier0-sdk-uns/references/history.md');
    expect(historyReference).toContain('unsV2.sampleFind');
    expect(historyReference).toContain('from: rangeStartMs');
    expect(historyReference).toContain('pageInfo/cursor');
    expect(monoAppReference).toContain('../tier0-sdk-uns/references/history.md');
    expect(monoAppReference).toContain('sampleFind is for bounded time-range queries');
  });
});
