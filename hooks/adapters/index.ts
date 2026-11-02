import type { Harness } from '../../core/harness.ts';
import { antigravityAdapter } from './antigravity.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { codexAdapter } from './codex.ts';
import type { HarnessAdapter } from './types.ts';

const ADAPTERS: Record<Harness, HarnessAdapter> = { 'claude-code': claudeCodeAdapter, codex: codexAdapter, antigravity: antigravityAdapter };

/** The adapter for a harness's hooks. */
export function adapterFor(h: Harness): HarnessAdapter {
  const a = ADAPTERS[h];
  if (!a) throw new Error(`nexus has no hook adapter for ${h}`);
  return a;
}
