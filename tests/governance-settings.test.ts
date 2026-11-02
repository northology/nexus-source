import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { formatSetting } from '../core/governance/format.ts';
import { AGENTS_NOTE, instructionItems } from '../core/governance/instructions.ts';
import { governanceInventory, inventorySignature } from '../core/governance/inventory.ts';
import { instructionFilesSetting, notLoaded, type InstructionFiles } from '../core/governance/settings.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { NOW } from './helpers.ts';
import { put, sandbox } from './governance-helpers.ts';

const setting = (value: string, id = 'cc-plugin-agents-md@builtin') => JSON.stringify({ pluginConfigs: { [id]: { options: { instructionFiles: value } } } });

describe('instructionFilesSetting', () => {
  it('is the default with no setting anywhere', () => {
    const { env } = sandbox();
    expect(instructionFilesSetting(env)).toEqual({ value: 'claude-md-or-agents-md', from: null });
  });
  it('reads the user settings, under the current plugin ID or the one before v2.1.285', () => {
    const { env } = sandbox();
    put(env.configDir, { 'settings.json': setting('claude-md-and-agents-md') });
    expect(instructionFilesSetting(env)).toEqual({ value: 'claude-md-and-agents-md', from: join(env.configDir, 'settings.json') });
    put(env.configDir, { 'settings.json': setting('claude-md', 'agents-md@builtin') });
    expect(instructionFilesSetting(env).value).toBe('claude-md');
  });
  it('takes managed settings over the user\'s', () => {
    const { env } = sandbox();
    put(env.configDir, { 'settings.json': setting('claude-md') });
    put(env.managedDir, { 'managed-settings.json': setting('managed-only') });
    expect(instructionFilesSetting(env)).toEqual({ value: 'managed-only', from: join(env.managedDir, 'managed-settings.json') });
  });
  it('ignores project and local settings, as Claude Code does, and values it doesn\'t know', () => {
    const { root, env } = sandbox();
    put(root, { '.claude/settings.json': setting('claude-md'), '.claude/settings.local.json': setting('claude-md') });
    put(env.configDir, { 'settings.json': setting('everything') });
    expect(instructionFilesSetting(env)).toEqual({ value: 'claude-md-or-agents-md', from: null });
  });
  it('skips an unreadable or non-object settings file', () => {
    const { env } = sandbox();
    put(env.managedDir, { 'managed-settings.json': '{ nope' });
    put(env.configDir, { 'settings.json': setting('claude-md') });
    expect(instructionFilesSetting(env).value).toBe('claude-md');
  });
  it('reads only own keys: a settings file lacking the plugin ID falls to the default', () => {
    const { env } = sandbox();
    // No pluginConfigs, an empty one, one with no options, and one with options lacking the key: none sets anything.
    for (const text of [
      '{}',
      JSON.stringify({ pluginConfigs: {} }),
      JSON.stringify({ pluginConfigs: { 'cc-plugin-agents-md@builtin': {} } }),
      JSON.stringify({ pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: {} } } }),
      // JSON.parse makes __proto__ an own property here: this is a plugin ID that isn't ours, not an inherited key.
      '{"pluginConfigs":{"__proto__":{"options":{"instructionFiles":"claude-md"}}}}',
    ]) {
      put(env.configDir, { 'settings.json': text });
      expect(instructionFilesSetting(env)).toEqual({ value: 'claude-md-or-agents-md', from: null });
    }
  });
  it('is not fooled by values inherited from Object.prototype', () => {
    const { env } = sandbox();
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto['cc-plugin-agents-md@builtin'] = { options: { instructionFiles: 'managed-only' } };
    try {
      put(env.configDir, { 'settings.json': '{"pluginConfigs":{}}' });
      expect(instructionFilesSetting(env)).toEqual({ value: 'claude-md-or-agents-md', from: null });
    } finally {
      delete proto['cc-plugin-agents-md@builtin'];
    }
  });
});

describe('notes by setting', () => {
  /** A repo CLAUDE.md that imports a.md, an AGENTS.md here and above, a user and a managed CLAUDE.md. */
  function repo(value: InstructionFiles | null) {
    const s = sandbox();
    put(s.root, { 'CLAUDE.md': '# Repo\n@a.md\n', 'a.md': '# A\n', 'AGENTS.md': '# Codex\n' });
    put(s.outer, { 'AGENTS.md': '# Above\n' });
    put(s.env.configDir, { 'CLAUDE.md': '# User\n' });
    put(s.env.managedDir, { 'CLAUDE.md': '# Managed\n' });
    const found = instructionItems(s.root, s.env, [], value ?? undefined);
    const note = (file: string) => found.find((f) => f.file === file)?.conditional;
    return { ...s, note };
  }
  it('default: an AGENTS.md under a CLAUDE.md is not loaded', () => {
    const r = repo(null);
    expect([r.note(join(r.root, 'AGENTS.md')), r.note(join(r.outer, 'AGENTS.md'))]).toEqual([AGENTS_NOTE, AGENTS_NOTE]);
    expect(r.note(join(r.root, 'CLAUDE.md'))).toBeUndefined();
  });
  it('claude-md-and-agents-md: both load, no note', () => {
    const r = repo('claude-md-and-agents-md');
    expect([r.note(join(r.root, 'AGENTS.md')), r.note(join(r.outer, 'AGENTS.md'))]).toEqual([undefined, undefined]);
  });
  it('claude-md: AGENTS.md files are not loaded', () => {
    const r = repo('claude-md');
    expect(r.note(join(r.root, 'AGENTS.md'))).toBe(notLoaded('claude-md'));
    expect(notLoaded('claude-md')).toBe('not loaded: the project-instructions setting is claude-md');
  });
  it('managed-only: only the managed CLAUDE.md and what it imports load', () => {
    const r = repo('managed-only');
    const off = notLoaded('managed-only');
    expect(r.note(join(r.root, 'CLAUDE.md'))).toBe(off);
    expect(r.note(join(r.root, 'a.md'))).toBe(off);
    expect(r.note(join(r.root, 'AGENTS.md'))).toBe(off);
    expect(r.note(join(r.env.configDir, 'CLAUDE.md'))).toBe(off);
    expect(r.note(join(r.env.managedDir, 'CLAUDE.md'))).toBeUndefined();
  });
  describe('managed-only, files the managed CLAUDE.md also imports', () => {
    /** The repo's files, and a managed CLAUDE.md that imports the named repo files by absolute path. */
    const run = (rootFiles: Record<string, string>, managedImports: string[]) => {
      const s = sandbox();
      put(s.root, rootFiles);
      put(s.env.managedDir, { 'CLAUDE.md': `# M\n${managedImports.map((f) => `@${join(s.root, f).replace(/\\/g, '/')}\n`).join('')}` });
      const found = instructionItems(s.root, s.env, [], 'managed-only');
      return { ...s, item: (name: string) => found.find((f) => f.file === join(s.root, name)) };
    };
    it('a file both the repo and the managed CLAUDE.md import loads, and names the managed importer', () => {
      const r = run({ 'CLAUDE.md': '# Repo\n@shared.md\n', 'shared.md': '# S\n' }, ['shared.md']);
      expect(r.item('shared.md')?.conditional).toBeUndefined();
      expect(r.item('shared.md')?.source).toBe(join(r.env.managedDir, 'CLAUDE.md'));
    });
    it('an AGENTS.md both import loads', () => {
      const r = run({ 'CLAUDE.md': '# Repo\n@AGENTS.md\n', 'AGENTS.md': '# C\n' }, ['AGENTS.md']);
      expect(r.item('AGENTS.md')?.conditional).toBeUndefined();
      expect(r.item('AGENTS.md')?.source).toBe(join(r.env.managedDir, 'CLAUDE.md'));
    });
    it('what a managed import imports loads too, at depth, though the repo reaches it first', () => {
      const r = run({ 'CLAUDE.md': '# Repo\n@x.md\n', 'x.md': '# X\n@y.md\n', 'y.md': '# Y\n' }, ['x.md']);
      expect(r.item('x.md')?.conditional).toBeUndefined();
      expect(r.item('y.md')?.conditional).toBeUndefined();
    });
    it('still notes what only the repo imports, and its chain', () => {
      const r = run({ 'CLAUDE.md': '# Repo\n@x.md\n', 'x.md': '# X\n@y.md\n', 'y.md': '# Y\n' }, []);
      expect(r.item('x.md')?.conditional).toBe(notLoaded('managed-only'));
      expect(r.item('y.md')?.conditional).toBe(notLoaded('managed-only'));
    });
  });
});

describe('the inventory and governance list', () => {
  it('carries the setting with where it was read, and a change to it changes the signature', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const before = inventorySignature(root, env);
    expect(governanceInventory(root, env).setting).toEqual({ value: 'claude-md-or-agents-md', from: null });
    put(env.configDir, { 'settings.json': setting('claude-md-and-agents-md') });
    expect(governanceInventory(root, env).setting).toEqual({ value: 'claude-md-and-agents-md', from: '~/.claude/settings.json' });
    expect(inventorySignature(root, env)).not.toBe(before);
  });
  it('shows a setting read from the managed settings file as an absolute path outside the repo and home', () => {
    const { root, env } = sandbox();
    put(env.managedDir, { 'managed-settings.json': setting('managed-only') });
    expect(governanceInventory(root, env).setting).toEqual({ value: 'managed-only', from: join(env.managedDir, 'managed-settings.json').replace(/\\/g, '/') });
  });
  it('formats the setting line', () => {
    expect(formatSetting({ value: 'claude-md', from: '~/.claude/settings.json' })).toBe('Project instructions setting: claude-md (from ~/.claude/settings.json)');
    expect(formatSetting({ value: 'claude-md-or-agents-md', from: null })).toBe("Project instructions setting: claude-md-or-agents-md (Claude Code's default; a --settings file given at launch isn't visible here)");
  });
  it('governance list ends with the setting line; --json carries it', async () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const out: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: () => {}, now: () => NOW, readStdin: async () => '', env: { CLAUDE_CONFIG_DIR: env.configDir, NEXUS_INVENTORY_MANAGED: env.managedDir, NEXUS_INVENTORY_CEILING: env.ceiling ?? '' } };
    expect(await main(['governance', 'list'], io)).toBe(0);
    expect(out.at(-1)).toMatch(/^Project instructions setting: claude-md-or-agents-md/);
    out.length = 0;
    expect(await main(['governance', 'list', '--json'], io)).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ setting: { value: 'claude-md-or-agents-md', from: null } });
  });
});
