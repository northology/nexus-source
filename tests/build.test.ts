import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBuild, readBuild, setStage } from '../core/build.ts';
import { findBuildRoot, findRepoRoot, resolveBuild, listBuilds } from '../core/paths.ts';
import { readSnapshot } from '../core/snapshot.ts';
import { validate } from '../core/schemas.ts';
import { tempDir, exampleRepo, NOW, readJsonFile } from './helpers.ts';

describe('createBuild', () => {
  it('creates the standard folder with valid files', () => {
    const root = tempDir();
    const dir = createBuild(root, { name: 'relay-rebuild', summary: 'Retry and replay', branch: 'build/relay-rebuild', now: NOW });
    for (const f of ['logs', 'gates', 'concepts', 'documents/plans', 'documents/specs', 'documents/audits', 'documents/reports', 'notes', 'files']) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(validate('build', readJsonFile(join(dir, 'build.json')))).toEqual([]);
    expect(readJsonFile(join(dir, 'logs', 'issues.json'))).toEqual({ entries: [] });
    expect(readdirSync(join(dir, 'gates'))).toEqual(['.gitkeep']);
    expect(readBuild(root, 'relay-rebuild')).toMatchObject({ stage: 'planning', summary: 'Retry and replay', created: NOW, gates: {} });
  });
  it('refuses a second build with the same name', () => {
    const root = tempDir();
    createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW });
    expect(() => createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW })).toThrow(/already exists/);
  });
  it('refuses a build name too long for its decommission rounds, even with a short phase', () => {
    const long = `relay-${'a'.repeat(43)}`;
    expect(long).toHaveLength(49);
    expect(() => createBuild(tempDir(), { name: long, phase: 'phase-1', branch: 'b', now: NOW })).toThrow(/at most 48 characters/);
    expect(() => createBuild(tempDir(), { name: long.slice(0, 48), phase: 'phase-1', branch: 'b', now: NOW })).not.toThrow();
  });
  it('still loads a build made before the limit, with a longer name', () => {
    const root = exampleRepo();
    const long = `relay-${'a'.repeat(50)}`;
    cpSync(join(root, '.build', 'relay-rebuild'), join(root, '.build', long), { recursive: true });
    expect(listBuilds(root)).toContain(long);
    expect(resolveBuild(root, long)).toBe(long);
  });
  it.each([
    ['a build record', 'docs/governance/builds/relay-rebuild.md', '# relay-rebuild\n'],
    ['decisions in the repo log', 'docs/governance/decisions.json', JSON.stringify({ entries: [{ build: 'relay-rebuild', name: 'd', text: 't', status: 'accepted', source: 's' }] })],
    ['issues in the repo log', 'docs/governance/issues.json', JSON.stringify({ entries: [{ build: 'relay-rebuild', name: 'i', text: 't', status: 'open', source: 's' }] })],
  ])('refuses the name of a decommissioned build that left %s', (_label, file, text) => {
    const root = tempDir();
    mkdirSync(join(root, 'docs', 'governance', 'builds'), { recursive: true });
    writeFileSync(join(root, file), text);
    expect(() => createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW })).toThrow(/relay-rebuild was decommissioned .*pick another name/);
    expect(existsSync(join(root, '.build', 'relay-rebuild'))).toBe(false);
  });
  it("takes a name the repo's record holds only for other builds", () => {
    const root = tempDir();
    mkdirSync(join(root, 'docs', 'governance'), { recursive: true });
    writeFileSync(join(root, 'docs', 'governance', 'decisions.json'), JSON.stringify({ entries: [{ build: 'other-build', name: 'd', text: 't', status: 'accepted', source: 's' }] }));
    expect(() => createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW })).not.toThrow();
  });
  it('refuses a new build when a repo log it must check can’t be read, naming the file', () => {
    const root = tempDir();
    mkdirSync(join(root, 'docs', 'governance'), { recursive: true });
    writeFileSync(join(root, 'docs', 'governance', 'issues.json'), '{ not json');
    expect(() => createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW })).toThrow(/docs\/governance\/issues\.json/);
  });
  it('refuses a coded name', () => {
    expect(() => createBuild(tempDir(), { name: 'b01', branch: 'b', now: NOW })).toThrow(/not a readable name/);
  });
  it('sets the stage and rejects unknown stages', () => {
    const root = tempDir();
    createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW });
    expect(setStage(root, 'relay-rebuild', 'build').stage).toBe('build');
    expect(() => setStage(root, 'relay-rebuild', 'done')).toThrow(/planning, plan, build, close-out/);
  });
  it('writes .build/.gitattributes so text files keep LF endings and binaries are left alone, and keeps one already there', () => {
    const root = tempDir();
    createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW });
    expect(readFileSync(join(root, '.build', '.gitattributes'), 'utf8')).toBe('* text=auto eol=lf\n');
    const other = tempDir();
    mkdirSync(join(other, '.build'), { recursive: true });
    writeFileSync(join(other, '.build', '.gitattributes'), '* -text\n');
    createBuild(other, { name: 'relay-rebuild', branch: 'b', now: NOW });
    expect(readFileSync(join(other, '.build', '.gitattributes'), 'utf8')).toBe('* -text\n');
  });
  it('upgrades the old default that marked binaries as text, and only that', () => {
    const old = tempDir();
    mkdirSync(join(old, '.build'), { recursive: true });
    writeFileSync(join(old, '.build', '.gitattributes'), '* text eol=lf\n');
    createBuild(old, { name: 'relay-rebuild', branch: 'b', now: NOW });
    expect(readFileSync(join(old, '.build', '.gitattributes'), 'utf8')).toBe('* text=auto eol=lf\n');
  });
});

describe('createBuild guardrails', () => {
  it('starts an empty guardrails log', () => {
    const root = tempDir();
    createBuild(root, { name: 'relay-rebuild', branch: 'b', now: NOW });
    expect(readJsonFile(join(root, '.build', 'relay-rebuild', 'logs', 'guardrails.json'))).toEqual({ entries: [] });
  });
});

describe('finding builds', () => {
  it('finds the root from a nested folder', () => {
    const root = exampleRepo();
    const nested = join(root, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    expect(findBuildRoot(nested)).toBe(root);
  });
  it('returns null when there is no .build anywhere above', () => {
    expect(findBuildRoot(tempDir())).toBeNull();
  });
  it('uses the git root for new builds when there is no .build yet', () => {
    const root = tempDir();
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'app'));
    expect(findRepoRoot(join(root, 'app'))).toBe(root);
  });
  it('resolves the only build without a name', () => {
    expect(resolveBuild(exampleRepo())).toBe('relay-rebuild');
  });
  it('says how to start when there are no builds', () => {
    const root = tempDir();
    mkdirSync(join(root, '.build'));
    expect(listBuilds(root)).toEqual([]);
    expect(() => resolveBuild(root)).toThrow(/nexus new/);
  });
  it('asks for --build when there are several', () => {
    const root = exampleRepo();
    createBuild(root, { name: 'second-build', branch: 'b', now: NOW });
    expect(() => resolveBuild(root)).toThrow(/relay-rebuild, second-build.*--build/);
    expect(resolveBuild(root, 'second-build')).toBe('second-build');
  });
  it('rejects a named build that does not exist', () => {
    expect(() => resolveBuild(exampleRepo(), 'missing-build')).toThrow(/No build named "missing-build"/);
  });
});

describe('readSnapshot', () => {
  it('reads the example build with no problems', () => {
    const s = readSnapshot(exampleRepo(), 'relay-rebuild');
    expect(s.problems).toEqual([]);
    expect(s.build?.stage).toBe('plan');
    expect(s.logs.decisions.map((e) => e.name)).toEqual(['replay-window', 'auto-retry', 'new-language']);
    expect(s.gates.map((g) => g.name)).toEqual(['look', 'scope', 'spec-review']);
    expect(s.gates.find((g) => g.name === 'scope')?.answers?.marks?.['auto-retry']).toBe('accepted');
    expect(s.gates.find((g) => g.name === 'scope')?.read).toBe('2026-10-02T11:58:00-06:00');
    expect(s.files.documents.map((f) => f.path)).toEqual(['documents/specs/relay-rebuild-spec.md']);
    expect(s.files.concepts.map((f) => f.path).sort()).toEqual(['concepts/dense-table.html', 'concepts/quiet-board.html']);
  });
  it('reports a broken file and still reads the rest', () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', 'relay-rebuild', 'logs', 'issues.json'), '{ not json');
    const s = readSnapshot(root, 'relay-rebuild');
    expect(s.problems).toEqual([{ file: 'logs/issues.json', message: expect.stringMatching(/not valid JSON/) }]);
    expect(s.logs.issues).toEqual([]);
    expect(s.logs.decisions).toHaveLength(3);
  });
  it('reports duplicate names in a log', () => {
    const root = exampleRepo();
    const entry = { name: 'auto-retry', text: 'x', status: 'accepted', source: 'chat', time: NOW };
    writeFileSync(join(root, '.build', 'relay-rebuild', 'logs', 'decisions.json'), JSON.stringify({ entries: [entry, entry] }));
    expect(readSnapshot(root, 'relay-rebuild').problems).toContainEqual({ file: 'logs/decisions.json', message: 'duplicate name "auto-retry"' });
  });
  it('reports answers that do not fit their gate', () => {
    const root = exampleRepo();
    writeFileSync(
      join(root, '.build', 'relay-rebuild', 'gates', 'scope.answers.json'),
      JSON.stringify({ gate: 'scope', submitted: NOW, marks: { 'auto-retry': 'accepted' } }),
    );
    const problem = readSnapshot(root, 'relay-rebuild').problems.find((p) => p.file === 'gates/scope.answers.json');
    expect(problem?.message).toMatch(/missing: replay-window, alerting-channel/);
  });
});
