import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBuild, readBuild, writeBuild } from '../core/build.ts';
import { buildRecordPath, decommissionGateName, reportDraft } from '../core/decommission/paths.ts';
import { buildCommits, decommissionProblems } from '../core/decommission/record.ts';
import { openGate } from '../core/gates.ts';
import { git, revParse } from '../core/git.ts';
import { commitAll, gitRepo } from './git-helpers.ts';
import { BUILD, finishedBuild, prepareTemplate, put } from './decommission-helpers.ts';
import { LATER } from './helpers.ts';

beforeAll(() => void prepareTemplate());
afterEach(() => vi.unstubAllEnvs());

describe('decommission paths', () => {
  it('names the gate, the report draft and where the final report lands', () => {
    expect(decommissionGateName('proof-board')).toBe('decommission-proof-board');
    expect(reportDraft('proof-board')).toBe('documents/reports/proof-board final report.md');
    expect(buildRecordPath('proof-board')).toBe('docs/governance/builds/proof-board.md');
  });
});

describe('buildCommits', () => {
  it('derives the base and the final commit from git', () => {
    const { root } = finishedBuild();
    const added = git(root, ['log', '--diff-filter=A', '--format=%H', '--reverse', '--', `.build/${BUILD}/build.json`]).split('\n')[0] ?? '';
    expect(buildCommits(root, BUILD)).toEqual({ base: git(root, ['rev-parse', `${added}^`]), final: revParse(root, 'HEAD') });
  });
  it('says when the build folder was never committed', () => {
    const repo = gitRepo();
    createBuild(repo.root, { name: 'fresh', branch: 'build/fresh', now: LATER });
    expect(() => buildCommits(repo.root, 'fresh')).toThrow(".build/fresh/build.json was never committed, so the build's first commit can't be found");
  });
});

describe('decommissionProblems', () => {
  it('reports a build that does not exist', () => {
    const { root } = finishedBuild();
    expect(decommissionProblems(root, 'no-such-build', 'check')).toEqual(['No build named "no-such-build"']);
  });
  it('has none for a finished build at check', () => {
    expect(decommissionProblems(finishedBuild().root, BUILD, 'check')).toEqual([]);
  });
  it('refuses a build whose last phase is still open', () => {
    const { root } = finishedBuild();
    writeBuild(root, { ...readBuild(root, BUILD), stage: 'build' });
    expect(decommissionProblems(root, BUILD, 'check')).toEqual([`build "${BUILD}" isn't finished: its last phase (phase-two) must be in close-out, with its finish gate approved`]);
  });
  it('refuses while another build is active', () => {
    const { root, env } = finishedBuild();
    createBuild(root, { name: 'side-quest', branch: 'build/side-quest', now: LATER });
    commitAll(root, 'Start a side quest', env);
    expect(decommissionProblems(root, BUILD, 'check')).toEqual(['another build is still active here (side-quest): decommission a build once no other is running']);
  });
  it('names a gate that is still unapplied, but not the decommission gate itself', () => {
    const { root } = finishedBuild();
    openGate(root, BUILD, { name: 'late-check', type: 'approve', title: 'Late check', why: 'One more look.' }, LATER);
    put(root, { [`.build/${BUILD}/${reportDraft(BUILD)}`]: '# Report\n' });
    openGate(root, BUILD, { name: decommissionGateName(BUILD), step: 'decommission', type: 'mark-list', title: 'Decommission', why: 'Mark.', document: reportDraft(BUILD), items: [{ name: 'explicit-commits', text: 'Elevate it' }] }, LATER);
    expect(decommissionProblems(root, BUILD, 'check')).toEqual(['gates not applied yet: late-check (run `nexus gate apply` once the user answers each)']);
  });
  it('refuses a repo with no vault, and a vault newer than this nexus', () => {
    const none = finishedBuild();
    rmSync(join(none.root, 'docs', '_meta'), { recursive: true });
    commitAll(none.root, 'Remove the vault', none.env);
    expect(decommissionProblems(none.root, BUILD, 'check')).toEqual(['this repo has no docs/ vault (docs/_meta/classes/): set one up with `nexus init`']);
    const newer = finishedBuild();
    writeFileSync(join(newer.root, 'docs', '_meta', 'contract.md'), '---\ncontract: 99\n---\n# Contract\n');
    commitAll(newer.root, 'A newer vault', newer.env);
    expect(decommissionProblems(newer.root, BUILD, 'check')).toEqual(['the vault follows contract 99; this nexus supports 3. Update nexus.']);
  });
  it('refuses a vault whose contract.md is missing or unparseable', () => {
    const message = "the vault's docs/_meta/contract.md is missing or unreadable: it names the contract the vault follows, and decommission needs one this nexus supports";
    const gone = finishedBuild();
    rmSync(join(gone.root, 'docs', '_meta', 'contract.md'));
    commitAll(gone.root, 'Lose the contract', gone.env);
    expect(decommissionProblems(gone.root, BUILD, 'check')).toEqual([message]);
    const bad = finishedBuild();
    writeFileSync(join(bad.root, 'docs', '_meta', 'contract.md'), 'not a contract\n');
    commitAll(bad.root, 'Break the contract', bad.env);
    expect(decommissionProblems(bad.root, BUILD, 'check')).toEqual([message]);
  });
  it('names uncommitted changes outside the build folder, untracked and modified, but not a draft inside it', () => {
    const { root } = finishedBuild();
    writeFileSync(join(root, 'notes.txt'), 'scratch\n');
    writeFileSync(join(root, 'docs', 'dev', 'systems', 'relay.md'), 'edited\n');
    put(root, { [`.build/${BUILD}/${reportDraft(BUILD)}`]: '# Report\n' });
    expect(decommissionProblems(root, BUILD, 'check')).toEqual([`uncommitted changes outside .build/${BUILD}/: docs/dev/systems/relay.md, notes.txt (commit or move them first)`]);
  });
  it('passes over an uncommitted .build/.gitattributes, which nexus new writes beside the builds', () => {
    const { root, env } = finishedBuild();
    git(root, ['rm', '-q', '--cached', '.build/.gitattributes']);
    git(root, ['commit', '-q', '-m', 'Untrack the attributes'], { env });
    expect(git(root, ['status', '--porcelain'])).toBe('?? .build/.gitattributes');
    expect(decommissionProblems(root, BUILD, 'check')).toEqual([]);
  });
  it('names files git ignores in the build folder, since decommission would delete them for good', () => {
    const { root, env } = finishedBuild();
    put(root, { '.gitignore': '*.tmp\nlogs/\n' });
    commitAll(root, 'Ignore scratch files', env);
    put(root, { [`.build/${BUILD}/logs/session.tmp`]: 'x\n', [`.build/${BUILD}/notes/[draft].tmp`]: 'y\n', 'outside.tmp': 'z\n' });
    expect(decommissionProblems(root, BUILD, 'check')).toEqual([
      `git ignores these files in the build folder, so decommission would delete them for good: .build/${BUILD}/logs/session.tmp, .build/${BUILD}/notes/[draft].tmp; move them out of the build folder, or stop ignoring them`,
    ]);
  });
  it.each(['.claude/', '.claude/rules/nexus/', '/.claude'])('names .claude/rules/nexus/ when git ignores it (%s), since the generated rule files land there', (pattern) => {
    const { root, env } = finishedBuild();
    put(root, { '.gitignore': `${pattern}\n` });
    commitAll(root, 'Ignore Claude settings', env);
    expect(decommissionProblems(root, BUILD, 'check')).toEqual(["git ignores .claude/rules/nexus/, where decommission writes the generated rule files; stop ignoring it first"]);
  });
  it('at apply, also needs the decommission gate applied, and takes changes only in docs/, the rules folder and the build', () => {
    const { root } = finishedBuild();
    put(root, { 'notes.txt': 'scratch\n', 'docs/governance/rules/a.md': '# A\n', '.claude/rules/nexus/a.md': '# A\n', [`.build/${BUILD}/${reportDraft(BUILD)}`]: '# Report\n' });
    expect(decommissionProblems(root, BUILD, 'apply')).toEqual([
      `${decommissionGateName(BUILD)} isn't open yet: open it with the final report attached (/nexus:decommission step 3), and the user answers it in the cockpit`,
      `uncommitted changes outside docs/, .claude/rules/nexus/ and .build/${BUILD}/: notes.txt (commit or move them first: the decommission commit takes only those three)`,
    ]);
  });
  it('runs on whatever branch is checked out', () => {
    const { root } = finishedBuild();
    git(root, ['checkout', '-q', '-b', 'elsewhere']);
    expect(decommissionProblems(root, BUILD, 'check')).toEqual([]);
  });
  it('refuses a subfolder of a larger repository', () => {
    const { root } = finishedBuild();
    const inner = join(root, 'packages', 'inner');
    mkdirSync(inner, { recursive: true });
    cpSync(join(root, '.build'), join(inner, '.build'), { recursive: true });
    expect(decommissionProblems(inner, BUILD, 'check').at(-1)).toBe(`this folder isn't the repository root; decommission runs from ${git(root, ['rev-parse', '--show-toplevel'])}`);
  });
  it('refuses a folder that is not a git repository', () => {
    const { root } = finishedBuild();
    rmSync(join(root, '.git'), { recursive: true, force: true });
    expect(decommissionProblems(root, BUILD, 'check')).toEqual(["this folder isn't a git repository; decommission lands its changes as one commit"]);
  });
});
