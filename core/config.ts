import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './schemas.ts';
import { readJson } from './store.ts';

export const CONFIG_FILE = '.nexus/config.json';
export interface NexusConfig { staticRules: string[]; protect: string[] }

/** The repo's nexus config. Missing is fine; a bad one is named and the defaults apply. */
export function readConfig(root: string): { config: NexusConfig; problem: string | null } {
  const empty: NexusConfig = { staticRules: [], protect: [] };
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { config: empty, problem: null };
  try {
    const data = readJson(file);
    const errors = validate('config', data);
    if (errors.length) return { config: empty, problem: errors.join('; ') };
    const c = data as Partial<NexusConfig>;
    // A .. in a pattern can't be matched the way its author meant. That entry alone is dropped: reading the whole
    // file as invalid would drop the repo's other protected files with it.
    const dotted = (c.protect ?? []).filter((p) => /(^|[\\/])\.\.([\\/]|$)/.test(p));
    const protect = (c.protect ?? []).filter((p) => !dotted.includes(p));
    const problem = dotted.length ? dotted.map((p) => `protect entries can't contain .. (${p}); it is ignored`).join('; ') : null;
    return { config: { staticRules: c.staticRules ?? [], protect }, problem };
  } catch (e) {
    return { config: empty, problem: (e as Error).message };
  }
}
