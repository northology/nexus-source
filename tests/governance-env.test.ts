import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { displayPath, fileFacts, factsError, foldersAbove, inventoryEnv, managedDirFor, memoryKey } from '../core/governance/env.ts';
import { sandbox } from './governance-helpers.ts';
import { tempDir } from './helpers.ts';

describe('memoryKey', () => {
  it('matches the keys Claude Code uses on this kind of machine (observed, not documented)', () => {
    expect(memoryKey('E:\\Work')).toBe('E--Work');
    expect(memoryKey('E:\\Work\\repos\\agent-tools')).toBe('E--Work-repos-agent-tools');
  });
  it('matches the documented POSIX example', () => {
    expect(memoryKey('/home/user/work/my-repo')).toBe('-home-user-work-my-repo');
  });
  it('turns spaces, dots and non-ASCII letters into hyphens', () => {
    expect(memoryKey('C:\\Work Repos\\Ünïcode.v2')).toBe('C--Work-Repos--n-code-v2');
  });
});

describe('inventoryEnv', () => {
  it('uses CLAUDE_CONFIG_DIR when set, else <home>/.claude', () => {
    expect(inventoryEnv({}, 'linux', '/h').configDir).toBe(join('/h', '.claude'));
    expect(inventoryEnv({ CLAUDE_CONFIG_DIR: '/cfg' }, 'linux', '/h').configDir).toBe(resolve('/cfg'));
  });
  it('knows each OS managed-policy folder and walks to the filesystem root', () => {
    expect(managedDirFor('win32')).toBe('C:\\Program Files\\ClaudeCode');
    expect(managedDirFor('darwin')).toBe('/Library/Application Support/ClaudeCode');
    expect(managedDirFor('linux')).toBe('/etc/claude-code');
    expect(inventoryEnv({}, 'linux', '/h').ceiling).toBeNull();
  });
  it('carries the platform it was built for, which defaults to this machine', () => {
    expect(inventoryEnv({}, 'win32', '/h').platform).toBe('win32');
    expect(inventoryEnv({}, 'linux', '/h').platform).toBe('linux');
    expect(inventoryEnv({}).platform).toBe(process.platform);
  });
  it('takes the ceiling and the managed folder from NEXUS_INVENTORY_CEILING and NEXUS_INVENTORY_MANAGED', () => {
    const e = inventoryEnv({ NEXUS_INVENTORY_CEILING: '/c', NEXUS_INVENTORY_MANAGED: '/m' }, 'linux', '/h');
    expect([e.ceiling, e.managedDir]).toEqual([resolve('/c'), resolve('/m')]);
  });
});

describe('foldersAbove', () => {
  it('lists each folder above the repo, nearest first, stopping before the ceiling', () => {
    const { base, root, outer } = sandbox();
    expect(foldersAbove(root, base)).toEqual([outer]);
  });
  it.skipIf(process.platform !== 'win32')('matches the ceiling whatever its letter case on Windows', () => {
    const { base, root, outer } = sandbox();
    expect(foldersAbove(root, base.toUpperCase())).toEqual([outer]);
  });
  it('compares the ceiling by the platform it is given, not the machine it runs on', () => {
    const { base, root, outer } = sandbox();
    const shouted = base.toUpperCase() === base ? base.toLowerCase() : base.toUpperCase();
    expect(foldersAbove(root, shouted, 'win32')).toEqual([outer]);
    expect(foldersAbove(root, shouted, 'linux')).not.toEqual([outer]);
  });
  it('walks to the filesystem root with no ceiling', () => {
    const above = foldersAbove(tempDir(), null);
    expect(above.length).toBeGreaterThan(0);
    const last = above.at(-1) ?? '';
    expect(join(last, '..')).toBe(join(last));
  });
});

describe('displayPath and fileFacts', () => {
  it('shows repo files repo-relative, home files with ~, others absolute, all with forward slashes', () => {
    const { root, env, base } = sandbox();
    expect(displayPath(join(root, 'docs', 'a.md'), root, env.home)).toBe('docs/a.md');
    expect(displayPath(join(env.configDir, 'CLAUDE.md'), root, env.home)).toBe('~/.claude/CLAUDE.md');
    expect(displayPath(join(base, 'outer', 'CLAUDE.md'), root, env.home)).toBe(join(base, 'outer', 'CLAUDE.md').replace(/\\/g, '/'));
  });
  it('matches the repo and home folders by the platform it is given', () => {
    const { root, env } = sandbox();
    const shouted = root.toUpperCase() === root ? root.toLowerCase() : root.toUpperCase();
    expect(displayPath(join(root, 'a.md'), shouted, env.home, 'win32')).toBe('a.md');
    expect(displayPath(join(root, 'a.md'), shouted, env.home, 'linux')).not.toBe('a.md');
  });
  it('shows the repo root itself as a dot', () => {
    const { root, env } = sandbox();
    expect(displayPath(root, root, env.home)).toBe('.');
  });
  it('maps a read error to null when nothing is there, else to a problem naming the code', () => {
    expect(factsError({ code: 'ENOENT' })).toBeNull();
    expect(factsError({ code: 'ENOTDIR' })).toBeNull();
    expect(factsError({ code: 'EACCES' })).toEqual({ problem: "can't be read: EACCES" });
    expect(factsError(new Error('odd'))).toEqual({ problem: "can't be read: unknown" });
  });
  it('gives size and time, null for a missing file, and a problem for a link out of its location', () => {
    const { root, base } = sandbox();
    writeFileSync(join(root, 'a.md'), 'abc');
    const facts = fileFacts(join(root, 'a.md'), root);
    expect(facts).toMatchObject({ size: 3 });
    expect(facts).toMatchObject({ changed: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(fileFacts(join(root, 'none.md'), root)).toBeNull();
    mkdirSync(join(base, 'elsewhere'));
    writeFileSync(join(base, 'elsewhere', 'b.md'), 'x');
    symlinkSync(join(base, 'elsewhere'), join(root, 'linked'), 'junction');
    expect(fileFacts(join(root, 'linked', 'b.md'), root)).toEqual({ problem: 'a link leads out of its folder; not read' });
  });
});
