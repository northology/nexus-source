import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeBuilds } from '../core/lifecycle.ts';
import { buildInProgress, candidateFolders, hasBuildDir, runLoader } from '../scripts/guard-loader.ts';
import { EXAMPLES, exampleRepo, finishPhase, tempDir } from './helpers.ts';
import { antigravityAdapter } from '../hooks/adapters/antigravity.ts';
import { codexAdapter } from '../hooks/adapters/codex.ts';

const broken = () => Promise.reject(new Error('bundle failed to load'));
type Load = Parameters<typeof runLoader>[1]['load'];
const deps = (cwd: string, load: Load = broken) => ({ cwd, load, home: tempDir(), win: process.platform === 'win32', now: new Date() });
const input = (cwd: string, tool: string, tool_input: unknown) => JSON.stringify({ cwd, tool_name: tool, tool_input });
const closeOut = (root: string) => writeFileSync(join(root, '.build', 'relay-rebuild', 'build.json'), JSON.stringify({ name: 'relay-rebuild', stage: 'close-out', phase: 'replay' }));

describe('the guard loader', () => {
  it("names the session folder and the written file's folder", () => {
    const a = tempDir();
    const b = tempDir();
    expect(candidateFolders({ cwd: a, tool_name: 'Write', tool_input: { file_path: join(b, 'c', 'CLAUDE.md') } }, b)).toEqual([a, join(b, 'c')]);
    expect(candidateFolders({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(b, 'x.ipynb') } }, a)).toEqual([a, b]);
    expect(candidateFolders('garbage', a)).toEqual([a]);
  });
  it('sees a .build/ folder at or above a folder', () => {
    expect(hasBuildDir(join(exampleRepo(), 'src'))).toBe(true);
    expect(hasBuildDir(tempDir())).toBe(false);
  });
  it('agrees with activeBuilds on whether a build is in progress', () => {
    const live = exampleRepo();
    const done = exampleRepo();
    finishPhase(done);
    const staged = exampleRepo();
    closeOut(staged); // close-out written by hand, with no approved finish gate: still in progress
    // Close-out, but its phase isn't a name: activeBuilds keeps the wall up even with an approved finish gate named
    // after the build, so the loader must too.
    const odd = exampleRepo();
    finishPhase(odd);
    const file = join(odd, '.build', 'relay-rebuild', 'build.json');
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), phase: 42 }));
    writeFileSync(join(odd, '.build', 'relay-rebuild', 'gates', 'finish-relay-rebuild.answers.json'), JSON.stringify({ gate: 'finish-relay-rebuild', decision: 'approve' }));
    for (const root of [live, done, staged, odd]) expect(buildInProgress(root), root).toBe(activeBuilds(root).length > 0);
    expect([live, done, staged, odd].map(buildInProgress)).toEqual([true, false, true, true]);
  });
  it('counts an unreadable build.json as in progress', () => {
    const root = tempDir();
    mkdirSync(join(root, '.build', 'x'), { recursive: true });
    writeFileSync(join(root, '.build', 'x', 'build.json'), '{ not json');
    expect(buildInProgress(root)).toBe(true);
  });
  it('sees a build in progress further up, past a finished nested repo', () => {
    const outer = exampleRepo();
    const inner = join(outer, 'packages', 'inner');
    cpSync(join(EXAMPLES, '.build'), join(inner, '.build'), { recursive: true });
    finishPhase(inner);
    expect(buildInProgress(inner)).toBe(true);
  });
  it('exits silently without loading the guard where there is no .build/', async () => {
    const cwd = tempDir();
    let loaded = false;
    const r = await runLoader(input(cwd, 'Write', { file_path: join(cwd, 'CLAUDE.md') }), deps(cwd, () => ((loaded = true), broken())));
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(loaded).toBe(false);
  });
  it('loads the guard for a write into another repo that has a build', async () => {
    const cwd = tempDir();
    const live = exampleRepo();
    const r = await runLoader(input(cwd, 'Write', { file_path: join(live, 'CLAUDE.md') }), deps(cwd));
    expect(r.code).toBe(2);
  });
  it.runIf(process.platform === 'win32')('loads the guard for msys, cygdrive and mnt spellings of a file in a repo with a build', async () => {
    const cwd = tempDir();
    const live = exampleRepo();
    const drive = live.slice(0, 1).toLowerCase();
    const rest = live.slice(2).replace(/\\/g, '/');
    for (const spelling of [`/${drive}${rest}/CLAUDE.md`, `/cygdrive/${drive}${rest}/CLAUDE.md`, `/mnt/${drive}${rest}/CLAUDE.md`]) {
      const r = await runLoader(input(cwd, 'Write', { file_path: spelling }), deps(cwd));
      expect(r.code, spelling).toBe(2);
    }
  });
  it("refuses with exit 2 when the guard can't load in a repo with a build in progress", async () => {
    const live = exampleRepo();
    const r = await runLoader(input(live, 'Write', { file_path: join(live, 'src', 'a.ts') }), deps(live));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^The nexus wall couldn't run, so it refused this write\. Run `nexus doctor guard` to see why\. \(bundle failed to load\)/);
  });
  it("stays silent when the guard can't load in a repo whose build is finished", async () => {
    const done = exampleRepo();
    finishPhase(done);
    const r = await runLoader(input(done, 'Bash', { command: 'rm CLAUDE.md' }), deps(done));
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
  });
  it('refuses on unreadable input in a repo with a build in progress, using the process folder', async () => {
    const live = exampleRepo();
    const r = await runLoader(new Error('stdin closed'), deps(live, () => Promise.resolve({ runGuard: () => '' })));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/\(stdin closed\)/);
  });
  it("passes the guard's answer through", async () => {
    const live = exampleRepo();
    const r = await runLoader(input(live, 'Write', { file_path: 'x' }), deps(live, () => Promise.resolve({ runGuard: () => '{"deny":1}' })));
    expect(r).toEqual({ code: 0, stdout: '{"deny":1}', stderr: '' });
  });
  it('refuses when the guard itself throws in a repo with a build in progress', async () => {
    const live = exampleRepo();
    const thrower = () => Promise.resolve({ runGuard: (): string => { throw new Error('guard blew up'); } });
    const r = await runLoader(input(live, 'Write', { file_path: 'x' }), deps(live, thrower));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/\(guard blew up\)/);
  });
});

describe('hook input that is not JSON', () => {
  const agy = (cwd: string) => ({ ...deps(cwd), adapter: antigravityAdapter });
  const named = (root: string) => `{"workspacePaths":[${JSON.stringify(root)}], broken`;
  it('Antigravity: non-JSON input naming a workspace with a build is refused', async () => {
    const r = await runLoader(named(exampleRepo()), agy(tempDir()));
    expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'deny' });
  });
  it('Antigravity: non-JSON input naming a workspace without a build is allowed', async () => {
    const r = await runLoader(named(tempDir()), agy(exampleRepo()));
    expect(JSON.parse(r.stdout)).toEqual({ decision: 'allow' });
  });
  it('Antigravity: non-JSON input naming no workspace is refused', async () => {
    const r = await runLoader('garbage', agy(tempDir()));
    const out = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain("couldn't tell which workspace");
  });
  it('Codex: non-JSON input judges the session folder', async () => {
    const refused = await runLoader('garbage', { ...deps(exampleRepo()), adapter: codexAdapter });
    expect(refused.stdout).toContain('deny');
    const allowed = await runLoader('garbage', { ...deps(tempDir()), adapter: codexAdapter });
    expect(allowed.stdout).not.toContain('deny');
    expect(allowed.code).toBe(0);
  });
});
