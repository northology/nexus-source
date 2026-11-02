// Every e2e server starts here, so none can read the real ~/.claude: the inventory option is required, and checked at
// run time too, since the .mjs launchers (serve-example.mjs, serve-one.mjs) aren't typechecked. e2e-server.test.ts
// fails if a launcher calls startServer directly.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InventoryEnv } from '../../core/governance/types.ts';
import { startServer, type RunningServer } from '../../server/server.ts';

/**
 * An empty, temporary home: empty config and managed folders, and a walk above the repo that stops at the OS temp
 * folder, which holds every fixture's repo, so nothing outside it is read either.
 */
export function isolatedEnv(): InventoryEnv {
  const base = mkdtempSync(join(tmpdir(), 'nexus-e2e-home-'));
  const home = join(base, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(base, 'managed'));
  return { home, configDir: join(home, '.claude'), managedDir: join(base, 'managed'), ceiling: tmpdir(), platform: process.platform };
}

export type E2eServerOptions = Parameters<typeof startServer>[0] & { inventory: InventoryEnv };

export async function startE2eServer(opts: E2eServerOptions): Promise<RunningServer> {
  if (!(opts as Partial<E2eServerOptions>).inventory) throw new Error('An e2e server needs an inventory (isolatedEnv()), so it never reads the real home');
  return startServer(opts);
}
