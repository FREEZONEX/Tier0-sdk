import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const repositoryRoot = process.cwd();
const skillsRoot = join(repositoryRoot, 'skills');
const rootSkillName = 'tier0-sdk';
const domainSkillNames = [
  'tier0-sdk-uns',
  'tier0-sdk-mq',
  'tier0-sdk-flow',
  'tier0-sdk-files',
  'tier0-sdk-members',
  'tier0-sdk-notifications',
  'tier0-sdk-system',
];
const suiteRoot = join(repositoryRoot, 'dist', 'skill-bundles', rootSkillName);

function readPackageManifest() {
  return JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
}

function assertSkillDirectory(name) {
  const directory = join(skillsRoot, name);
  const skillFile = join(directory, 'SKILL.md');
  if (!existsSync(skillFile)) {
    throw new Error(`Missing flat Skill entrypoint: ${relative(repositoryRoot, skillFile)}`);
  }
  const frontmatterName = readFileSync(skillFile, 'utf8').match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
  if (frontmatterName !== name) {
    throw new Error(`Skill name mismatch in ${relative(repositoryRoot, skillFile)}: ${frontmatterName ?? 'missing'}`);
  }
  return directory;
}

function validateFlatManifest() {
  const expectedNames = [rootSkillName, ...domainSkillNames];
  const manifest = readPackageManifest();
  const declared = manifest.agents?.skills;
  if (!Array.isArray(declared)) throw new Error('package.json agents.skills must be an array');

  const actual = declared.map(({ name, path }) => `${name}:${path}`).sort();
  const expected = expectedNames
    .map((name) => `${name}:./skills/${name}`)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`package.json agents.skills does not match the flat Skill layout:\n${actual.join('\n')}`);
  }

  for (const name of domainSkillNames) {
    const staleNestedPath = join(skillsRoot, rootSkillName, name, 'SKILL.md');
    if (existsSync(staleNestedPath)) {
      throw new Error(`Domain Skill must be flat, not nested: ${relative(repositoryRoot, staleNestedPath)}`);
    }
  }
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function rewriteMarkdown(path, transform) {
  if (!path.endsWith('.md')) return;
  const current = readFileSync(path, 'utf8');
  const next = transform(current);
  if (next !== current) writeFileSync(path, next);
}

function rewriteSuiteLinks() {
  const rootSkillPath = join(suiteRoot, 'SKILL.md');
  rewriteMarkdown(rootSkillPath, (content) => content
    .replace(
      /^description: .*$/m,
      'description: "Tier0 SDK all-in-one compatibility bundle for TypeScript/JavaScript. Use for any @tier0/sdk task involving setup, UNS, MQTT/realtime, Flow and Node-RED, managed files, members, notifications, or system diagnostics when the host indexes only one archive-root Skill. Load this root, then read the routed bundled domain instructions."',
    )
    .replace(
      'This is the shared root Skill, independently discoverable alongside the flat `tier0-sdk-*` domain Skills. Read it before using any domain Skill.',
      'This is the generated single-root compatibility bundle for hosts that index only the archive-root `SKILL.md`. Read the routed bundled domain instructions before using a concrete capability.',
    )
    .replaceAll('](../tier0-sdk-', '](tier0-sdk-'));

  for (const path of walkFiles(join(suiteRoot, 'references'))) {
    rewriteMarkdown(path, (content) => content
      .replaceAll('](../../tier0-sdk-', '](../tier0-sdk-'));
  }

  for (const name of domainSkillNames) {
    for (const path of walkFiles(join(suiteRoot, name))) {
      rewriteMarkdown(path, (content) => content
        .replaceAll('](../tier0-sdk/SKILL.md)', '](../SKILL.md)')
        .replaceAll('](../../tier0-sdk/SKILL.md)', '](../../SKILL.md)')
        .replaceAll('](../tier0-sdk/references/', '](../references/')
        .replaceAll('](../../tier0-sdk/references/', '](../../references/'));
    }
  }
}

function validateMarkdownLinks(directory) {
  const failures = [];
  const markdownLink = /\]\(([^)]+\.md)(?:#[^)]+)?\)/g;
  for (const path of walkFiles(directory).filter((file) => file.endsWith('.md'))) {
    const content = readFileSync(path, 'utf8');
    for (const match of content.matchAll(markdownLink)) {
      const target = match[1];
      if (/^(?:https?:)?\/\//.test(target)) continue;
      const resolvedTarget = resolve(dirname(path), target);
      if (!existsSync(resolvedTarget)) {
        failures.push(`${relative(repositoryRoot, path)} -> ${target}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Broken Markdown links:\n${failures.join('\n')}`);
  }
}

const rootSkillDirectory = assertSkillDirectory(rootSkillName);
for (const name of domainSkillNames) assertSkillDirectory(name);
validateFlatManifest();

rmSync(suiteRoot, { recursive: true, force: true });
mkdirSync(suiteRoot, { recursive: true });
cpSync(rootSkillDirectory, suiteRoot, { recursive: true });
for (const name of domainSkillNames) {
  cpSync(join(skillsRoot, name), join(suiteRoot, name), { recursive: true });
}

rewriteSuiteLinks();
validateMarkdownLinks(skillsRoot);
validateMarkdownLinks(suiteRoot);

console.log(`Built single-root Skill bundle at ${relative(repositoryRoot, suiteRoot)}`);
