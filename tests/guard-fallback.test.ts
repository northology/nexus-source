import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGuard } from '../hooks/guard.ts';
import { EXAMPLES, exampleRepo, finishPhase, tempDir } from './helpers.ts';

const B = 'relay-rebuild';
const HOME = tempDir('nexus-home-');
const WIN = process.platform === 'win32';
const AT = new Date('2026-10-02T20:10:00Z');

function guard(cwd: string, tool: string, toolInput: unknown): string {
  return runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home: HOME, win: WIN, now: AT });
}
const reason = (out: string) => (out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '' : '');

/** A tool input whose path throws the first time it's read, so the guard fails and its fallback decides. */
function flaky(path: string) {
  let first = true;
  return {
    get file_path() {
      if (first) {
        first = false;
        throw new Error('boom');
      }
      return path;
    },
  };
}

describe("the guard's fallback when it fails", () => {
  it.each([
    ['the decision log', 'docs/governance/decisions.json'],
    ['the issues log', 'docs/governance/issues.json'],
    ['a build record', 'docs/governance/builds/old-build.md'],
    ['the vault registry', 'docs/_meta/tags.md'],
    ['a local CLAUDE file', 'CLAUDE.local.md'],
  ])('refuses %s during a build', (_label, file) => {
    const root = exampleRepo();
    expect(reason(guard(root, 'Write', flaky(join(root, file))))).toMatch(/guard failed \(boom\)/);
  });
  it('refuses removing the whole docs/superpowers folder during a build, as 1.3.0 did', () => {
    let first = true;
    const input = {
      get command() {
        if (first) {
          first = false;
          throw new Error('boom');
        }
        return 'rm -rf docs/superpowers';
      },
    };
    expect(reason(guard(exampleRepo(), 'Bash', input))).toMatch(/guard failed \(boom\)/);
  });
  it('stays out of the way in a repo whose .build/ holds no build, as after the last decommission', () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, '.build'));
    writeFileSync(join(cwd, '.build', '.gitattributes'), '* text=auto eol=lf\n');
    expect(guard(cwd, 'Write', flaky(join(cwd, 'CLAUDE.md')))).toBe('');
  });
  it('stays out of the way where no build folder is at or above the session', () => {
    const cwd = tempDir();
    expect(guard(cwd, 'Write', flaky(join(cwd, 'CLAUDE.md')))).toBe('');
  });
});

describe('a closed repo nested in an active one, from the inner folder', () => {
  function inner(): string {
    const outer = exampleRepo();
    const dir = join(outer, 'packages', 'inner');
    mkdirSync(dir, { recursive: true });
    cpSync(join(EXAMPLES, '.build'), join(dir, '.build'), { recursive: true });
    finishPhase(dir);
    return dir;
  }
  it('refuses posting gate answers', () => {
    const post = `curl -X POST -H "x-nexus-token: abc" -d '{}' http://127.0.0.1:4400/api/builds/${B}/gates/look/answers`;
    expect(reason(guard(inner(), 'Bash', { command: post }))).toMatch(/Only the user answers gates/);
  });
  it.runIf(WIN)("refuses a path nexus can't map", () => {
    expect(reason(guard(inner(), 'Write', { file_path: '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\x.txt' }))).toMatch(/can't tell which file/);
  });
});
