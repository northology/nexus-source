import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NexusError } from './errors.ts';
import { linkRefusal } from './fs-guard.ts';

export const BUILD_DIR = '.build';

function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

/** The nearest folder at or above start that contains .build/, or null. */
export function findBuildRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (isDir(join(dir, BUILD_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Where a new build should go: the nearest folder with .build/ or .git, else start. */
export function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (isDir(join(dir, BUILD_DIR)) || existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function buildPath(root: string, name: string, ...parts: string[]): string {
  return join(root, BUILD_DIR, name, ...parts);
}

export function listBuilds(root: string): string[] {
  const dir = join(root, BUILD_DIR);
  if (linkRefusal(root, dir) !== null || !isDir(dir)) return []; // a .build that is a network or device link isn't followed
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

export function resolveBuild(root: string, requested?: string): string {
  const builds = listBuilds(root);
  if (requested) {
    if (!builds.includes(requested)) throw new NexusError(`No build named "${requested}"`, 404);
    return requested;
  }
  if (builds.length === 1) return builds[0] as string;
  if (builds.length === 0) throw new NexusError('No build in this checkout. Start one with `nexus new <name>`.', 404);
  throw new NexusError(`This checkout has several builds (${builds.join(', ')}); pass --build <name>.`);
}
