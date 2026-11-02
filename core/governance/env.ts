import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fold, isInside, linkRefusal, pathRefusal, refusalText } from '../fs-guard.ts';
import type { InventoryEnv } from './types.ts';

export function managedDirFor(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

/** The real environment: what Claude Code itself reads. */
export function inventoryEnv(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): InventoryEnv {
  const config = env['CLAUDE_CONFIG_DIR'];
  const managed = env['NEXUS_INVENTORY_MANAGED'];
  const ceiling = env['NEXUS_INVENTORY_CEILING'];
  const project = env['CLAUDE_CODE_PROJECT_DIR_NAME'];
  const codex = env['CODEX_HOME'];
  return {
    home,
    configDir: config ? resolve(config) : join(home, '.claude'),
    managedDir: managed ? resolve(managed) : managedDirFor(platform),
    ceiling: ceiling ? resolve(ceiling) : null,
    platform,
    ...(project ? { projectDirName: project } : {}),
    ...(codex ? { codexHome: resolve(codex) } : {}),
  };
}

/**
 * The folder name Claude Code keeps a project's memory under. Documented for POSIX only (/home/u/r -> -home-u-r);
 * the same rule matches the Windows keys observed on this kind of machine (C:\work\repo -> C--work-repo).
 */
export function memoryKey(folder: string): string {
  return folder.replace(/[^A-Za-z0-9]/g, '-');
}

/** Every folder above root, nearest first, stopping before ceiling (or at the filesystem root), compared by `platform`'s rules. */
export function foldersAbove(root: string, ceiling: string | null, platform: NodeJS.Platform = process.platform): string[] {
  const out: string[] = [];
  const stop = ceiling === null ? null : resolve(ceiling);
  let dir = resolve(root);
  for (;;) {
    const up = dirname(dir);
    if (up === dir || (stop !== null && samePath(up, stop, platform))) break;
    out.push(up);
    dir = up;
  }
  return out;
}

const posixOf = (p: string): string => p.replace(/\\/g, '/');
export { fold, isInside };
const samePath = (a: string, b: string, platform: NodeJS.Platform): boolean => fold(a, platform) === fold(b, platform);
/** The part of `file` below `folder`, which isInside has matched by `platform`'s rules (so it can differ in letter case). */
const below = (folder: string, file: string): string => file.slice(folder.length).replace(/^[\\/]+/, '');

export function displayPath(file: string, root: string, home: string, platform: NodeJS.Platform = process.platform): string {
  const f = resolve(file);
  if (isInside(resolve(root), f, platform)) return posixOf(below(resolve(root), f)) || '.';
  if (isInside(resolve(home), f, platform)) return `~/${posixOf(below(resolve(home), f))}`;
  return posixOf(f);
}

/**
 * Why the inventory won't follow a path's links (core/fs-guard.ts), as a problem; null when they may be followed. `from`
 * is the trusted folder the walk starts at; null judges the path's own text first (an @import, a setting names it) and
 * walks from its filesystem root.
 */
export function linkProblem(path: string, from: string | null): { problem: string } | null {
  const r = from === null ? pathRefusal(path, null) : linkRefusal(from, path);
  return r === null ? null : { problem: refusalText(r) };
}

/**
 * A file's size and time. null when it isn't a readable file; a problem when a link on its way names a network or
 * device path or another drive (checked from `guard` before anything follows it; see linkProblem), or when its real
 * path leaves `within` (a link out of the folder the inventory was reading). `within` null skips the containment check
 * (an @ import names its own target); `guard` false skips the link walk (a file a collector has already checked).
 */
export function fileFacts(file: string, within: string | null, guard: string | null | false = within): { size: number; changed: string } | { problem: string } | null {
  try {
    if (guard !== false) {
      const refused = linkProblem(file, guard);
      if (refused !== null) return refused;
    }
    const s = statSync(file, { throwIfNoEntry: false });
    if (!s?.isFile()) return null;
    if (within !== null) {
      const real = realpathSync(file);
      const base = realpathSync(within);
      if (!isInside(base, real)) return { problem: 'a link leads out of its folder; not read' };
    }
    return { size: s.size, changed: s.mtime.toISOString() };
  } catch (err) {
    return factsError(err);
  }
}

/** Nothing there (or not a folder path) reads as "not a file"; any other failure is a problem that names its code. */
export function factsError(err: unknown): { problem: string } | null {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : 'unknown';
  return code === 'ENOENT' || code === 'ENOTDIR' ? null : readProblem(err);
}

/** The problem for a failed read: names the error code. */
export function readProblem(err: unknown): { problem: string } {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : 'unknown';
  return { problem: `can't be read: ${code}` };
}

/** Runs a read; on failure records a problem at `location` and returns null, so one bad file never aborts the inventory. */
export function attempt<T>(location: string, problems: { location: string; message: string }[], read: () => T): T | null {
  try {
    return read();
  } catch (err) {
    problems.push({ location, message: readProblem(err).problem });
    return null;
  }
}
