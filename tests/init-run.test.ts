import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInit, runObsidianInstall } from '../core/init/run.ts';
import { mirrorFetcher } from '../core/init/obsidian.ts';
import { EMPTY_ANSWERS } from '../core/init/answers.ts';
import { tempDir, treeHash } from './helpers.ts';
import { FAKE, testStandard } from './init-helpers.ts';

const run = (root: string, s: { standard: string; mirror: string }, more: { fetcher?: null; check?: boolean } = {}) =>
  runInit(root, { standard: s.standard, answers: EMPTY_ANSWERS, fetcher: more.fetcher === null ? null : mirrorFetcher(s.mirror), check: more.check ?? false });
const offline = async (): Promise<Uint8Array> => {
  throw new Error('no network expected');
};

describe('runInit', () => {
  it('downloads the pinned files and writes everything', async () => {
    const s = testStandard();
    const root = tempDir('nexus-run-');
    const r = await run(root, s);
    expect(r).toMatchObject({ written: true, downloads: 4 });
    expect(readFileSync(join(root, 'docs/.obsidian/plugins/alpha/main.js'), 'utf8')).toBe(FAKE.plugin['main.js']);
    expect(existsSync(join(root, 'docs/.obsidian/themes/Plain/theme.css'))).toBe(true);
  });
  it('writes nothing when one download of many fails, and names it', async () => {
    const s = testStandard();
    rmSync(join(s.mirror, 'raw.githubusercontent.com'), { recursive: true });
    const root = tempDir('nexus-run-');
    const before = treeHash(root);
    const r = await run(root, s);
    expect(r).toMatchObject({ written: false, unreachable: true });
    expect(r.plan.problems).toEqual([expect.stringMatching(/theme\.css couldn't be downloaded/), expect.stringMatching(/manifest\.json couldn't be downloaded/)]);
    expect(treeHash(root)).toBe(before);
  });
  it('checks the target before reaching the network', async () => {
    const s = testStandard();
    const blocked = tempDir('nexus-run-');
    await run(blocked, s);
    const again = await runInit(blocked, { standard: s.standard, answers: EMPTY_ANSWERS, fetcher: offline, check: false });
    expect(again.plan.problems).toEqual(['docs/_meta/ already exists: this repo is already set up (init runs once per repo)']);
  });
  it('stops a second run with nothing changed', async () => {
    const s = testStandard();
    const root = tempDir('nexus-run-');
    await run(root, s);
    const before = treeHash(root);
    const r = await run(root, s);
    expect(r.written).toBe(false);
    expect(treeHash(root)).toBe(before);
  });
  it('--check writes nothing and counts the downloads', async () => {
    const s = testStandard();
    const root = tempDir('nexus-run-');
    const before = treeHash(root);
    expect(await run(root, s, { check: true })).toMatchObject({ written: false, downloads: 4 });
    expect(treeHash(root)).toBe(before);
  });
  it('--no-plugins writes everything but the downloads, without reading the pinned list', async () => {
    const s = testStandard();
    rmSync(join(s.standard, 'obsidian', 'plugins.json'));
    const root = tempDir('nexus-run-');
    expect(await run(root, s, { fetcher: null })).toMatchObject({ written: true, downloads: null });
    expect(existsSync(join(root, 'docs/.obsidian/plugins/alpha'))).toBe(false);
  });
});

describe('runObsidianInstall', () => {
  it('fills in the plugins after --no-plugins, ending where a full run does', async () => {
    const s = testStandard();
    const full = tempDir('nexus-run-');
    await run(full, s);
    const later = tempDir('nexus-run-');
    await run(later, s, { fetcher: null });
    expect(await runObsidianInstall(later, { standard: s.standard, fetcher: mirrorFetcher(s.mirror), check: false })).toMatchObject({ written: true, missing: expect.arrayContaining(['docs/.obsidian/plugins/alpha/main.js']) });
    for (const f of ['docs/.obsidian/plugins/alpha/main.js', 'docs/.obsidian/themes/Plain/theme.css']) {
      expect(readFileSync(join(later, f), 'utf8')).toBe(readFileSync(join(full, f), 'utf8'));
    }
  });
  it('leaves files with the pinned hash alone and refuses one with other content', async () => {
    const s = testStandard();
    const root = tempDir('nexus-run-');
    await run(root, s);
    expect(await runObsidianInstall(root, { standard: s.standard, fetcher: mirrorFetcher(s.mirror), check: false })).toMatchObject({ written: false, missing: [], problems: [] });
    writeFileSync(join(root, 'docs/.obsidian/plugins/alpha/main.js'), 'mine');
    expect((await runObsidianInstall(root, { standard: s.standard, fetcher: mirrorFetcher(s.mirror), check: false })).problems).toEqual([
      "docs/.obsidian/plugins/alpha/main.js is there with other content; nexus won't replace it",
    ]);
  });
  it('refuses a folder that is not a vault', async () => {
    const s = testStandard();
    expect((await runObsidianInstall(tempDir(), { standard: s.standard, fetcher: mirrorFetcher(s.mirror), check: false })).problems).toEqual([
      'docs/_meta/classes/ not found: run nexus init first',
    ]);
  });
});
