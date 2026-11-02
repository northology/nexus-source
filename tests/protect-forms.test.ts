import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../core/config.ts';
import { compileTargets, configTargets, DEFAULT_TARGETS, matchTarget, normalizePath, pathReadings, unmappable } from '../core/protect.ts';
import { tempDir } from './helpers.ts';

const WIN = { cwd: 'E:\\Work\\repo', home: 'C:\\Users\\dev', win: true, hostname: 'MyHost' };
const POSIX = { cwd: '/home/dev/repo', home: '/home/dev', win: false };

describe('path forms the wall used to miss', () => {
  it.each([
    ['/cygdrive/e/Work/repo/CLAUDE.md', 'e:/work/repo/claude.md'],
    ['/mnt/e/Work/repo/CLAUDE.md', 'e:/work/repo/claude.md'],
    ['E:CLAUDE.md', 'e:/work/repo/claude.md'],
    ['E:sub\\CLAUDE.md', 'e:/work/repo/sub/claude.md'],
    ['D:CLAUDE.md', 'd:/claude.md'],
    [`"'CLAUDE.md'"`, 'e:/work/repo/claude.md'],
    [`'"'CLAUDE.md'"'`, 'e:/work/repo/claude.md'],
    ['a/.../CLAUDE.md', 'e:/work/repo/a/claude.md'],
    ['//MyHost/e$/Work/repo/CLAUDE.md', 'e:/work/repo/claude.md'],
    ['\\\\MYHOST\\E$\\Work\\repo\\CLAUDE.md', 'e:/work/repo/claude.md'],
  ])('%s on Windows', (raw, expected) => {
    expect(normalizePath(raw, WIN)).toBe(expected);
  });
  it('keeps /mnt/ and ... as they are off Windows', () => {
    expect(normalizePath('/mnt/e/x', POSIX)).toBe('/mnt/e/x');
    expect(normalizePath('a/.../b', POSIX)).toBe('/home/dev/repo/a/.../b');
  });
  it('folds case on macOS, not on Linux', () => {
    expect(normalizePath('/Users/x/Claude.md', { ...POSIX, fold: true })).toBe('/users/x/claude.md');
    expect(normalizePath('/Users/x/Claude.md', POSIX)).toBe('/Users/x/Claude.md');
  });
  it('matches folded paths against folded targets on macOS', () => {
    const mac = { cwd: '/Users/dev/Repo', home: '/Users/dev', win: false, fold: true };
    const targets = compileTargets([...DEFAULT_TARGETS, ...configTargets(['Secret/Rules.md'])], { root: '/Users/dev/Repo', home: '/Users/dev', win: false, fold: true });
    expect(matchTarget(normalizePath('/Users/dev/Repo/x/claude.MD', mac), targets)?.pattern).toBe('CLAUDE.md');
    expect(matchTarget(normalizePath('/users/dev/repo/secret/rules.md', mac), targets)?.pattern).toBe('Secret/Rules.md');
  });
  it('reads /w/repo both ways on Windows', () => {
    expect(pathReadings('/w/repo/CLAUDE.md', WIN)).toEqual(['w:/repo/claude.md', 'e:/w/repo/claude.md']);
    expect(pathReadings('E:\\x', WIN)).toEqual(['e:/x']);
    expect(pathReadings('/w/repo/CLAUDE.md', POSIX)).toEqual(['/w/repo/CLAUDE.md']);
  });
  it('names the forms it cannot map', () => {
    expect(unmappable('\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\x')).toBe(true);
    expect(unmappable('//?/Volume{1234-abcd}/x')).toBe(true);
    expect(unmappable('"\\\\.\\globalroot\\x"')).toBe(true);
    expect(unmappable('\\\\?\\E:\\x')).toBe(false);
    expect(unmappable('E:\\x')).toBe(false);
  });
});

describe('protect entries with ..', () => {
  it('drops only the bad entry and names it', () => {
    const root = tempDir();
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus', 'config.json'), JSON.stringify({ protect: ['**/../x', 'keep/me.md'] }));
    const { config, problem } = readConfig(root);
    expect(config.protect).toEqual(['keep/me.md']);
    expect(problem).toMatch(/protect entries can't contain \.\. \(\*\*\/\.\.\/x\); it is ignored/);
  });
});
