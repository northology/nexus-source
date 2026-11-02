import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { memoryKey } from '../core/governance/env.ts';
import { governanceInventory } from '../core/governance/inventory.ts';
import { openReview, submitReviewAnswers } from '../core/reviews.ts';
import { reviewGuard, runGuard } from '../hooks/guard.ts';
import { exampleRepo, tempDir, NOW } from './helpers.ts';
import { isolatedEnv, put } from './governance-helpers.ts';

const WIN = process.platform === 'win32';
const AT = new Date('2026-10-02T20:10:00Z'); // ten minutes after NOW
const LATE = new Date('2026-10-02T20:31:00Z');

function guard(cwd: string, home: string, tool: string, toolInput: unknown, opts: { now?: Date; fold?: boolean } = {}): string {
  return runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home, win: WIN, now: opts.now ?? AT, ...(opts.fold !== undefined ? { fold: opts.fold } : {}) });
}
const reasonOf = (out: string): string => (out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '' : '');

/** A repo with .nexus/reviews/; `build` adds the example build (active), so the wall is up too. */
function repo(build: boolean): { root: string; home: string } {
  const root = build ? exampleRepo() : tempDir('nexus-review-repo-');
  mkdirSync(join(root, '.nexus', 'reviews'), { recursive: true });
  return { root, home: tempDir('nexus-review-home-') };
}

describe.each([['during a build', true]] as const)('review answers %s', (_label, build) => {
  it.each<[string, string, (root: string) => Record<string, unknown>]>([
    ['a Write', 'Write', (root) => ({ file_path: join(root, '.nexus', 'reviews', 'tidy.answers.json') })],
    ['an Edit', 'Edit', () => ({ file_path: '.nexus/reviews/tidy.answers.json' })],
    ['a Bash redirect', 'Bash', () => ({ command: "echo '{}' > .nexus/reviews/tidy.answers.json" })],
    ['a PowerShell Set-Content', 'PowerShell', () => ({ command: "Set-Content -Path .nexus\\reviews\\tidy.answers.json -Value '{}'" })],
    ['a copy over them', 'Bash', () => ({ command: 'cp x.json .nexus/reviews/tidy.answers.json' })],
    ['a write to the index', 'Write', (root) => ({ file_path: join(root, '.nexus', 'reviews', 'index.json') })],
    ['an unknown name in the folder', 'Bash', () => ({ command: 'echo x > ".nexus/reviews/$NAME.answers.json"' })],
  ])('refuses %s', (_l, tool, input) => {
    const { root, home } = repo(build);
    expect(reasonOf(guard(root, home, tool, input(root)))).toMatch(/Only the cockpit writes review answers/);
  });
  it.each<[string, string, Record<string, unknown>]>([
    ['the reviews folder', 'Bash', { command: 'rm -rf .nexus/reviews' }],
    ['the .nexus folder', 'PowerShell', { command: 'Remove-Item -Recurse -Force .nexus' }],
    ['a glob inside it', 'Bash', { command: 'rm .nexus/reviews/*' }],
  ])('refuses deleting %s', (_l, tool, input) => {
    const { root, home } = repo(build);
    expect(reasonOf(guard(root, home, tool, input))).toMatch(/would remove the repo's reviews/);
  });
  it('refuses posting review answers from the shell, by route or by the cockpit token', () => {
    const { root, home } = repo(build);
    const route = 'curl -X POST -H "content-type: application/json" -d \'{}\' http://127.0.0.1:4410/api/reviews/tidy/answers';
    expect(reasonOf(guard(root, home, 'Bash', { command: route }))).toMatch(/Only the user answers reviews/);
    expect(reasonOf(guard(root, home, 'PowerShell', { command: 'Invoke-WebRequest -Uri http://localhost:4410/api/reviews/tidy/answers -Method Post' }))).toMatch(/Only the user answers reviews/);
    const token = 'curl -H "x-nexus-token: abc" http://127.0.0.1:4410/api/builds';
    expect(reasonOf(guard(root, home, 'Bash', { command: token }))).toMatch(/Only the user answers reviews/);
  });
  it('allows the request file and other files', () => {
    const { root, home } = repo(build);
    expect(guard(root, home, 'Write', { file_path: join(root, '.nexus', 'reviews', 'tidy.json') })).toBe('');
    expect(guard(root, home, 'Write', { file_path: join(root, 'src', 'app.ts') })).toBe('');
  });
});

describe('the token rule outside a review repo', () => {
  it('leaves a token post alone where no reviews exist and no build is active', () => {
    const cwd = tempDir();
    expect(guard(cwd, tempDir(), 'Bash', { command: 'curl -H "x-nexus-token: abc" http://127.0.0.1:4410/api/builds' })).toBe('');
  });
});

describe('reviewGuard on its own', () => {
  it('folds case where names ignore it', () => {
    const root = tempDir();
    const ctx = { cwd: root, home: tempDir(), win: WIN, fold: true };
    expect(reviewGuard({ writes: [{ path: join(root, '.NEXUS', 'Reviews', 'Tidy.Answers.JSON'), removes: false }], command: null }, ctx)).toMatch(/Only the cockpit writes review answers/);
    expect(reviewGuard({ writes: [{ path: join(root, 'notes.md'), removes: false }], command: null }, ctx)).toBe('');
  });
});

describe('a review\'s permits through the wall', () => {
  /** The example build (active), a memory file and a rule file, and a review that adjusts the memory and keeps the rule. */
  function permitted() {
    const root = exampleRepo();
    const env = { ...isolatedEnv(tempDir('nexus-review-env-')), ceiling: dirname(root) };
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const key = memoryKey(root);
    const dir = join(env.configDir, 'projects', key, 'memory');
    put(dir, { 'MEMORY.md': '- [Tidy](tidy.md)\n', 'tidy.md': 'Keep it tidy.\n', 'other.md': 'Other.\n' });
    const id = (location: string) => governanceInventory(root, env).items.find((i) => i.location === location)?.id ?? '';
    const memory = `~/.claude/projects/${key}/memory`;
    openReview(root, {
      name: 'tidy-up', type: 'review', title: 'Tidy', why: 'Mark each one.',
      items: [
        { name: 'tidy-file', text: 'Tidy memory', item: id(`${memory}/tidy.md`), target: `${memory}/tidy.md` },
        { name: 'repo-claude', text: 'CLAUDE.md', item: id('CLAUDE.md'), target: 'CLAUDE.md' },
      ],
    }, NOW, env);
    submitReviewAnswers(root, 'tidy-up', { marks: { 'tidy-file': 'research', 'repo-claude': 'accepted' }, notes: { 'tidy-file': 'Shorter' } }, NOW, env);
    return { root, home: env.home, dir, key };
  }
  it('lets Claude change exactly the marked files, for 30 minutes', () => {
    const { root, home, dir } = permitted();
    expect(guard(root, home, 'Write', { file_path: join(dir, 'tidy.md') })).toBe('');
    expect(guard(root, home, 'Edit', { file_path: join(dir, 'MEMORY.md') })).toBe('');
    expect(reasonOf(guard(root, home, 'Write', { file_path: join(dir, 'other.md') }))).toMatch(/Permanent rules can't change/);
    expect(reasonOf(guard(root, home, 'Write', { file_path: join(root, 'CLAUDE.md') }))).toMatch(/Permanent rules can't change/);
    expect(reasonOf(guard(root, home, 'Write', { file_path: join(dir, 'tidy.md') }, { now: LATE }))).toMatch(/Permanent rules can't change/);
  });
  it('matches a permit spelled in another case where names ignore case, and still no other file', () => {
    const { root, home, key } = permitted();
    const upper = join(home, '.claude', 'projects', key.toUpperCase(), 'memory');
    expect(guard(root, home, 'Write', { file_path: join(upper, 'TIDY.md') }, { fold: true })).toBe('');
    expect(reasonOf(guard(root, home, 'Write', { file_path: join(upper, 'OTHER.md') }, { fold: true }))).toMatch(/Permanent rules can't change/);
  });
});

describe.each([['during a build', true]] as const)('review answers placed another way, %s', (_label, build) => {
  it.each<[string, string, string]>([
    ['a copy into the folder', 'Bash', 'cp x/tidy.answers.json .nexus/reviews/'],
    ['a copy into the folder, no slash', 'Bash', 'cp x/tidy.answers.json .nexus/reviews'],
    ['a copy with -t', 'Bash', 'cp -t .nexus/reviews x/tidy.answers.json'],
    ['a copy of several files', 'Bash', 'cp x/a.json x/tidy.answers.json .nexus/reviews'],
    ['a move into the folder', 'Bash', 'mv x/tidy.answers.json .nexus/reviews/'],
    ['an install into the folder', 'Bash', 'install -m 644 x/tidy.answers.json .nexus/reviews/'],
    ['a copy of an index into the folder', 'Bash', 'cp x/index.json .nexus/reviews/'],
    ['a copy of a whole folder over it', 'Bash', 'cp -r x/forged/. .nexus/reviews'],
    ['a Copy-Item -Destination folder', 'PowerShell', 'Copy-Item x\\tidy.answers.json -Destination .nexus\\reviews\\'],
    ['a Copy-Item to the folder', 'PowerShell', 'Copy-Item x\\tidy.answers.json .nexus\\reviews'],
    ['a Set-Content through a folder glob', 'PowerShell', "Set-Content -Path .nexus\\*\\tidy.answers.json -Value '{}'"],
    ['a copy through a folder glob', 'Bash', 'cp x.json .nexus/rev*/tidy.answers.json'],
    ['a copy to a name glob', 'Bash', 'cp x.json .nexus/reviews/tidy.*.json'],
    ['a delete of the index through a glob', 'Bash', 'rm .nexus/*/index.json'],
    ['a Bash delete of the index', 'Bash', 'rm .nexus/reviews/index.json'],
    ['an unknown folder before an answers name', 'Bash', 'echo x > $D/tidy.answers.json'],
    ['an unknown part in the folder name', 'Bash', 'echo x > .nexus/review$S/tidy.answers.json'],
    ['an index reached through a variable the line sets', 'Bash', "D=.nexus/reviews; echo '{}' > $D/index.json"],
  ])('refuses %s', (_l, tool, command) => {
    const { root, home } = repo(build);
    expect(reasonOf(guard(root, home, tool, { command }))).toMatch(/Only the cockpit writes review answers/);
  });
  it.each<[string, string, string]>([
    ['a glob of the .nexus folder', 'Bash', 'rm -rf .nexus/*'],
    ['a PowerShell glob of the .nexus folder', 'PowerShell', 'Remove-Item .nexus\\* -Recurse'],
    ['the repo itself', 'Bash', 'rm -rf .'],
  ])('refuses deleting %s', (_l, tool, command) => {
    const { root, home } = repo(build);
    expect(reasonOf(guard(root, home, tool, { command }))).toMatch(/would remove the repo's reviews/);
  });
  it('refuses deleting the repo from a subfolder, by its path or by ..', () => {
    const { root, home } = repo(build);
    const sub = join(root, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    expect(reasonOf(guard(sub, home, 'Bash', { command: `rm -rf "${root.replace(/\\/g, '/')}"` }))).toMatch(/would remove the repo's reviews/);
    expect(reasonOf(guard(sub, home, 'Bash', { command: 'rm -rf ../..' }))).toMatch(/would remove the repo's reviews/);
  });
  it('refuses answers written from a subfolder', () => {
    const { root, home } = repo(build);
    const sub = join(root, 'src');
    mkdirSync(sub, { recursive: true });
    expect(reasonOf(guard(sub, home, 'Edit', { file_path: '../.nexus/reviews/tidy.answers.json' }))).toMatch(/Only the cockpit writes review answers/);
    expect(reasonOf(guard(sub, home, 'Bash', { command: 'cp x.json ../.nexus/reviews/' }))).toMatch(/Only the cockpit writes review answers/);
  });
  it('refuses a token post from a subfolder of a repo with no git, and from a git repo nested below it', () => {
    const { root, home } = repo(build);
    const token = 'curl -H "x-nexus-token: abc" http://127.0.0.1:4410/api/builds';
    const sub = join(root, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    expect(reasonOf(guard(sub, home, 'Bash', { command: token }))).toMatch(/Only the user answers reviews/);
    const nested = join(root, 'vendor', 'lib');
    mkdirSync(join(nested, '.git'), { recursive: true });
    expect(reasonOf(guard(nested, home, 'Bash', { command: token }))).toMatch(/Only the user answers reviews/);
  });
  it('still allows ordinary copies and deletes', () => {
    const { root, home } = repo(build);
    mkdirSync(join(root, 'out'), { recursive: true });
    expect(guard(root, home, 'Bash', { command: 'cp x/a.ts out/' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'cp x/a.ts out' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'rm -rf out' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'rm .nexus/reviews/tidy.json' })).toBe('');
  });
});

describe('reviews with no build: the wall is down', () => {
  it('leaves a review route post alone outside any repo', () => {
    expect(guard(tempDir(), tempDir(), 'Bash', { command: 'curl -X POST http://127.0.0.1:4410/api/reviews/tidy/answers' })).toBe('');
  });
  it('leaves the answers, the index and the folder alone, as it does a finished build', () => {
    const { root, home } = repo(false);
    expect(guard(root, home, 'Write', { file_path: join(root, '.nexus', 'reviews', 'tidy.answers.json') })).toBe('');
    expect(guard(root, home, 'Edit', { file_path: '.nexus/reviews/index.json' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'cp x.answers.json .nexus/reviews/' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'rm -rf .nexus' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'cp -r $F .' })).toBe('');
  });
  it('leaves creating the reviews folder from the shell alone', () => {
    expect(guard(tempDir(), tempDir(), 'PowerShell', { command: 'New-Item .nexus -ItemType Directory' })).toBe('');
  });
});

describe("the build's gates folder during a build", () => {
  const gates = '.build/relay-rebuild/gates';
  const winGates = gates.replace(/\//g, '\\');
  it.each<[string, string, string]>([
    ['a copy into the folder', 'Bash', `cp x/look.answers.json ${gates}/`],
    ['a copy into the folder, no slash', 'Bash', `cp x/look.answers.json ${gates}`],
    ['a copy with -t', 'Bash', `cp -t ${gates} x/look.answers.json`],
    ['a move into the folder', 'Bash', `mv x/look.answers.json ${gates}/`],
    ['an install into the folder', 'Bash', `install -m 644 x/look.answers.json ${gates}/`],
    ['a Copy-Item -Destination folder', 'PowerShell', `Copy-Item x\\look.answers.json -Destination ${winGates}\\`],
    ['a Copy-Item to the folder', 'PowerShell', `Copy-Item x\\look.answers.json ${winGates}`],
  ])('refuses %s', (_l, tool, command) => {
    const root = exampleRepo();
    expect(reasonOf(guard(root, tempDir(), tool, { command }))).toMatch(/Only the cockpit writes gate answers/);
  });
});

/** Folders on disk that a recursive copy would carry review answers out of. */
function seedForgeries(root: string): void {
  put(root, {
    'x/tidy.answers.json': '{}',
    'x/deep/.nexus/reviews/tidy.answers.json': '{}',
    'x/forged/reviews/tidy.answers.json': '{}',
  });
}

describe.each([['during a build', true]] as const)('review answers carried in by a recursive copy, a bracket glob or a cd, %s', (_label, build) => {
  it.each<[string, string, string]>([
    ['a copy of a folder\'s contents into the repo', 'Bash', 'cp -r x/deep/. .'],
    ['a copy with -T into the repo', 'Bash', 'cp -rT x/deep .'],
    ['a Copy-Item of a folder\'s items into the repo', 'PowerShell', 'Copy-Item x\\deep\\* . -Recurse -Force'],
    ['a copy of a folder\'s contents into .nexus', 'Bash', 'cp -r x/forged/. .nexus'],
    ['a copy with -T into .nexus', 'Bash', 'cp -rT x/forged .nexus'],
    ['a copy into a folder the line names in a variable', 'Bash', 'D=.nexus/reviews; cp -r x/forged/. $D'],
    ['a copy of an unknown file into the reviews folder', 'Bash', 'cp $F .nexus/reviews/'],
    ['a copy of an unknown file into .nexus', 'Bash', 'cp $F .nexus/'],
    ['a copy into a bracket glob of the folder', 'Bash', 'cp x/tidy.answers.json .nexus/rev[i]ews/'],
    ['a copy into a bracket glob of its first letter', 'Bash', 'cp x/tidy.answers.json .nexus/[r]eviews/'],
    ['a copy into a bracket glob of .nexus', 'Bash', 'cp x/tidy.answers.json .nexu[s]/reviews/'],
    ['a copy into a bracket range', 'Bash', 'cp x/tidy.answers.json .nexus/rev[a-z]ews/'],
    ['a Copy-Item into a bracket glob', 'PowerShell', 'Copy-Item x\\tidy.answers.json .nexus\\rev[i]ews\\'],
    ['a delete of the index through a bracket glob', 'Bash', 'rm .nexus/rev[i]ews/index.json'],
    ['a write after a cd into the folder', 'Bash', 'cd .nexus/reviews && echo x > tidy.answers.json'],
    ['a copy after a cd into the folder', 'Bash', 'cd .nexus/reviews && cp ../../x/tidy.answers.json tidy.answers.json'],
    ['a write after two cds', 'Bash', 'cd .nexus && cd reviews && echo x > index.json'],
    ['a write after a Set-Location', 'PowerShell', "Set-Location .nexus\\reviews; Set-Content tidy.answers.json '{}'"],
    ['an index through a variable folder and an unknown name', 'Bash', 'D=.nexus/reviews; echo x > $D/$N.json'],
  ])('refuses %s', (_l, tool, command) => {
    const { root, home } = repo(build);
    seedForgeries(root);
    expect(reasonOf(guard(root, home, tool, { command }))).toMatch(/Only the cockpit writes review answers/);
  });
  it.each<[string, string, string]>([
    ['the folder through a bracket glob', 'Bash', 'rm -rf .nexus/rev[i]ews'],
    ['.nexus through a bracket glob', 'Bash', 'rm -rf .nexu[s]'],
    ['every dot folder', 'Bash', 'rm -rf .*'],
    ['every item, PowerShell matching dot names', 'PowerShell', 'Remove-Item * -Recurse -Force'],
  ])('refuses deleting %s', (_l, tool, command) => {
    const { root, home } = repo(build);
    expect(reasonOf(guard(root, home, tool, { command }))).toMatch(/would remove the repo's reviews/);
  });
  it('still allows a cd elsewhere, a return with popd, and JSON written through a folder it can\'t know', () => {
    const { root, home } = repo(build);
    mkdirSync(join(root, 'src'), { recursive: true });
    expect(guard(root, home, 'Bash', { command: 'cd src && echo x > a.ts' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'pushd .nexus/reviews; popd; echo x > a.txt' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'echo "{}" > $OUT/report.json # see .nexus' })).toBe('');
  });
});

describe('reviews with no build: what stays allowed', () => {
  it('lets bash\'s * pass over dot names, and copies of a config to a folder it can\'t know', () => {
    const { root, home } = repo(false);
    put(root, { 'src/a.ts': 'x', '.nexus/config.json': '{}' });
    expect(guard(root, home, 'Bash', { command: 'rm -rf *' })).toBe('');
    expect(guard(root, home, 'Bash', { command: 'cp .nexus/config.json $BK/' })).toBe('');
  });
});

describe("files a copy can't list", () => {
  it('are refused where they could land in the reviews, during a build', () => {
    const { root, home } = repo(true);
    expect(reasonOf(guard(root, home, 'Bash', { command: 'cp -r $F .' }))).toMatch(/can't list the files this copies into/);
    expect(reasonOf(guard(root, home, 'Bash', { command: 'cp -r $F/. .nexus' }))).toMatch(/can't list the files this copies into/);
    mkdirSync(join(root, 'out'), { recursive: true });
    expect(guard(root, home, 'Bash', { command: 'cp -r $F out/' })).toBe('');
  });
});

describe('creating the reviews folder from the shell', () => {
  it('is refused during a build, saying nexus creates it', () => {
    const bare = exampleRepo();
    mkdirSync(join(bare, '.nexus'), { recursive: true });
    expect(reasonOf(guard(bare, tempDir(), 'PowerShell', { command: 'New-Item -ItemType Directory .nexus\\reviews' }))).toMatch(/nexus creates \.nexus\/reviews\/ itself/);
  });
});
