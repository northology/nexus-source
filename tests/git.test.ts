import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentBranch, dirtyPaths, fileAddedCommit, git, gitTry, insideGit, revParse } from '../core/git.ts';
import { NexusError } from '../core/errors.ts';
import { commitAll, gitRepo } from './git-helpers.ts';
import { tempDir } from './helpers.ts';

function put(root: string, rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

describe('git', () => {
  it('returns trimmed stdout, and throws a NexusError carrying git\'s message', () => {
    const { root, env } = gitRepo();
    commitAll(root, 'first', env);
    expect(git(root, ['log', '-1', '--format=%s'], { env })).toBe('first');
    expect(() => git(root, ['rev-parse', '--verify', 'no-such-ref'], { env })).toThrow(NexusError);
    expect(() => git(root, ['rev-parse', '--verify', 'no-such-ref'], { env })).toThrow(/no-such-ref|fatal/);
  });
  it('gitTry reports failure instead of throwing', () => {
    const { root, env } = gitRepo();
    expect(gitTry(root, ['rev-parse', '--verify', 'HEAD'], { env })).toMatchObject({ ok: false });
    commitAll(root, 'first', env);
    expect(gitTry(root, ['rev-parse', '--verify', 'HEAD'], { env })).toMatchObject({ ok: true, out: expect.stringMatching(/^[0-9a-f]{40}$/) as unknown });
  });
  it('gitTry keeps stdout untrimmed when asked, so a first path that starts with a space survives', () => {
    const { root, env } = gitRepo();
    put(root, ' lead.txt', 'x\n');
    expect(gitTry(root, ['ls-files', '--others', '-z'], { env })).toEqual({ ok: true, out: 'lead.txt\0' });
    expect(gitTry(root, ['ls-files', '--others', '-z'], { env, raw: true })).toEqual({ ok: true, out: ' lead.txt\0' });
  });
  it('passes maxBuffer through: output past it fails the call with the buffer error', () => {
    const { root, env } = gitRepo();
    expect(gitTry(root, ['--version'], { env })).toMatchObject({ ok: true });
    expect(gitTry(root, ['--version'], { env, maxBuffer: 1 })).toEqual({ ok: false, err: expect.stringContaining('ENOBUFS') as unknown });
  });
  it('merges the given environment over this process\'s, and drops a variable given as undefined', () => {
    const { root, env } = gitRepo();
    commitAll(root, 'first', env);
    expect(git(root, ['var', 'GIT_AUTHOR_IDENT'], { env: { ...env, GIT_AUTHOR_NAME: 'Someone Else' } })).toMatch(/^Someone Else <author@example.com>/);
    // GIT_CONFIG_COUNT/KEY/VALUE add config from the environment: set in this process, then dropped for one call.
    const fromEnv = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'From Env' };
    Object.assign(process.env, fromEnv);
    try {
      expect(git(root, ['config', '--get', 'user.name'], { env })).toBe('From Env');
      expect(gitTry(root, ['config', '--get', 'user.name'], { env: { ...env, GIT_CONFIG_COUNT: undefined } })).toMatchObject({ ok: false });
    } finally {
      for (const k of Object.keys(fromEnv)) delete process.env[k];
    }
  });
});

describe('repo facts', () => {
  it('knows a repo from a plain folder', () => {
    const { root } = gitRepo();
    expect(insideGit(root)).toBe(true);
    expect(insideGit(tempDir('nexus-plain-'))).toBe(false);
  });
  it('names the branch, or null when detached', () => {
    const { root, env } = gitRepo();
    commitAll(root, 'first', env);
    expect(currentBranch(root)).toBe('main');
    git(root, ['checkout', '-q', '--detach'], { env });
    expect(currentBranch(root)).toBeNull();
    expect(currentBranch(tempDir('nexus-plain-'))).toBeNull();
  });
  it('resolves refs to commits, and null for a missing one', () => {
    const { root, env } = gitRepo();
    const head = commitAll(root, 'first', env);
    expect(revParse(root, 'main')).toBe(head);
    expect(revParse(root, 'no-such-branch')).toBeNull();
  });
  it('finds the commit that first added a path, even after later edits', () => {
    const { root, env } = gitRepo();
    commitAll(root, 'empty', env);
    put(root, '.build/proof/build.json', '{}\n');
    const added = commitAll(root, 'add the build', env);
    put(root, '.build/proof/build.json', '{"stage":"build"}\n');
    commitAll(root, 'edit the build', env);
    expect(fileAddedCommit(root, '.build/proof/build.json')).toBe(added);
    expect(fileAddedCommit(root, '.build/other/build.json')).toBeNull();
  });
});

describe('dirtyPaths', () => {
  it('lists modified, staged and untracked files outside the given prefixes, spaces included', () => {
    const { root, env } = gitRepo();
    put(root, 'tracked.txt', 'one\n');
    put(root, 'old name.md', 'x\n');
    commitAll(root, 'first', env);
    expect(dirtyPaths(root, [])).toEqual([]);
    put(root, 'tracked.txt', 'two\n');
    put(root, 'docs/a note.md', 'new\n');
    put(root, '.build/proof/decommission/manifest.json', '{}\n');
    put(root, '.build/proofs/stray.json', '{}\n');
    git(root, ['mv', 'old name.md', 'new name.md'], { env });
    expect(dirtyPaths(root, ['.build/proof'])).toEqual(['.build/proofs/stray.json', 'docs/a note.md', 'new name.md', 'old name.md', 'tracked.txt']);
    expect(dirtyPaths(root, ['.build/proof/', 'docs'])).toEqual(['.build/proofs/stray.json', 'new name.md', 'old name.md', 'tracked.txt']);
  });
  it('throws a NexusError outside a repo', () => {
    expect(() => dirtyPaths(tempDir('nexus-plain-'), [])).toThrow(NexusError);
  });
});
