// The public source snapshot (README "Releasing"): the files of one commit, without the build records, the design
// history, the docs vault, the built releases and this repo's private config, scanned against a private list of internal names before
// anything is copied. The list lives in .publish/internal-names, which the snapshot itself never contains.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const NAMES_FILE = '.publish/internal-names';

/** Paths that stay private: a folder (ending in /) or one file, repo-relative. */
export const PRIVATE = ['.build/', 'design/', 'docs/', 'plugins/', '.claude/', '.nexus/', '.impeccable/', '.publish/', '.superpowers/', 'CLAUDE.md'];

const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const isPrivate = (rel: string): boolean => PRIVATE.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));

/** The private list's patterns: one per line, case-insensitive, blank lines and # comments skipped; none without it. */
export function internalNames(root: string): RegExp[] {
  const file = join(root, NAMES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'i'));
}

/** The tracked files the snapshot takes, repo-relative with forward slashes, sorted. */
export function snapshotFiles(root: string): string[] {
  return git(root, ['ls-files', '-z'])
    .split('\0')
    .filter((f) => f !== '' && !isPrivate(f))
    .sort();
}

/** Each line of a snapshot file that matches an internal name, as `file:line matches /pattern/i`. Binary files are skipped. */
export function scanSnapshot(root: string): string[] {
  const names = internalNames(root);
  const found: string[] = [];
  for (const f of snapshotFiles(root)) {
    const data = readFileSync(join(root, f));
    if (data.subarray(0, 8000).includes(0)) continue;
    data.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      for (const n of names) if (n.test(line)) found.push(`${f}:${i + 1} matches ${String(n)}`);
    });
  }
  return found;
}

/** Every path under dir except .git, deepest first, so files go before the folders that held them. */
function contents(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r === '.git') return [];
    return e.isDirectory() ? [...contents(dir, r), r] : [r];
  });
}

/**
 * Replaces dest's files (its .git kept) with the snapshot of root's current commit, and returns the files written.
 * Refuses, writing nothing, on uncommitted changes, a missing private list, a dest that isn't a git repository, or any
 * internal name the scan finds. Committing and pushing dest is the release step's own.
 */
export function writeSnapshot(root: string, dest: string): string[] {
  if (git(root, ['status', '--porcelain']).trim() !== '') throw new Error('uncommitted changes: commit them first, so the snapshot is exactly one commit');
  if (internalNames(root).length === 0) throw new Error(`${NAMES_FILE} is missing or empty, so the snapshot can't be scanned for internal names`);
  if (!existsSync(join(dest, '.git'))) throw new Error(`${dest} is not a git repository: clone the public repository there first`);
  const found = scanSnapshot(root);
  if (found.length) throw new Error(`internal names in the snapshot; nothing was copied:\n${found.join('\n')}`);
  for (const p of contents(dest)) rmSync(join(dest, p), { recursive: true, force: true });
  const files = snapshotFiles(root);
  for (const f of files) {
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    copyFileSync(join(root, f), join(dest, f));
  }
  return files;
}
