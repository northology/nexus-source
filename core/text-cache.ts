import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * File text, read again only when the file's stat changes (size, modified and changed times, inode). The inventory and
 * the vault registry read through it, so the live poll, which rebuilds them every 2 s, reads no file contents unless a
 * file changed. A stat failure throws as the read would. Callers check a path's links before reading it here.
 */
const cache = new Map<string, { stamp: string; text: string }>();
const MAX = 4096;

export function cachedText(file: string): string {
  const st = statSync(file);
  const stamp = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`;
  const key = resolve(file);
  const hit = cache.get(key);
  if (hit !== undefined && hit.stamp === stamp) return hit.text;
  const text = readFileSync(file, 'utf8');
  if (cache.size >= MAX) cache.clear();
  cache.set(key, { stamp, text });
  return text;
}

/** cachedText in readFileSync's shape, for the readers that take an injectable `read`. */
export const cachedRead = ((file: string) => cachedText(file)) as unknown as typeof readFileSync;
