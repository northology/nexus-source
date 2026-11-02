import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { NexusError } from './errors.ts';
import { isoNow } from './time.ts';
import type { FileEntry } from './types.ts';

/** Reads JSON, turning failures into NexusErrors that name the file (so the CLI never prints a stack trace). */
export function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new NexusError(`${basename(file)} cannot be read: ${(e as Error).message}`, 404);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new NexusError(`${basename(file)} is not valid JSON: ${(e as Error).message}`);
  }
}

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes pretty JSON atomically (temp file, then rename) so readers never see half a file. On Windows another
 * program can briefly hold the target; retry a few times, then fail with a readable error and no temp file left.
 */
export function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (LOCKED.has(code) && attempt < 5) {
        pause(40 * (attempt + 1));
        continue;
      }
      rmSync(tmp, { force: true });
      throw new NexusError(`Could not save ${basename(file)} (${code || (e as Error).message}). Close any program holding it open and try again.`);
    }
  }
}

/** Files under <buildDir>/<area>, newest first, as posix paths relative to the build folder. */
export function listFiles(buildDir: string, area: string): FileEntry[] {
  const base = join(buildDir, area);
  if (!existsSync(base)) return [];
  const out: FileEntry[] = [];
  const walk = (dir: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name !== '.gitkeep' && !d.name.endsWith('.tmp')) {
        const st = statSync(p);
        out.push({ path: relative(buildDir, p).split(sep).join('/'), size: st.size, modified: isoNow(st.mtime) });
      }
    }
  };
  walk(base);
  return out.sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));
}
