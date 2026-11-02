import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runGuard } from '../hooks/guard.ts';
import { EXAMPLES, exampleRepo, tempDir } from './helpers.ts';
import { put } from './governance-helpers.ts';

// Fix round 3: bracketed folder names above the repo or in home, copies of files the guard can't name, and the shell
// spellings that reach the same files (braces, backslash escapes, $'…', env -C, trailing unknowns, archive tools).
const WIN = process.platform === 'win32';
const NOW = new Date('2026-10-02T20:10:00Z');

function guard(cwd: string, home: string, tool: string, toolInput: Record<string, unknown>): string {
  return runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home, win: WIN, now: NOW });
}
const reasonOf = (out: string): string => (out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '' : '');
const sh = (command: string) => ({ command });

const REVIEW = /Only the cockpit writes review answers/;
const REVIEW_DELETE = /would remove the repo's reviews/;
const UNLISTED = /can't list the files this copies into/;

/** A repo with .nexus/reviews/ (and the example build, active, when `build`), with folders a copy could carry. */
function repo(build: boolean, parent = tempDir()): { root: string; home: string } {
  const root = join(parent, 'repo');
  if (build) cpSync(EXAMPLES, root, { recursive: true });
  put(root, {
    '.nexus/reviews/.keep': '',
    'x/tidy.answers.json': '{}',
    'x/forged2/tidy.answers.json': '{}',
    'x/a.md': '# A\n',
  });
  const home = join(tempDir('nexus-home-'), 'home');
  mkdirSync(home, { recursive: true });
  return { root, home };
}

describe.each([['during a build', true]] as const)('a repo below a bracketed folder name, %s', (_label, build) => {
  it('still walls the review answers and allows the request file', () => {
    const { root, home } = repo(build, tempDir('clients [2026] '));
    expect(guard(root, home, 'Write', { file_path: join(root, '.nexus', 'reviews', 'tidy.json') })).toBe('');
    expect(reasonOf(guard(root, home, 'Bash', sh('cp x/tidy.answers.json .nexus/reviews/')))).toMatch(REVIEW);
    expect(reasonOf(guard(root, home, 'Bash', sh('echo x > .nexus/reviews/tidy.answers.json')))).toMatch(REVIEW);
    expect(reasonOf(guard(root, home, 'Bash', sh('rm -rf .nexus')))).toMatch(REVIEW_DELETE);
    mkdirSync(join(root, 'dist', 'a'), { recursive: true });
    expect(guard(root, home, 'Bash', sh('rm -rf dist/**'))).toBe('');
    expect(guard(root, home, 'Bash', sh('echo x > src/a.ts'))).toBe('');
  });
});

describe('the wall in a repo below a bracketed folder name, during a build', () => {
  it.each<[string, string, (root: string) => Record<string, unknown>, RegExp]>([
    ['a write to .nexus/config.json', 'Bash', () => sh('echo x > .nexus/config.json'), /Permanent rules can't change/],
    ['the Write tool on .nexus/config.json', 'Write', (root) => ({ file_path: join(root, '.nexus', 'config.json') }), /Permanent rules can't change/],
    ['gate answers', 'Bash', () => sh('echo x > .build/relay-rebuild/gates/look.answers.json'), /Only the cockpit writes gate answers/],
    ['build.json', 'Bash', () => sh('echo x > .build/relay-rebuild/build.json'), /Build state changes only through nexus commands/],
    ['docs/superpowers', 'Bash', () => sh('echo x > docs/superpowers/a.md'), /not docs\/superpowers/],
    ['a delete of .build', 'Bash', () => sh('rm -rf .build'), /would (?:remove the active build|take protected files)/],
    ['a delete of docs', 'Bash', () => sh('rm -rf docs'), /would take protected files/],
  ])('refuses %s', (_l, tool, input, reason) => {
    const { root, home } = repo(true, tempDir('clients [2026] '));
    expect(reasonOf(guard(root, home, tool, input(root)))).toMatch(reason);
  });
  it('walls memory in a home below a bracketed folder name', () => {
    const { root } = repo(true);
    const home = join(tempDir('people [x] '), 'home');
    const memory = join(home, '.claude', 'projects', 'proj', 'memory');
    mkdirSync(memory, { recursive: true });
    expect(reasonOf(guard(root, home, 'Write', { file_path: join(memory, 'note.md') }))).toMatch(/Permanent rules can't change/);
    expect(reasonOf(guard(root, home, 'Bash', sh(`echo x > "${join(memory, 'note.md').replace(/\\/g, '/')}"`)))).toMatch(/Permanent rules can't change/);
  });
});

describe.each([['during a build', true]] as const)('copies of a file the guard can\'t name, %s', (_label, build) => {
  it.each<[string]>([
    ['cp "$f" .'],
    ['cp "$f" ./'],
    ['mv "$f" .'],
    ['cp "$a" "$b"'],
    ['cp "$f" "$OUT/"'],
    ['for f in x/*.md; do cp "$f" "$OUT/"; done'],
    ['cp -r "$a" "$b"'],
  ])('allows %s', (command) => {
    const { root, home } = repo(build);
    expect(guard(root, home, 'Bash', sh(command))).toBe('');
  });
  it('still refuses a recursive one where it could land in the reviews', () => {
    const { root, home } = repo(build);
    expect(reasonOf(guard(root, home, 'Bash', sh('cp -r $F .')))).toMatch(UNLISTED);
    expect(reasonOf(guard(root, home, 'Bash', sh('cp -r $F/. .nexus')))).toMatch(UNLISTED);
    expect(reasonOf(guard(root, home, 'Bash', sh('D=.nexus/reviews; cp -r $A $D')))).toMatch(UNLISTED);
  });
});

describe('a recursive copy the wall can\'t name, during a build', () => {
  it('is refused into a folder only when the line names a protected one', () => {
    const root = exampleRepo();
    expect(reasonOf(guard(root, tempDir(), 'Bash', sh('D=.claude/rules; cp -r $A $D')))).toMatch(/can't tell which files/);
    expect(guard(root, tempDir(), 'Bash', sh('cp -r $A $B'))).toBe('');
  });
});

