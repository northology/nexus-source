import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isVault, readRegistry } from './registry.ts';
import { CONTRACT_VERSION } from './types.ts';

export interface DoctorResult {
  ok: boolean;
  text: string;
}

/** Is the vault machinery right? The bundle runs, the hook is registered, the registry reads. Notes are docs check's job. */
export function doctorDocs(root: string, plugin: { bundle: string; hooks: string }): DoctorResult[] {
  const results: DoctorResult[] = [];

  const run = spawnSync(process.execPath, [plugin.bundle, root, '--json'], { encoding: 'utf8' });
  let ran = false;
  try {
    ran = typeof (JSON.parse(run.stdout) as { vault?: unknown }).vault === 'boolean';
  } catch {
    ran = false;
  }
  results.push(ran
    ? { ok: true, text: 'the docs-check bundle runs' }
    : { ok: false, text: `the docs-check bundle didn't run: ${(run.stderr || run.error?.message || `exit ${String(run.status)}`).split(/\r?\n/)[0] ?? ''}. Rebuild the plugin (pnpm build) or reinstall it.` });

  let wired = false;
  try {
    const config = JSON.parse(readFileSync(plugin.hooks, 'utf8')) as { hooks?: { PostToolUse?: { hooks?: { args?: string[] }[] }[] } };
    wired = (config.hooks?.PostToolUse ?? []).some((e) => (e.hooks ?? []).some((h) => (h.args ?? []).some((a) => a.endsWith('docs-check.mjs')) && (h.args ?? []).includes('--hook')));
  } catch {
    wired = false;
  }
  results.push(wired
    ? { ok: true, text: 'the PostToolUse hook runs docs-check.mjs --hook' }
    : { ok: false, text: 'no PostToolUse entry runs docs-check.mjs --hook in hooks/hooks.json. Reinstall the plugin.' });

  const docs = join(root, 'docs');
  if (!existsSync(docs) || !isVault(docs)) {
    results.push({ ok: true, text: 'no docs vault here (docs/_meta/classes/ not found)' });
  } else {
    const { registry, findings } = readRegistry(docs);
    if (findings.length > 0) {
      results.push({ ok: false, text: `the registry has problems: ${findings.map((f) => `${f.file}: ${f.message}`).join('; ')}` });
    } else if (registry.contract !== null && registry.contract > CONTRACT_VERSION) {
      results.push({ ok: false, text: `the vault follows contract ${registry.contract}; this nexus supports ${CONTRACT_VERSION}. Update nexus.` });
    } else {
      results.push({ ok: true, text: `the registry reads: ${registry.classes.size} classes, contract ${String(registry.contract)}` });
    }
  }
  return results;
}
