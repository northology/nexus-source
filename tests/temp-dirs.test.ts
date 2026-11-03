import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTrackedTempDirs, removeTrackedTempDirsAsync, trackTempDir } from './setup/temp-dirs.ts';
import { tempDir } from './helpers.ts';

describe('test temp folders', () => {
  let made = '';
  it('tempDir folders outlive the test that made them', () => {
    made = tempDir();
    expect(existsSync(made)).toBe(true);
  });
  it('are still there for the next test in the file', () => {
    expect(existsSync(made)).toBe(true);
  });
  it('removeTrackedTempDirs removes tracked folders, read-only files included', () => {
    const dir = trackTempDir(mkdtempSync(join(tmpdir(), 'nexus-tracked-')));
    const file = join(dir, 'locked.txt');
    writeFileSync(file, 'x');
    chmodSync(file, 0o444);
    expect(removeTrackedTempDirs()).toContain(dir);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(made)).toBe(false);
    expect(removeTrackedTempDirs()).toEqual([]);
  });
  it('removeTrackedTempDirsAsync removes them without holding the worker', async () => {
    const dir = trackTempDir(mkdtempSync(join(tmpdir(), 'nexus-tracked-')));
    writeFileSync(join(dir, 'file.txt'), 'x');
    const pending = removeTrackedTempDirsAsync();
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toContain(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
