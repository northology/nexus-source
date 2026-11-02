import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTIFACTS, tempDir } from './helpers.ts';
import { REGISTRY_ENTRIES } from '../core/init/standard.ts';

export const STANDARD = join(ARTIFACTS, 'standard');
export const VAULTS = join(ARTIFACTS, 'tests', 'fixtures', 'vaults');

/** A temp repo: docs/_meta/ from standard/, then a fixture vault's docs/ over it, then the given files. */
export function vaultRepo(files: Record<string, string> = {}, base?: string): string {
  const root = tempDir('nexus-vault-');
  for (const e of REGISTRY_ENTRIES) cpSync(join(STANDARD, e), join(root, 'docs', '_meta', e), { recursive: true });
  if (base) cpSync(join(VAULTS, base, 'docs'), join(root, 'docs'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** A note: string values written as given (quote wikilinks yourself), other values as JSON. */
export function note(props: Record<string, unknown>, body = '# Note\n'): string {
  const lines = Object.entries(props).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
