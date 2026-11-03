import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, removePreviousRun, startE2eServer } from './e2e/e2e-server.ts';
import { ARTIFACTS, tempDir } from './helpers.ts';
import { trackedTempDirs } from './setup/temp-dirs.ts';

const E2E = join(ARTIFACTS, 'tests', 'e2e');

describe('e2e servers never read the real home', () => {
  it('refuses to start a server without an inventory', async () => {
    const opts = { root: E2E, cockpitDir: E2E, port: 0 } as unknown as Parameters<typeof startE2eServer>[0];
    await expect(startE2eServer(opts)).rejects.toThrow(/inventory/);
  });

  it('builds an empty temporary home whose walk stops at the temp folder', () => {
    const env = isolatedEnv();
    expect(readdirSync(env.configDir)).toEqual([]);
    expect(readdirSync(env.managedDir)).toEqual([]);
    expect(env.ceiling).not.toBeNull();
    expect(env.configDir.startsWith(env.ceiling ?? '')).toBe(true);
  });

  it("tracks an isolated home with the test file's temp folders, removed after its last test", () => {
    const env = isolatedEnv();
    // Checked, not removed: clearing here would take folders a later test in this file may still use.
    expect(trackedTempDirs()).toContain(dirname(env.home));
  });

  it('removePreviousRun removes only nexus-e2e folders in the temp folder', () => {
    const ours = mkdtempSync(join(tmpdir(), 'nexus-e2e-repo-'));
    const outside = tempDir();
    const nested = join(outside, 'nexus-e2e-inner');
    mkdirSync(nested);
    const other = tempDir('nexus-other-');
    const list = join(tempDir(), 'temp.json');
    writeFileSync(list, JSON.stringify([ours, nested, other]));
    expect(removePreviousRun(list)).toEqual([ours]);
    expect([ours, nested, other].map(existsSync)).toEqual([false, true, true]);
  });

  it('removePreviousRun ignores a missing or unreadable list', () => {
    const dir = tempDir();
    expect(removePreviousRun(join(dir, 'none.json'))).toEqual([]);
    writeFileSync(join(dir, 'bad.json'), '{ broken');
    expect(removePreviousRun(join(dir, 'bad.json'))).toEqual([]);
  });

  it('starts every e2e server through startE2eServer', () => {
    const launchers = readdirSync(E2E).filter((f) => /\.(m?js|ts)$/.test(f) && f !== 'e2e-server.ts');
    const direct = launchers.filter((f) => /\bstartServer\s*\(/.test(readFileSync(join(E2E, f), 'utf8')));
    expect(direct).toEqual([]);
    expect(launchers.filter((f) => readFileSync(join(E2E, f), 'utf8').includes('startE2eServer(')).sort()).toEqual(['serve-example.mjs', 'serve-one.mjs']);
  });
});
