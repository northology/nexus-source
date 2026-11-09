import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { internalNames, scanSnapshot, snapshotFiles, writeSnapshot } from '../scripts/source-snapshot.ts';
import { tempDir } from './helpers.ts';

// The public source snapshot (README "Releasing"): a commit's tracked files, minus the private ones, scanned against
// the private list of internal names before anything is copied.

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
};
function repo(extra: Record<string, string> = {}): string {
  const root = tempDir('nexus-snap-');
  git(root, 'init', '-q', '-b', 'main');
  write(root, {
    'README.md': '# tool\n',
    'src/a.ts': 'export const a = 1;\n',
    '.build/b/build.json': '{}\n',
    'design/x.md': '# private design\n',
    'docs/governance/builds/b.md': '# private record\n',
    'plugins/nexus/p.txt': 'built\n',
    'CLAUDE.md': '# private instructions\n',
    '.claude/settings.json': '{}\n',
    '.nexus/config.json': '{}\n',
    '.impeccable/design.json': '{}\n',
    '.publish/internal-names': '# comment\n\nacme\n',
    ...extra,
  });
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init');
  return root;
}

describe('the source snapshot', () => {
  it('takes the tracked files, leaving out builds, design, the docs vault, releases and the private config', () => {
    expect(snapshotFiles(repo())).toEqual(['README.md', 'src/a.ts']);
  });
  it('reads the private list, one case-insensitive pattern per line, and has none without the file', () => {
    const names = internalNames(repo());
    expect(names.map((r) => [r.source, r.flags])).toEqual([['acme', 'i']]);
    expect(internalNames(tempDir())).toEqual([]);
  });
  it('names each file and line that matches an internal name', () => {
    const root = repo({ 'src/b.ts': '// for Acme Corp\nexport const b = 2;\n' });
    expect(scanSnapshot(root)).toEqual(['src/b.ts:1 matches /acme/i']);
  });
  it('copies the snapshot into a clone, removing what the last snapshot had and keeping its .git', () => {
    const root = repo();
    const dest = tempDir('nexus-public-');
    git(dest, 'init', '-q', '-b', 'main');
    write(dest, { 'old.txt': 'gone next time\n', 'src/a.ts': 'stale\n' });
    expect(writeSnapshot(root, dest)).toEqual(['README.md', 'src/a.ts']);
    expect(existsSync(join(dest, 'old.txt'))).toBe(false);
    expect(readFileSync(join(dest, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(existsSync(join(dest, '.git'))).toBe(true);
    expect(existsSync(join(dest, 'CLAUDE.md'))).toBe(false);
  });
  it('copies nothing when the scan finds an internal name', () => {
    const root = repo({ 'src/b.ts': 'ACME\n' });
    const dest = tempDir('nexus-public-');
    git(dest, 'init', '-q');
    expect(() => writeSnapshot(root, dest)).toThrow(/src\/b\.ts:1 matches \/acme\/i/);
    expect(existsSync(join(dest, 'src'))).toBe(false);
  });
  it('refuses a working tree with uncommitted changes, so a snapshot is always a commit', () => {
    const root = repo();
    writeFileSync(join(root, 'src', 'a.ts'), 'changed\n');
    expect(() => writeSnapshot(root, tempDir())).toThrow(/uncommitted changes/);
  });
  it('refuses without the private list, so no snapshot goes out unscanned', () => {
    const root = repo();
    git(root, 'rm', '-q', '.publish/internal-names');
    git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'drop');
    expect(() => writeSnapshot(root, tempDir())).toThrow(/\.publish\/internal-names/);
  });
  it('refuses a destination that is not a git repository', () => {
    const dest = tempDir('nexus-public-');
    expect(() => writeSnapshot(repo(), dest)).toThrow(/not a git repository/);
  });
});
