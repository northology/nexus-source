import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGuard } from '../hooks/guard.ts';
import { EXAMPLES, exampleRepo, finishPhase, tempDir } from './helpers.ts';

const HOME = tempDir('nexus-home-');
const WIN = process.platform === 'win32';
const AT = new Date('2026-10-02T20:10:00Z');
const guard = (cwd: string, tool: string, toolInput: unknown, env: Record<string, string> = {}) =>
  runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home: HOME, win: WIN, now: AT, env });
const denied = (out: string) => out !== '' && (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecision'] === 'deny';

describe('a visible protected folder with an unknown name in it', () => {
  it.each([
    ['Bash', 'echo x > .build/relay-rebuild/gates/$G.answers.json'],
    ['Bash', 'cp x .claude/rules/$NAME.md'],
    ['Bash', 'echo x > .claude/rules/${N}.md'],
    ['Bash', 'rm .claude/rules/$X'],
    ['Bash', 'rm -rf docs/superpowers/$X'],
    ['Bash', 'echo x > .claude/settings$S.json'],
    ['Bash', 'echo x > ${X}CLAUDE.md'],
    ['PowerShell', 'Remove-Item .claude\\rules\\$name'],
    ['PowerShell', 'Set-Content -Path ".claude/rules/$($n).md" -Value x'],
  ])('%s: %s is refused', (tool, command) => {
    expect(denied(guard(exampleRepo(), tool, { command }))).toBe(true);
  });
  it('still allows an unknown folder in front of an ordinary name, and a wholly unknown path', () => {
    const root = exampleRepo();
    for (const command of ['echo hi > $OUT/log.txt', 'rm $f', 'cp x "$dest"', 'echo x > src/$NAME.ts']) {
      expect(guard(root, 'Bash', { command }), command).toBe('');
    }
  });
});

describe('a substitution in front of a visible tail', () => {
  it.each([
    ['Bash', 'rm $(pwd)/CLAUDE.md'],
    ['Bash', 'rm `pwd`/CLAUDE.md'],
    ['Bash', 'echo hi > $(git rev-parse --show-toplevel)/CLAUDE.md'],
    ['PowerShell', 'Remove-Item (Get-Location)/CLAUDE.md'],
  ])('%s: %s is refused', (tool, command) => {
    expect(denied(guard(exampleRepo(), tool, { command }))).toBe(true);
  });
  it('still reads the command inside the substitution', () => {
    expect(denied(guard(exampleRepo(), 'Bash', { command: 'echo $(rm CLAUDE.md)' }))).toBe(true);
  });
});

describe('** globs in a removal', () => {
  it('judges the folder before the first glob', () => {
    const root = exampleRepo();
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
    expect(denied(guard(root, 'Bash', { command: 'rm -rf .claude/**' }))).toBe(true);
    expect(denied(guard(root, 'Bash', { command: 'rm -rf **' }))).toBe(true);
    mkdirSync(join(root, 'dist', 'a'), { recursive: true });
    expect(guard(root, 'Bash', { command: 'rm -rf dist/**' })).toBe('');
  });
});

describe('unknown paths from a closed repo nested in an active one', () => {
  it('are judged by the active repo above', () => {
    const outer = exampleRepo();
    const inner = join(outer, 'packages', 'inner');
    mkdirSync(inner, { recursive: true });
    cpSync(join(EXAMPLES, '.build'), join(inner, '.build'), { recursive: true });
    finishPhase(inner);
    expect(denied(guard(inner, 'Bash', { command: 'rm $D/CLAUDE.md' }))).toBe(true);
  });
});

describe('shell-managed variables', () => {
  it("read $PWD as the session's folder, not the hook's", () => {
    const root = exampleRepo();
    // The hook's own PWD points into another repo whose build is finished, so that repo wouldn't wall the file.
    const elsewhere = exampleRepo();
    finishPhase(elsewhere);
    expect(denied(guard(root, 'Bash', { command: 'echo x > $PWD/CLAUDE.md' }, { PWD: elsewhere }))).toBe(true);
  });
});

describe('opened pages through an unknown folder', () => {
  it('are matched in every active build, not only the first', () => {
    const root = exampleRepo();
    cpSync(join(root, '.build', 'relay-rebuild'), join(root, '.build', 'aaa-build'), { recursive: true });
    const file = join(root, '.build', 'aaa-build', 'build.json');
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), name: 'aaa-build', gates: {} }));
    rmSync(join(root, '.build', 'aaa-build', 'gates'), { recursive: true, force: true });
    mkdirSync(join(root, '.build', 'aaa-build', 'gates'));
    // relay-rebuild's pages are opened; aaa-build sorts first and is active too.
    expect(denied(guard(root, 'Bash', { command: 'rm $D/concepts/quiet-board.html' }))).toBe(true);
  });
});
