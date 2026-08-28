import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootSkillUrl = new URL('../skills/tier0-sdk/SKILL.md', import.meta.url);
const filesSkillUrl = new URL('../skills/tier0-sdk/tier0-sdk-files/SKILL.md', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

function rootDescription(): string {
  const skill = readFileSync(rootSkillUrl, 'utf8');
  const match = skill.match(/^description:\s*["'](.+)["']\s*$/m);
  if (!match) throw new Error('Root Skill description is missing or is not a single quoted line');
  return match[1];
}

describe('single-root Skill routing', () => {
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
});
