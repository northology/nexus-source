import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../core/config.ts';
import { compileTargets, configTargets, DEFAULT_TARGETS, globToRegExp, matchAncestor, matchTarget, normalizePath, type TargetKind } from '../core/protect.ts';
import { tempDir } from './helpers.ts';

const WIN = { cwd: 'E:\\Work\\repo', home: 'C:\\Users\\dev', win: true };
const POSIX = { cwd: '/home/dev/repo', home: '/home/dev', win: false };

describe('normalizePath', () => {
  it.each([
    ['E:\\Work\\repo\\CLAUDE.md', 'e:/work/repo/claude.md'],
    ['/e/Work/repo/CLAUDE.md', 'e:/work/repo/claude.md'],
    ['e:/work/REPO/claude.md', 'e:/work/repo/claude.md'],
    ['CLAUDE.md', 'e:/work/repo/claude.md'],
    ['src\\..\\CLAUDE.md', 'e:/work/repo/claude.md'],
    ['"E:\\Work\\repo\\CLAUDE.md"', 'e:/work/repo/claude.md'],
    ['~/.claude/settings.json', 'c:/users/dev/.claude/settings.json'],
  ])('%s on Windows', (raw, expected) => {
    expect(normalizePath(raw, WIN)).toBe(expected);
  });
  it.each([
    '$HOME/.claude/projects/p/memory/x.md',
    '${HOME}/.claude/projects/p/memory/x.md',
    '$home\\.claude\\projects\\p\\memory\\x.md',
    '%USERPROFILE%\\.claude\\projects\\p\\memory\\x.md',
    '$env:USERPROFILE\\.claude\\projects\\p\\memory\\x.md',
    '"$env:UserProfile/.claude/projects/p/memory/x.md"',
    '$USERPROFILE/.claude/projects/p/memory/x.md',
  ])('expands the home variable in %s on Windows', (raw) => {
    expect(normalizePath(raw, WIN)).toBe('c:/users/dev/.claude/projects/p/memory/x.md');
    const all = compileTargets(DEFAULT_TARGETS, { root: WIN.cwd, home: WIN.home, win: true });
    expect(matchTarget(normalizePath(raw, WIN), all)?.pattern).toBe('.claude/projects/*/memory/**');
  });
  it('expands $HOME elsewhere, but not Windows variables or a longer name', () => {
    expect(normalizePath('$HOME/.claude/projects/p/memory/x.md', POSIX)).toBe('/home/dev/.claude/projects/p/memory/x.md');
    expect(normalizePath('${HOME}/x', POSIX)).toBe('/home/dev/x');
    expect(normalizePath('%USERPROFILE%/x', POSIX)).toBe('/home/dev/repo/%USERPROFILE%/x');
    expect(normalizePath('$HOMEDIR/x', POSIX)).toBe('/home/dev/repo/$HOMEDIR/x');
  });
  it('keeps case and leaves /e/ alone on other systems', () => {
    expect(normalizePath('CLAUDE.md', POSIX)).toBe('/home/dev/repo/CLAUDE.md');
    expect(normalizePath('/e/x', POSIX)).toBe('/e/x');
  });
});

describe('protected targets', () => {
  const win = compileTargets(DEFAULT_TARGETS, { root: WIN.cwd, home: WIN.home, win: true });
  const kind = (raw: string): TargetKind | null => matchTarget(normalizePath(raw, WIN), win)?.kind ?? null;
  it.each<[string, TargetKind | null]>([
    ['E:\\Work\\repo\\CLAUDE.md', 'rules'],
    ['/e/Work/repo/CLAUDE.md', 'rules'],
    ['e:/work/REPO/claude.md', 'rules'],
    ['src/../CLAUDE.md', 'rules'],
    ['packages/app/CLAUDE.md', 'rules'],
    ['E:\\Other\\CLAUDE.local.md', 'rules'],
    ['AGENTS.md', 'rules'],
    ['.claude/settings.json', 'rules'],
    ['.claude/settings.local.json', 'rules'],
    ['.claude/rules/web.md', 'rules'],
    ['C:\\Users\\dev\\.claude\\projects\\E--Work\\memory\\MEMORY.md', 'rules'],
    ['~/.claude/projects/E--Work/memory/notes/a.md', 'rules'],
    ['.nexus/config.json', 'rules'],
    ['.build/relay-rebuild/gates/scope.answers.json', 'answers'],
    ['.build/relay-rebuild/plan.json', 'build'],
    ['docs/superpowers/specs/x.md', 'superpowers'],
    ['docs/governance/decisions.json', 'record'],
    ['docs/governance/issues.json', 'record'],
    ['docs/governance/builds/relay-rebuild.md', 'record'],
    ['docs/governance/change/2026-10-relay.md', null],
    ['docs/governance/rules/x.md', null],
    ['docs/CLAUDE-notes.md', null],
    ['src/claude.mdx', null],
    ['.build/relay-rebuild/gates/scope.json', null],
    ['C:/Users/dev/.claude/projects/E--Work/notes.md', null],
    ['.claude/agents/helper.md', null],
    ['vendor/docs/superpowers/x.md', null],
    ['E:\\Other\\.nexus\\config.json', null],
    ['\\Work\\repo\\.nexus\\config.json', 'rules'],
    ['/Work/repo/.build/a/gates/s.answers.json', 'answers'],
    ['\\\\?\\E:\\Work\\repo\\.nexus\\config.json', 'rules'],
    ['\\\\.\\E:\\Work\\repo\\CLAUDE.md', 'rules'],
    ['\\\\?\\UNC\\localhost\\E$\\Work\\repo\\.nexus\\config.json', 'rules'],
    ['\\\\localhost\\E$\\Work\\repo\\.nexus\\config.json', 'rules'],
    ['\\\\127.0.0.1\\e$\\Work\\repo\\CLAUDE.md', 'rules'],
    ['CLAUDE.md.', 'rules'],
    ['.claude./rules/x.md', 'rules'],
    ['"CLAUDE.md "', 'rules'],
    ['\\Work\\other\\.nexus\\config.json', null],
  ])('%s → %s', (raw, expected) => {
    expect(kind(raw)).toBe(expected);
  });
  it('is case-sensitive where the file system is', () => {
    const posix = compileTargets(DEFAULT_TARGETS, { root: POSIX.cwd, home: POSIX.home, win: false });
    expect(matchTarget(normalizePath('CLAUDE.md', POSIX), posix)?.kind).toBe('rules');
    expect(matchTarget(normalizePath('claude.md', POSIX), posix)).toBeNull();
    expect(matchTarget(normalizePath('/home/dev/.claude/projects/p/memory/x.md', POSIX), posix)?.kind).toBe('rules');
  });
  it('adds repo config targets: relative to the root, from home, or absolute', () => {
    const extra = compileTargets(configTargets(['.remember/**', '~/notes/rules.md', 'E:/Shared/rules/**']), { root: WIN.cwd, home: WIN.home, win: true });
    for (const raw of ['.remember/now.md', 'C:\\Users\\dev\\notes\\rules.md', 'E:\\Shared\\rules\\a.md']) {
      expect(matchTarget(normalizePath(raw, WIN), extra)?.kind, raw).toBe('rules');
    }
    expect(matchTarget(normalizePath('src/.remember/x.md', WIN), extra)).toBeNull();
  });
  it('normalizes a config pattern with a trailing slash', () => {
    const extra = compileTargets(configTargets(['.remember/']), { root: WIN.cwd, home: WIN.home, win: true });
    expect(matchTarget(normalizePath('.remember/now.md', WIN), extra)?.kind).toBe('rules');
  });
  it.each<[string, string | null]>([
    ['.claude', '.claude/settings*.json'],
    ['.claude/rules', '.claude/rules/**'],
    ['packages/app/.claude', '.claude/settings*.json'],
    ['.build', '.build/*/gates/*.answers.json'],
    ['.build/relay-rebuild', '.build/*/gates/*.answers.json'],
    ['.build/relay-rebuild/gates', '.build/*/gates/*.answers.json'],
    ['docs', 'docs/superpowers/**'],
    ['docs/governance', 'docs/governance/decisions.json'],
    ['docs/governance/builds', 'docs/governance/builds/**'],
    ['C:\\Users\\dev\\.claude', '.claude/settings*.json'],
    ['C:\\Users\\dev\\.claude\\projects\\p', '.claude/projects/*/memory/**'],
    ['E:\\Work\\repo', '.nexus/config.json'],
    ['node_modules', null],
    ['packages', null],
    ['.claude/agents', null],
    ['.build/relay-rebuild/files', null],
    ['src/docs', null],
  ])('%s holds protected files: %s', (raw, pattern) => {
    expect(matchAncestor(normalizePath(raw, WIN), win)?.pattern ?? null).toBe(pattern);
  });
  it('finds ancestors of posix and repo config patterns', () => {
    const posix = compileTargets([...DEFAULT_TARGETS, ...configTargets(['.remember/**'])], { root: POSIX.cwd, home: POSIX.home, win: false });
    expect(matchAncestor('/', posix)).not.toBeNull();
    expect(matchAncestor('/home/dev/repo/.remember', posix)?.pattern).toBe('.remember/**');
    expect(matchAncestor('/home/dev/repo/src', posix)).toBeNull();
  });
  it('matches paths with newlines', () => {
    const all = compileTargets(DEFAULT_TARGETS, { root: WIN.cwd, home: WIN.home, win: true });
    expect(matchTarget(normalizePath('.claude/rules/a\nb.md', WIN), all)?.kind).toBe('rules');
  });
});

describe('readConfig', () => {
  const withConfig = (text: string) => {
    const root = tempDir();
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus', 'config.json'), text);
    return root;
  };
  it('is empty with no config', () => {
    expect(readConfig(tempDir())).toEqual({ config: { staticRules: [], protect: [] }, problem: null });
  });
  it('reads static rules and extra targets', () => {
    const root = withConfig(JSON.stringify({ staticRules: ['CLAUDE.md', '../.claude/rules/working.md'], protect: ['.remember/**'] }));
    expect(readConfig(root)).toEqual({ config: { staticRules: ['CLAUDE.md', '../.claude/rules/working.md'], protect: ['.remember/**'] }, problem: null });
  });
  it('names the problem with a bad config and falls back to the defaults', () => {
    expect(readConfig(withConfig(JSON.stringify({ staticRules: ['rules/*.md'] }))).problem).toMatch(/staticRules/);
    expect(readConfig(withConfig(JSON.stringify({ staticRules: ['rules.txt'] }))).problem).toMatch(/staticRules/);
    expect(readConfig(withConfig('{ nope')).problem).toMatch(/not valid JSON/);
    expect(readConfig(withConfig('{ nope')).config).toEqual({ staticRules: [], protect: [] });
  });
});

describe('the docs vault registry', () => {
  it('is a default target at the repo root only', () => {
    const all = compileTargets(DEFAULT_TARGETS, { root: WIN.cwd, home: WIN.home, win: true });
    expect(matchTarget(normalizePath('docs\\_meta\\classes\\decision.md', WIN), all)?.pattern).toBe('docs/_meta/**');
    expect(matchTarget(normalizePath('docs\\_meta\\tags.md', WIN), all)?.kind).toBe('rules');
    expect(matchTarget(normalizePath('packages\\app\\docs\\_meta\\tags.md', WIN), all)).toBeNull();
    expect(matchTarget(normalizePath('standard\\classes\\decision.md', WIN), all)).toBeNull();
    expect(matchTarget(normalizePath('docs\\governance\\decisions\\x.md', WIN), all)).toBeNull();
  });
});

describe('globToRegExp brackets', () => {
  it('reads a bracket expression as a class, and an unclosed bracket as itself', () => {
    expect(globToRegExp('rev[i]ews').test('reviews')).toBe(true);
    expect(globToRegExp('rev[a-z]ews').test('reviews')).toBe(true);
    expect(globToRegExp('rev[!i]ews').test('reviews')).toBe(false);
    expect(globToRegExp('rev[^x]ews').test('reviews')).toBe(true);
    expect(globToRegExp('a[b').test('a[b')).toBe(true);
    expect(globToRegExp('[r]eviews/*').test('reviews/a/b')).toBe(false);
  });
});
