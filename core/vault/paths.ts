import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** On Windows, the msys, Cygwin and WSL spellings of a drive (/e/x, /cygdrive/e/x, /mnt/e/x) as e:/x. */
export function driveSpelling(path: string, win: boolean): string {
  if (!win) return path;
  const p = path.replace(/\\/g, '/');
  const m = /^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?:\/|$)/.exec(p);
  return m ? `${m[1]}:/${p.slice(m[0].length)}` : path;
}

/** The nearest folder at or above start whose docs/ is a vault, or null. */
export function findVaultRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'docs', '_meta', 'classes'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The repo root of the vault a file sits in: the folder above the nearest docs/ that is a vault. */
export function vaultRootOf(file: string): string | null {
  let dir = dirname(file);
  for (;;) {
    if (basename(dir) === 'docs' && existsSync(join(dir, '_meta', 'classes'))) return dirname(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
