import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTopics, openedPages } from '../core/concept-pages.ts';
import { NexusError } from '../core/errors.ts';
import { openPermits } from '../core/permits.ts';
import { runGuard } from '../hooks/guard.ts';
import { EXAMPLES, exampleRepo, finishPhase, tempDir } from './helpers.ts';

const B = 'relay-rebuild';
const HOME = tempDir('nexus-home-');
const WIN = process.platform === 'win32';
const AT = new Date('2026-10-02T20:10:00Z');
const guard = (cwd: string, tool: string, toolInput: unknown) => runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home: HOME, win: WIN, now: AT, env: {} });
const reason = (out: string) => (out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '' : '');
const denied = (out: string) => reason(out) !== '';
const breakGates = (root: string) => {
  const gates = join(root, '.build', B, 'gates');
  rmSync(gates, { recursive: true, force: true });
  writeFileSync(gates, 'not a folder');
};

describe('the wall’s build rules', () => {
  it('a closed repo nested in an active one is walled by the active one', () => {
    const outer = exampleRepo();
    const inner = join(outer, 'packages', 'inner');
    mkdirSync(inner, { recursive: true });
    cpSync(join(EXAMPLES, '.build'), join(inner, '.build'), { recursive: true });
    finishPhase(inner);
    expect(denied(guard(inner, 'Write', { file_path: join(inner, 'CLAUDE.md') }))).toBe(true);
    expect(denied(guard(outer, 'Write', { file_path: join(inner, 'CLAUDE.md') }))).toBe(true);
  });
  it('a closed repo with no active repo above it stays open', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(guard(root, 'Write', { file_path: join(root, 'CLAUDE.md') })).toBe('');
  });
  it('a glob remove that would take an opened page is refused', () => {
    const root = exampleRepo();
    expect(denied(guard(root, 'Bash', { command: 'rm .build/relay-rebuild/concepts/*' }))).toBe(true);
    expect(denied(guard(root, 'Bash', { command: 'rm .build/relay-rebuild/concepts/quiet-*.html' }))).toBe(true);
  });
  it('a glob remove that would take a protected file on disk is refused, and one that takes none is allowed', () => {
    const root = exampleRepo();
    writeFileSync(join(root, 'CLAUDE.md'), '# rules');
    writeFileSync(join(root, 'a.log'), '');
    expect(denied(guard(root, 'Bash', { command: 'rm CLAUDE.*' }))).toBe(true);
    expect(guard(root, 'Bash', { command: 'rm *.log' })).toBe('');
  });
  it('opened pages are walled only while their own build is active', () => {
    const root = exampleRepo();
    // A second build in the same repo, finished, with the same opened pages.
    cpSync(join(root, '.build', B), join(root, '.build', 'old-build'), { recursive: true });
    const file = join(root, '.build', 'old-build', 'build.json');
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), name: 'old-build' }));
    finishPhase(root, 'old-build');
    expect(guard(root, 'Write', { file_path: join(root, '.build', 'old-build', 'concepts', 'quiet-board.html') })).toBe('');
    expect(denied(guard(root, 'Write', { file_path: join(root, '.build', B, 'concepts', 'quiet-board.html') }))).toBe(true);
  });
  it('names an opened page by its build path, not the gate’s spelling', () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', B, 'concepts', 'odd.html'), '<p>odd</p>');
    const gate = { name: 'odd', type: 'concept-pick', title: 'Odd round', why: 'w', options: [{ name: 'a', label: 'A', page: 'concepts\\.\\odd.html' }, { name: 'b', label: 'B', page: 'concepts/dense-table.html' }] };
    writeFileSync(join(root, '.build', B, 'gates', 'odd.json'), JSON.stringify(gate));
    const out = guard(root, 'Write', { file_path: join(root, '.build', B, 'concepts', 'odd.html') });
    expect(reason(out)).toMatch(/^concepts\/odd\.html is in round "Odd round"/);
  });
  it('refuses a concept-page write when the gates folder can’t be read', () => {
    const root = exampleRepo();
    breakGates(root);
    expect(reason(guard(root, 'Write', { file_path: join(root, '.build', B, 'concepts', 'new.html') }))).toMatch(/can't read the gates of build "relay-rebuild"/);
  });
});

describe('unreadable gates folders', () => {
  it('opened pages and permits name the folder instead of crashing', () => {
    const root = exampleRepo();
    breakGates(root);
    expect(() => openedPages(root, B)).toThrow(NexusError);
    expect(() => openedPages(root, B)).toThrow(/Can't read .*gates/);
    expect(() => openPermits(root, AT)).toThrow(NexusError);
  });
});

describe('buildTopics', () => {
  it('sorts topics and skips requests that aren’t objects', () => {
    const root = exampleRepo();
    const gates = join(root, '.build', B, 'gates');
    const pick = (name: string, topic: string) => ({ name, type: 'concept-pick', topic, title: 't', why: 'w', options: [{ name: 'a', label: 'A', page: 'concepts/quiet-board.html' }, { name: 'b', label: 'B', page: 'concepts/dense-table.html' }] });
    writeFileSync(join(gates, 'b-gate.json'), JSON.stringify(pick('b-gate', 'zeta')));
    writeFileSync(join(gates, 'a-gate.json'), JSON.stringify(pick('a-gate', 'alpha')));
    writeFileSync(join(gates, 'list.json'), '[]');
    writeFileSync(join(gates, 'text.json'), '"x"');
    writeFileSync(join(gates, 'nothing.json'), 'null');
    expect(buildTopics(root, B)).toEqual(['alpha', 'look', 'zeta']);
    expect(openedPages(root, B).every((p) => typeof p.page === 'string')).toBe(true);
  });
});
