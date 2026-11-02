import { afterEach, describe, it, expect, vi } from 'vitest';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLES, tempDir } from './helpers.ts';

const unreadable = vi.hoisted(() => ({ folderName: '' }));

vi.mock('../core/lifecycle.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/lifecycle.ts')>();
  return {
    ...real,
    activeBuilds: (root: string) => {
      if (unreadable.folderName && root.replaceAll('\\', '/').toLowerCase().endsWith(`/${unreadable.folderName}`)) throw new Error('EPERM: operation not permitted');
      return real.activeBuilds(root);
    },
  };
});

const { runGuard } = await import('../hooks/guard.ts');

afterEach(() => {
  unreadable.folderName = '';
});

describe('deleting a folder that holds a build nexus cannot read', () => {
  it('refuses, because an unreadable build counts as active', () => {
    const parent = tempDir();
    const repo = join(parent, 'repo');
    mkdirSync(repo);
    cpSync(EXAMPLES, repo, { recursive: true });
    unreadable.folderName = 'repo';
    const out = runGuard(
      { cwd: parent, tool_name: 'Bash', tool_input: { command: 'rm -rf repo' } },
      { home: tempDir('nexus-home-'), win: process.platform === 'win32', now: new Date('2026-10-02T20:10:00Z') },
    );
    const reason = (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '';
    expect(reason).toMatch(/^Deleting or moving repo would remove a build folder nexus can't read \(/);
  });
});

describe('a session inside a build nexus cannot read', () => {
  function unreadableRepo(): string {
    const parent = tempDir();
    const repo = join(parent, 'repo');
    mkdirSync(repo);
    cpSync(EXAMPLES, repo, { recursive: true });
    unreadable.folderName = 'repo';
    return repo;
  }
  const guard = (cwd: string, tool: string, toolInput: unknown): string =>
    runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home: tempDir('nexus-home-'), win: process.platform === 'win32', now: new Date('2026-10-02T20:10:00Z') });
  const reasonOf = (out: string): string => (out ? ((JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '') : '');
  it('refuses posting gate answers', () => {
    const repo = unreadableRepo();
    const out = guard(repo, 'Bash', { command: `curl -X POST -d '{}' http://127.0.0.1:4400/api/builds/relay-rebuild/gates/x/answers` });
    expect(reasonOf(out)).toMatch(/^Only the user answers gates, in the cockpit\./);
  });
  it('refuses deleting .claude', () => {
    const repo = unreadableRepo();
    expect(reasonOf(guard(repo, 'Bash', { command: 'rm -rf .claude' }))).toMatch(/^Deleting or moving \.claude would take protected files .* during build "an unreadable build"/);
  });
  it('refuses a write to CLAUDE.md', () => {
    const repo = unreadableRepo();
    expect(reasonOf(guard(repo, 'Write', { file_path: join(repo, 'CLAUDE.md') }))).toMatch(/^Permanent rules can't change during build "an unreadable build"/);
  });
  it('allows an ordinary write', () => {
    const repo = unreadableRepo();
    expect(guard(repo, 'Write', { file_path: join(repo, 'src', 'app.ts') })).toBe('');
  });
  it('refuses a write under .claude that no default target names', () => {
    const repo = unreadableRepo();
    const raw = join(repo, '.claude', 'commands', 'x.md');
    expect(reasonOf(guard(repo, 'Write', { file_path: raw }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (${raw}).`);
  });
  it('refuses deleting a folder under .claude that no default target names', () => {
    const repo = unreadableRepo();
    expect(reasonOf(guard(repo, 'Bash', { command: 'rm -rf .claude/commands' }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (.claude/commands).`);
  });
  it('refuses a write to a memory folder outside home', () => {
    const repo = unreadableRepo();
    const raw = join(tempDir(), 'memory', 'notes.md');
    expect(reasonOf(guard(repo, 'Write', { file_path: raw }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (${raw}).`);
  });
  it('refuses a write to a path only the repo config protects', () => {
    const repo = unreadableRepo();
    mkdirSync(join(repo, '.nexus'), { recursive: true });
    writeFileSync(join(repo, '.nexus', 'config.json'), JSON.stringify({ protect: ['secrets/**'] }));
    expect(reasonOf(guard(repo, 'Write', { file_path: join(repo, 'secrets', 'key.txt') }))).toMatch(/^Permanent rules can't change during build "an unreadable build"/);
  });
  it('refuses a command that names a protected file anywhere in it, not only in the paths it writes', () => {
    const repo = unreadableRepo();
    const command = `echo x > out.txt; python -c "open('.claude/commands/z.md','w')"`;
    expect(reasonOf(guard(repo, 'Bash', { command }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (out.txt).`);
  });
  it('matches the whole input with its backslashes read as slashes', () => {
    const repo = unreadableRepo();
    const command = `echo x > out.txt; python -c "open(r'.claude\\commands\\z.md','w')"`;
    expect(reasonOf(guard(repo, 'Bash', { command }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (out.txt).`);
  });
  it('allows a command that names no protected file', () => {
    const repo = unreadableRepo();
    expect(guard(repo, 'Bash', { command: `echo x > out.txt; python -c "open('src/z.md','w')"` })).toBe('');
  });
  it('refuses a write to a path the repo config names, when the config reads only as raw JSON', () => {
    const repo = unreadableRepo();
    mkdirSync(join(repo, '.nexus'), { recursive: true });
    // An unknown key fails the config schema, so readConfig gives no protect list; the raw JSON still names secrets/.
    writeFileSync(join(repo, '.nexus', 'config.json'), JSON.stringify({ protect: ['secrets/**'], unknownKey: true }));
    const raw = join(repo, 'secrets', 'key.txt');
    expect(reasonOf(guard(repo, 'Write', { file_path: raw }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (${raw}).`);
  });
  it('reads a bracket class in a raw config entry as the text before it', () => {
    const repo = unreadableRepo();
    mkdirSync(join(repo, '.nexus'), { recursive: true });
    writeFileSync(join(repo, '.nexus', 'config.json'), JSON.stringify({ protect: ['vault[12]/**'], unknownKey: true }));
    const command = `echo x > out.txt; python -c "open('vault1/x.md','w')"`;
    expect(reasonOf(guard(repo, 'Bash', { command }))).toBe(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (out.txt).`);
  });
});
