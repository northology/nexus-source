import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';

/**
 * The temporary folders a test file makes through tempDir(), removed after the file's last test (isolate-home.ts), so
 * the system temp folder doesn't fill with one folder per fixture.
 */
const tracked: string[] = [];

export function trackTempDir(dir: string): string {
  tracked.push(dir);
  return dir;
}

/** The folders waiting to be removed after the file's last test. */
export function trackedTempDirs(): readonly string[] {
  return [...tracked];
}

/**
 * removeTrackedTempDirs without blocking: the worker's event loop keeps turning while the folders go, so a file with
 * many fixtures doesn't hold it past Vitest's 60 s update timeout (see isolate-home.ts).
 */
export async function removeTrackedTempDirsAsync(): Promise<string[]> {
  const dirs = tracked.splice(0);
  const results = await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).then(() => dir, () => null)));
  return results.filter((d): d is string => d !== null);
}

/** Removes every tracked folder (read-only files too) and forgets them all; a folder that won't go is left. */
export function removeTrackedTempDirs(): string[] {
  const removed: string[] = [];
  for (const dir of tracked.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      removed.push(dir);
    } catch {
      // held open by something else: left for the next clearing
    }
  }
  return removed;
}
