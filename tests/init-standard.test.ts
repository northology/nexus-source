import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STANDARD } from './vault-helpers.ts';
import { REPO_NAME_TOKEN } from '../core/init/standard.ts';
import { validate } from '../core/schemas.ts';
import { internalNames } from '../scripts/source-snapshot.ts';
import { ARTIFACTS } from './helpers.ts';

const VAULT = join(STANDARD, 'obsidian', 'vault');
const json = (rel: string) => JSON.parse(readFileSync(join(VAULT, rel), 'utf8')) as Record<string, unknown>;
const files = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => statSync(join(dir, f)).isFile());

describe('the shipped Obsidian baseline', () => {
  it('sets the links, exclusions and attachments nexus depends on', () => {
    expect(json('app.json')).toMatchObject({ newLinkFormat: 'absolute', alwaysUpdateLinks: true, attachmentFolderPath: './assets', userIgnoreFilters: ['governance/archive/', 'superpowers/archive/'] });
  });
  it('types the lean property set', () => {
    expect(json('types.json')['types']).toMatchObject({ class: 'text', component: 'text', source: 'text', status: 'text', build: 'text', tier: 'text', paths: 'multitext', uses: 'multitext', feeds: 'multitext', supersedes: 'multitext', relates: 'multitext' });
  });
  it('keeps DataviewJS off and Obsidian Sync out of the shared setup', () => {
    expect(json('plugins/dataview/data.json')).toMatchObject({ enableDataviewJs: false, enableInlineDataviewJs: false });
    expect(json('core-plugins.json')['sync']).toBe(false);
  });
  it('lists the 14 plugins and the Baseline theme, and ships no per-user files or plugin code', () => {
    expect((JSON.parse(readFileSync(join(VAULT, 'community-plugins.json'), 'utf8')) as string[]).length).toBe(14);
    expect(json('appearance.json')['cssTheme']).toBe('Baseline');
    expect(files(VAULT).filter((f) => /workspace|main\.js|styles\.css|manifest\.json/.test(f))).toEqual([]);
  });
  it('keeps Hearth: the repo name as title, no logo, no runtime keys, and Freddie', () => {
    const text = readFileSync(join(VAULT, 'plugins', 'hearth', 'data.json'), 'utf8');
    expect(json('plugins/hearth/data.json')['title']).toBe(REPO_NAME_TOKEN);
    expect(text).not.toContain('titleIcon');
    expect(text).not.toContain('lastPlayedAt');
    expect(text).toContain('"name": "freddie"');
  });
  it('is workspace-neutral: no absolute paths, organization names or other-vault references anywhere in standard/', () => {
    // Absolute paths and the workspace vault's own folder names (as keys or paths); organization and project names come
    // from the private list beside the source, which the public snapshot leaves out (it has only these generic checks).
    const banned = [
      /(?<![A-Za-z])[A-Za-z]:[\\/](?![\\/])/, /\/Users\//i,
      /"(identity|environment|strategy|cloud|operations)(\/[^"]*)?"/, /nexus-[a-z]+-bootstrap|-archive\//i,
      ...internalNames(ARTIFACTS),
    ];
    for (const f of files(STANDARD)) {
      const text = readFileSync(join(STANDARD, f), 'utf8');
      for (const b of banned) expect(text.match(b)?.[0], `${f} matches ${b}`).toBeUndefined();
    }
  });
});

describe('the shipped pinned list', () => {
  it('pins every enabled plugin and the theme, each with main.js and manifest.json', () => {
    const pins = JSON.parse(readFileSync(join(STANDARD, 'obsidian', 'plugins.json'), 'utf8')) as { plugins: { id: string; files: { name: string }[] }[]; theme: { name: string } };
    expect(validate('obsidian-pins', pins)).toEqual([]);
    const enabled = JSON.parse(readFileSync(join(VAULT, 'community-plugins.json'), 'utf8')) as string[];
    expect(pins.plugins.map((p) => p.id).sort()).toEqual([...enabled].sort());
    expect(pins.theme.name).toBe(json('appearance.json')['cssTheme']);
    for (const p of pins.plugins) expect(p.files.map((f) => f.name), p.id).toEqual(expect.arrayContaining(['main.js', 'manifest.json']));
  });
});

describe('the CLAUDE.md block', () => {
  it('is a marked block that points at the vault, the rules flow and the checker', () => {
    const block = readFileSync(join(STANDARD, 'claude-block.md'), 'utf8');
    expect(block.startsWith('<!-- nexus:start -->\n')).toBe(true);
    expect(block.endsWith('<!-- nexus:end -->\n')).toBe(true);
    for (const s of ['docs/_meta/', 'nexus docs check', 'docs/governance/rules/', '.claude/rules/nexus/', 'nexus docs generate', 'docs/dev/context/', '.scratch/']) expect(block).toContain(s);
  });
  it('is stored under a name the wall never guards', () => {
    expect(existsSync(join(STANDARD, 'CLAUDE.md'))).toBe(false);
  });
});
