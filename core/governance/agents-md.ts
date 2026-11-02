import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Harness } from '../harness.ts';
import { cachedText } from '../text-cache.ts';
import { readFrontmatter } from '../vault/frontmatter.ts';
import { readMarker } from '../vault/generated.ts';
import { AGENT_RULES_DIR, AGENT_RULES_PREFIX } from '../vault/generate.ts';
import { attempt, fileFacts, linkProblem } from './env.ts';
import { titleOf } from './instructions.ts';
import type { Found, InventoryEnv, InventoryProblem } from './types.ts';

// The instruction files Codex and Antigravity load, both pinned to AGENTS.md (phase-9 scope). Codex reads its global
// file from CODEX_HOME (AGENTS.override.md first) and AGENTS.md from the repo root down to the folder it starts in;
// Antigravity reads ~/.gemini/AGENTS.md and the workspace's AGENTS.md. Sources: the phase-9 cross-harness research note.

export const AGENTS_MD_NOTES = {
  codex: (folder: string): string => `loads when Codex starts in ${folder}/ or below`,
  antigravity: "Antigravity doesn't load files below the workspace",
  noTrigger: 'Antigravity drops a rule without a trigger it knows',
} as const;

/**
 * The workspace's .agents/rules/*.md, which Antigravity reads flat (its rules doc): scoped by trigger, and generated
 * when it is a nexus- file with nexus's marker.
 */
function agentRuleItems(root: string, found: Found[], problems: InventoryProblem[]): void {
  const dir = join(root, AGENT_RULES_DIR);
  const refused = linkProblem(dir, root);
  if (refused !== null) {
    problems.push({ location: dir, message: refused.problem });
    return;
  }
  if (!existsSync(dir)) return;
  const entries = attempt(dir, problems, () => readdirSync(dir, { withFileTypes: true }));
  for (const e of [...(entries ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.name.toLowerCase().endsWith('.md') || e.isDirectory()) continue;
    const file = join(dir, e.name);
    const facts = fileFacts(file, dir, root);
    if (facts === null) continue;
    if ('problem' in facts) {
      problems.push({ location: file, message: facts.problem });
      continue;
    }
    const text = attempt(file, problems, () => cachedText(file));
    if (text === null) continue;
    const data = readFrontmatter(text).data;
    const trigger = data?.['trigger'];
    const globs = data?.['globs'] ?? data?.['glob'];
    const paths = trigger === 'glob' && typeof globs === 'string' ? globs.split(',').map((g) => g.trim()).filter((g) => g !== '') : [];
    const marker = e.name.startsWith(AGENT_RULES_PREFIX) ? readMarker(text) : null;
    const scope = trigger === 'always_on' ? 'always' : paths.length ? 'path-scoped' : 'on-demand';
    const known = ['always_on', 'glob', 'model_decision', 'manual'].includes(String(trigger));
    found.push({
      kind: marker ? 'generated' : 'rule-file',
      title: titleOf(text, file),
      file,
      scope,
      ...(paths.length ? { paths } : {}),
      ...(marker ? { source: marker.source } : {}),
      ...(known ? {} : { conditional: AGENTS_MD_NOTES.noTrigger }),
    });
  }
}

function add(file: string, within: string, scope: Found['scope'], found: Found[], problems: InventoryProblem[], extra: Partial<Found> = {}): boolean {
  const facts = fileFacts(file, within);
  if (facts === null) return false;
  if ('problem' in facts) {
    problems.push({ location: file, message: facts.problem });
    return false;
  }
  const text = attempt(file, problems, () => cachedText(file));
  if (text === null) return false;
  found.push({ kind: 'instructions', title: titleOf(text, file), file, scope, ...extra });
  return true;
}

/** The global file, the repo's AGENTS.md, and the subfolder ones the walk found, with the harness's own notes. */
export function agentsMdItems(root: string, env: InventoryEnv, harness: Exclude<Harness, 'claude-code'>, problems: InventoryProblem[], subfolders: Found[] = []): Found[] {
  const found: Found[] = [];
  if (harness === 'codex') {
    const home = env.codexHome ?? join(env.home, '.codex');
    if (!add(join(home, 'AGENTS.override.md'), home, 'always', found, problems)) add(join(home, 'AGENTS.md'), home, 'always', found, problems);
  } else {
    const gemini = join(env.home, '.gemini');
    add(join(gemini, 'AGENTS.md'), gemini, 'always', found, problems);
  }
  add(join(root, 'AGENTS.md'), root, 'always', found, problems);
  if (harness === 'antigravity') agentRuleItems(root, found, problems);
  for (const f of subfolders) {
    if (f.kind !== 'instructions' || basename(f.file) !== 'AGENTS.md' || f.folder === undefined) continue;
    const folder = f.folder.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
    found.push({ ...f, conditional: harness === 'codex' ? AGENTS_MD_NOTES.codex(folder) : AGENTS_MD_NOTES.antigravity });
  }
  return found;
}
