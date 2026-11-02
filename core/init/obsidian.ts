import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { NexusError } from '../errors.ts';
import { validate } from '../schemas.ts';
import { sha256 } from '../vault/generated.ts';

export const OBSIDIAN = 'docs/.obsidian';

export interface PinnedFile { name: string; sha256: string }
export interface PinnedPlugin { id: string; version: string; repo: string; files: PinnedFile[] }
export interface PinnedTheme { name: string; version: string; repo: string; commit: string; files: PinnedFile[] }
export interface PinList { plugins: PinnedPlugin[]; theme: PinnedTheme }
export interface Download { path: string; url: string; sha256: string }
export type Fetcher = (url: string) => Promise<Uint8Array>;

export function readPins(standard: string): PinList {
  const file = join(standard, 'obsidian', 'plugins.json');
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new NexusError(`Could not read the pinned plugin list ${file}: ${(e as Error).message}`);
  }
  const problems = validate('obsidian-pins', data);
  if (problems.length) throw new NexusError(`The pinned plugin list is invalid: ${problems.join('; ')}`);
  return data as PinList;
}

/** Each pinned file: where it goes in the repo, where it comes from, and the hash it must have. */
export function pinnedDownloads(pins: PinList): Download[] {
  const plugins = pins.plugins.flatMap((p) =>
    p.files.map((f) => ({ path: `${OBSIDIAN}/plugins/${p.id}/${f.name}`, url: `https://github.com/${p.repo}/releases/download/${p.version}/${f.name}`, sha256: f.sha256 })),
  );
  const t = pins.theme;
  const theme = t.files.map((f) => ({ path: `${OBSIDIAN}/themes/${t.name}/${f.name}`, url: `https://raw.githubusercontent.com/${t.repo}/${t.commit}/${f.name}`, sha256: f.sha256 }));
  return [...plugins, ...theme];
}

/** Fetches every file into memory and checks its hash. Nothing is written here: the caller writes only if problems is empty. */
export async function downloadAll(list: Download[], fetcher: Fetcher): Promise<{ files: Map<string, Uint8Array>; problems: string[]; unreachable: boolean }> {
  const files = new Map<string, Uint8Array>();
  const problems: string[] = [];
  let unreachable = false;
  for (const d of list) {
    let bytes: Uint8Array;
    try {
      bytes = await fetcher(d.url);
    } catch (e) {
      // A server that answered with an error isn't a lost network: only the second gets the offline hint.
      if (!(e instanceof HttpError)) unreachable = true;
      problems.push(`${d.url} couldn't be downloaded: ${(e as Error).message}`);
      continue;
    }
    const got = sha256(bytes);
    if (got !== d.sha256) {
      problems.push(`${d.url} doesn't match its pinned hash (expected ${d.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
      continue;
    }
    files.set(d.path, bytes);
  }
  return { files, problems, unreachable };
}

/** The server answered, with an error status. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Fetches over the network, giving up after timeoutMs so a stalled connection can't hang init. */
export function httpFetcher(timeoutMs: number): Fetcher {
  return async (url) => {
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') throw new Error(`timed out after ${timeoutMs / 1000}s`);
      throw e;
    }
    if (!res.ok) throw new HttpError(res.status);
    return new Uint8Array(await res.arrayBuffer());
  };
}

export const fetchBytes: Fetcher = httpFetcher(60_000);

/** Reads https://<host>/<path> from <dir>/<host>/<path>: an offline mirror, and the tests' stand-in for the network. */
export function mirrorFetcher(dir: string): Fetcher {
  const base = resolve(dir);
  return async (url) => {
    const path = resolve(base, ...url.replace(/^https:\/\//, '').split('/'));
    if (relative(base, path).startsWith('..') || isAbsolute(relative(base, path))) throw new Error(`${url} points outside the mirror`);
    if (!existsSync(path)) throw new Error(`not in the mirror (${path})`);
    return new Uint8Array(readFileSync(path));
  };
}
