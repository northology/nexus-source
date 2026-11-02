import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';

/** Windows paths differ only by letter case when they name the same folder. `platform` defaults to this machine's. */
export const fold = (p: string, platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? p.toLowerCase() : p);

export const isInside = (parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean => {
  const p = fold(parent, platform);
  const c = fold(child, platform);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/** An fs failure (ENOENT race, EPERM, EBUSY...): anything carrying a string `code`. */
export const fsCode = (e: unknown): string | null => (e instanceof Error && typeof (e as { code?: unknown }).code === 'string' ? String((e as { code?: unknown }).code) : null);

/** A path's drive letter, upper case; null when it has none (a POSIX path, a UNC path). */
export const driveOf = (p: string): string | null => /^([a-z]):/i.exec(p)?.[1]?.toUpperCase() ?? null;

/**
 * An allow-list for a link's text. A drive letter (X:, X:\, X:/ or \\?\X:\) is treated as local only when it is the
 * repo's own drive (`drive`, compared case-insensitively); another drive is always outside the repo and may be a mapped
 * network drive, so it is refused. Any other text starting with \\, // (a network share) or \??\ (the NT prefix; \\.\
 * and \\?\GLOBALROOT\ device paths start with \\ too) can reach the network redirector or a device, and is refused.
 */
export function linkTextAllowed(text: string, drive: string | null): boolean {
  const letter = /^(?:[\\/]{2}\?[\\/])?([a-z]):/i.exec(text)?.[1];
  if (letter !== undefined) return drive !== null && letter.toUpperCase() === drive.toUpperCase();
  return !/^([\\/]{2}|\\\?\?\\)/.test(text);
}

/** Why a path's links weren't followed: one leads to a refused place, the chain is too long, or a link couldn't be checked. */
export type LinkRefusal = { why: 'outside' } | { why: 'too-many' } | { why: 'unchecked'; code: string };

/** "Nothing there": the walk can stop, since nothing below a missing segment can be followed either. */
const absent = (e: unknown): boolean => fsCode(e) === 'ENOENT' || fsCode(e) === 'ENOTDIR';

/**
 * Walks a path's segments below `from` with lstat, reading each symbolic link's text before anything follows it, and
 * refuses a link whose text isn't allowed (network and device paths, other drives than `drive`). An allowed link's target
 * is walked the same way, resolved against the folder the link really sits in (every link on the way there has passed
 * the check). Each link is visited once, so a target holding several links can't fan out. A walk stops quietly only
 * where nothing is there; any other fs error leaves links unchecked, so the path is refused rather than walked past.
 * `from` itself is trusted. A path that isn't below `from` is walked from its own filesystem root.
 *
 * Only lstat, readlink and a realpath of a folder that has already been walked touch the filesystem, so nothing here
 * follows a link it hasn't checked. Null when every link on the way is allowed.
 */
export function linkRefusal(from: string, path: string, drive: string | null = driveOf(resolve(from)), seen: Set<string> = new Set(), depth = 0): LinkRefusal | null {
  if (depth > 16) return { why: 'too-many' };
  const full = resolve(path);
  let base = resolve(from);
  if (!isInside(base, full)) base = parse(full).root;
  let cur = base;
  for (const seg of relative(base, full).split(sep).filter(Boolean)) {
    cur = join(cur, seg);
    let link: string;
    let parent: string;
    try {
      if (!lstatSync(cur).isSymbolicLink()) continue;
      link = readlinkSync(cur);
      if (!linkTextAllowed(link, drive)) return { why: 'outside' };
      parent = realpathSync.native(dirname(cur));
    } catch (e) {
      if (absent(e)) return null;
      return { why: 'unchecked', code: fsCode(e) ?? 'unreadable' };
    }
    const key = fold(`${parent}${sep}${basename(cur)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const target = resolve(parent, link);
    const inner = linkRefusal(parse(target).root, target, drive, seen, depth + 1);
    if (inner !== null) return inner;
  }
  return null;
}

/**
 * The same check for a path whose text itself may name a network or device place (an @import, a setting): refused on
 * its text before any fs call, then its links are walked from `from` (or its own root).
 */
export function pathRefusal(path: string, from: string | null): LinkRefusal | null {
  const full = resolve(path);
  const drive = driveOf(full);
  if (!linkTextAllowed(full, drive)) return { why: 'outside' };
  return linkRefusal(from ?? parse(full).root, full, from === null ? drive : driveOf(resolve(from)));
}

/** A refusal as the inventory's problem text. */
export function refusalText(r: LinkRefusal): string {
  if (r.why === 'outside') return 'a link leads to a network, device or other-drive path; not followed';
  if (r.why === 'too-many') return 'leads through too many links; not read';
  return `can't be checked for links (${r.code}); not read`;
}
