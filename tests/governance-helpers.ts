import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InventoryEnv } from '../core/governance/types.ts';
import { tempDir } from './helpers.ts';

/**
 * A sandbox: <base>/home (with .claude as the config folder), <base>/managed and <base>/outer/repo. The walk above
 * the repo stops at <base>, so only <base>/outer is "a folder above". Nothing outside <base> is read.
 */
export function sandbox(): { base: string; root: string; outer: string; env: InventoryEnv } {
  const base = tempDir('nexus-gov-');
  const env = isolatedEnv(base);
  const outer = join(base, 'outer');
  const root = join(outer, 'repo');
  for (const d of [env.configDir, env.managedDir, root]) mkdirSync(d, { recursive: true });
  return { base, root, outer, env };
}

export function isolatedEnv(base: string): InventoryEnv {
  const home = join(base, 'home');
  return { home, configDir: join(home, '.claude'), managedDir: join(base, 'managed'), ceiling: base, platform: process.platform };
}

/** Writes files under a folder; names like CLAUDE.md exist only here, at run time (walled-template-names). */
export function put(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}
