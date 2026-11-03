// Every e2e server starts here, so none can read the real ~/.claude: the inventory option is required, and checked at
// run time too, since the .mjs launchers (serve-example.mjs, serve-one.mjs) aren't typechecked. e2e-server.test.ts
// fails if a launcher calls startServer directly.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { InventoryEnv } from '../../core/governance/types.ts';
import { startServer, type RunningServer } from '../../server/server.ts';
import { trackTempDir } from '../setup/temp-dirs.ts';

/**
 * An empty, temporary home: empty config and managed folders, and a walk above the repo that stops at the OS temp
 * folder, which holds every fixture's repo, so nothing outside it is read either.
 */
export function isolatedEnv(): InventoryEnv {
  // Tracked, so a Vitest file removes it after its last test; the e2e launchers list theirs for the next run.
  const base = trackTempDir(mkdtempSync(join(tmpdir(), 'nexus-e2e-home-')));
  const home = join(base, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(base, 'managed'));
  return { home, configDir: join(home, '.claude'), managedDir: join(base, 'managed'), ceiling: tmpdir(), platform: process.platform };
}

/**
 * Removes the temp folders a previous e2e run listed (a JSON array of paths), and returns them. Playwright ends the
 * servers by killing them, so a run can't clean up after itself; the next one does. Only folders directly in the OS
 * temp folder whose names start nexus-e2e are touched, and a missing or unreadable list removes nothing.
 */
export function removePreviousRun(listFile: string): string[] {
  let listed: unknown;
  try {
    listed = JSON.parse(readFileSync(listFile, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(listed)) return [];
  const temp = resolve(tmpdir());
  const removed: string[] = [];
  for (const p of listed) {
    if (typeof p !== 'string' || resolve(dirname(p)) !== temp || !basename(p).startsWith('nexus-e2e')) continue;
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      removed.push(p);
    } catch {
      // held open: the next run tries again only if it lists it, so it stays for a manual clearing
    }
  }
  return removed;
}

export type E2eServerOptions = Parameters<typeof startServer>[0] & { inventory: InventoryEnv };

export async function startE2eServer(opts: E2eServerOptions): Promise<RunningServer> {
  if (!(opts as Partial<E2eServerOptions>).inventory) throw new Error('An e2e server needs an inventory (isolatedEnv()), so it never reads the real home');
  return startServer(opts);
}
