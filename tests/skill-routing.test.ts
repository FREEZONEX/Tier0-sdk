import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootSkillUrl = new URL('../skills/tier0-sdk/SKILL.md', import.meta.url);
const filesSkillUrl = new URL('../skills/tier0-sdk/tier0-sdk-files/SKILL.md', import.meta.url);
const unsSkillUrl = new URL('../skills/tier0-sdk/tier0-sdk-uns/SKILL.md', import.meta.url);
const flowSkillUrl = new URL('../skills/tier0-sdk/tier0-sdk-flow/SKILL.md', import.meta.url);
const statisticsReferenceUrl = new URL(
  '../skills/tier0-sdk/references/app-statistics-design.md',
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

  it('routes statistics requirements inside an App to reusable UNS and Flow guidance', () => {
    const description = rootDescription();
    const rootSkill = readFileSync(rootSkillUrl, 'utf8');
    const unsSkill = readFileSync(unsSkillUrl, 'utf8');
    const flowSkill = readFileSync(flowSkillUrl, 'utf8');
    const statisticsReference = readFileSync(statisticsReferenceUrl, 'utf8');

    for (const intent of [
      /统计|statistic/i,
      /Dashboard/i,
      /Trend/i,
      /范围分布|scope distribution/i,
      /同比|period comparison/i,
      /多维统计|multi-dimensional/i,
    ]) {
      expect(description).toMatch(intent);
    }

    expect(existsSync(statisticsReferenceUrl)).toBe(true);
    expect(rootSkill).toContain('references/app-statistics-design.md');
    expect(unsSkill).toContain('../references/app-statistics-design.md');
    expect(flowSkill).toContain('../references/app-statistics-design.md');

    for (const requiredGuidance of [
      'App 中涉及统计需求时的设计',
      '示例 1：范围 Dashboard 与当前周期总览',
      '示例 2：电、水、热用量趋势',
      '示例 3：范围分布',
      '示例 4：多维分析',
      '示例 5：同比、环比和连续周期比较',
      '/_Statistics/',
      'Source Flow',
      'getTier0UnsApi',
      "countMode: 'none'",
      '一次页面级 bundle 请求',
    ]) {
      expect(statisticsReference).toContain(requiredGuidance);
    }

    expect(statisticsReference).not.toMatch(/SmartMeter|SmartCity|Ras_Tanura|\b602\b|\b202\b/);
  });
});
