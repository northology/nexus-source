import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runGuard } from '../hooks/guard.ts';
import { exampleRepo, tempDir } from './helpers.ts';
import { put } from './governance-helpers.ts';

// The wall during a build, against writes that reach protected files by a recursive copy, a cd or a glob.
const WIN = process.platform === 'win32';
const NOW = new Date('2026-10-02T20:10:00Z');
const B = '.build/relay-rebuild';

function guard(cwd: string, tool: string, command: string): string {
  return runGuard({ cwd, tool_name: tool, tool_input: { command } }, { home: tempDir(), win: WIN, now: NOW });
}
const reasonOf = (out: string): string => (out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput['permissionDecisionReason'] ?? '' : '');

/** The example build (active), with a CLAUDE.md, a rule file and folders a copy could carry answers out of. */
function building(): string {
  const root = exampleRepo();
  put(root, {
    'CLAUDE.md': '# Repo\n',
    '.claude/rules/old.md': '# Old\n',
    'x/look.answers.json': '{}',
    'x/forged/look.answers.json': '{}',
    'x/gated/.build/relay-rebuild/gates/look.answers.json': '{}',
    'x/relay-rebuild/gates/look.answers.json': '{}',
  });
  return root;
}

describe('gate answers carried in during a build', () => {
  it.each<[string, string, string]>([
    ["a copy of a folder's contents into the gates folder", 'Bash', `cp -r x/forged/. ${B}/gates`],
    ["a copy of a folder's contents into the repo", 'Bash', 'cp -r x/gated/. .'],
    ["a copy of a folder's contents into the build", 'Bash', `cp -r x/relay-rebuild/. ${B}`],
    ['a copy into a bracket glob of the gates folder', 'Bash', `cp x/look.answers.json ${B}/gat[e]s/`],
    ['a copy into a star glob of the gates folder', 'Bash', `cp x/look.answers.json ${B}/gat*s/`],
    ['a copy into a ? glob of the gates folder', 'Bash', `cp x/look.answers.json ${B}/gat?s/`],
    ['a copy over an answers file a ? glob names', 'Bash', `cp x/look.answers.json ${B}/gates/scope.answers.jso?`],
    ['a copy after a cd into the gates folder', 'Bash', `cd ${B}/gates && cp ../../../x/look.answers.json look.answers.json`],
  ])('refuses %s', (_l, tool, command) => {
    expect(reasonOf(guard(building(), tool, command))).toMatch(/Only the cockpit writes gate answers/);
  });
  it('refuses a copy of an unknown file into the gates folder', () => {
    expect(reasonOf(guard(building(), 'Bash', `cp $F ${B}/gates/`))).toMatch(/Only the cockpit writes gate answers/);
  });
  it("refuses files it can't list copied into the repo, and allows them into a folder that holds nothing protected", () => {
    const root = building();
    expect(reasonOf(guard(root, 'Bash', 'cp -r $F/. .'))).toMatch(/Copying files nexus can't list into/);
    expect(reasonOf(guard(root, 'Bash', `cp -r $F ${B}`))).toMatch(/Copying files nexus can't list into/);
    mkdirSync(join(root, 'out'), { recursive: true });
    expect(guard(root, 'Bash', 'cp -r $F out/')).toBe('');
    expect(guard(root, 'Bash', 'cp -r x/forged out/')).toBe('');
  });
});

describe('permanent rules reached by a glob or a cd during a build', () => {
  it.each<[string, string]>([
    ['echo x > CLAUDE.m?', 'a ? glob'],
    ['echo x > CLAUD*.md', 'a star glob'],
    ['echo x > CLAUDE.m[d]', 'a bracket glob'],
    ['echo x > .claude/rul*s/old.md', 'a glob in a folder'],
    ['cd .claude/rules && echo x > a.md', 'a cd'],
  ])('refuses %s (%s)', (command) => {
    expect(reasonOf(guard(building(), 'Bash', command))).toMatch(/Permanent rules can't change/);
  });
  it('refuses deleting the rules folder through a bracket glob', () => {
    expect(reasonOf(guard(building(), 'Bash', 'rm -rf .claude/rul[e]s'))).toMatch(/would take protected files/);
  });
  it('still allows a cd elsewhere, then work there', () => {
    const root = building();
    mkdirSync(join(root, 'dist', 'old'), { recursive: true });
    expect(guard(root, 'Bash', 'cd dist && rm -rf *')).toBe('');
    expect(guard(root, 'Bash', 'cd dist && echo x > a.js')).toBe('');
  });
});
