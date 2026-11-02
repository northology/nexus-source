import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { NexusError } from '../errors.ts';
import { currentHarness, type Harness } from '../harness.ts';
import { activeBuilds } from '../lifecycle.ts';
import { readSnapshot } from '../snapshot.ts';
import { linkRefusal } from '../fs-guard.ts';
import { BUILD_DIR, buildPath } from '../paths.ts';
import { sha256 } from '../vault/generated.ts';
import { agentsMdItems } from './agents-md.ts';
import { attempt, displayPath, fileFacts, fold } from './env.ts';
import { instructionItems } from './instructions.ts';
import { memoryItems } from './memory.ts';
import { ruleFileItems } from './rule-files.ts';
import { instructionFilesSetting } from './settings.ts';
import { walkSubfolders, type SubfolderOptions } from './subfolders.ts';
import { SCOPE_ORDER } from './types.ts';
import type { Found, Inventory, InventoryEnv, InventoryItem, InventoryProblem, ItemKind, RecordStatus } from './types.ts';
import { vaultItems } from './vault.ts';

export { SCOPE_ORDER };
/**
 * What the server's slower subfolder walk found (server/events.ts); the 2 s poll's signature never includes it.
 * `harness` decides which instruction files are listed; unset is the one this package was built for.
 */
export interface InventoryOptions { subfolders?: Found[]; subfolderProblems?: InventoryProblem[]; harness?: Harness }

export const KIND_ORDER: ItemKind[] = ['rule', 'generated', 'decision', 'issue', 'instructions', 'rule-file', 'memory', 'guardrail'];

const RECORD: Record<ItemKind, RecordStatus> = {
  decision: 'recorded', rule: 'recorded', issue: 'recorded', generated: 'generated',
  instructions: 'outside', 'rule-file': 'outside', memory: 'outside', guardrail: 'build',
};

function guardrailItems(root: string, problems: InventoryProblem[] = []): Found[] {
  const out: Found[] = [];
  for (const build of activeBuilds(root)) {
    const file = buildPath(root, build, 'logs', 'guardrails.json');
    const snapshot = attempt(file, problems, () => readSnapshot(root, build));
    if (snapshot === null) continue;
    // readSnapshot turns a bad log into a problem and an empty list; keep that reason instead of dropping it.
    for (const p of snapshot.problems) if (p.file === 'logs/guardrails.json') problems.push({ location: file, message: p.message });
    for (const g of snapshot.guardrails) {
      if (g.state !== 'accepted') continue;
      out.push({ kind: 'guardrail', title: g.entry.name, file, scope: 'build', anchor: g.entry.name, text: g.entry.text, time: g.decided ?? g.entry.time });
    }
  }
  return out;
}

function toItem(f: Found, root: string, env: InventoryEnv, problems: InventoryProblem[]): InventoryItem | null {
  const location = displayPath(f.file, root, env.home, env.platform) + (f.anchor ? `#${f.anchor}` : '');
  let size: number;
  let changed: string;
  if (f.text !== undefined) {
    size = Buffer.byteLength(f.text);
    changed = f.time ?? '';
  } else {
    const facts = fileFacts(f.file, null, false); // the collector that found it checked its links
    if (facts === null) return null;
    if ('problem' in facts) {
      problems.push({ location: f.file, message: facts.problem });
      return null;
    }
    size = facts.size;
    changed = facts.changed;
  }
  return {
    id: sha256(`${f.kind}\u0000${location}`).slice(0, 12),
    kind: f.kind,
    title: f.title,
    location,
    scope: f.scope,
    ...(f.paths ? { paths: f.paths } : {}),
    ...(f.launchedFrom ? { launchedFrom: displayPath(f.launchedFrom, root, env.home, env.platform) } : {}),
    ...(f.folder ? { folder: displayPath(f.folder, root, env.home, env.platform) } : {}),
    ...(f.conditional ? { conditional: f.conditional } : {}),
    record: RECORD[f.kind],
    ...(f.source ? { source: f.kind === 'generated' ? f.source : displayPath(f.source, root, env.home, env.platform) } : {}),
    size,
    changed,
  };
}

/** The items and problems, guardrails included only when asked (the poll stats their logs instead). */
function collectItems(root: string, env: InventoryEnv, guardrails: boolean, opts: InventoryOptions = {}): Omit<Inventory, 'root'> {
  // Every caller (server, poll, CLI, reviews) gets the same harness, so an item's id means the same file in each.
  const harness = opts.harness ?? currentHarness();
  const problems: InventoryProblem[] = [...(opts.subfolderProblems ?? [])];
  const setting = harness === 'claude-code' ? instructionFilesSetting(env) : null;
  const v = vaultItems(root, problems);
  // Claude Code's files, memory and setting; another harness lists only the AGENTS.md files it loads (agents-md.ts).
  const own = harness === 'claude-code'
    ? [...ruleFileItems(root, env, problems), ...instructionItems(root, env, problems, setting?.value), ...memoryItems(root, env, problems), ...(opts.subfolders ?? [])]
    : agentsMdItems(root, env, harness, problems, opts.subfolders);
  const found = [...v.found, ...own, ...(guardrails ? guardrailItems(root, problems) : [])];
  const seen = new Set<string>();
  const items: InventoryItem[] = [];
  for (const f of found) {
    const key = fold(resolve(f.file), env.platform) + (f.anchor ? `#${f.anchor}` : '');
    if (seen.has(key)) continue;
    seen.add(key);
    const item = toItem(f, root, env, problems);
    if (item) items.push(item);
  }
  items.sort((a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.location.localeCompare(b.location));
  return {
    vault: v.vault,
    items,
    problems: problems.map((p) => ({ location: displayPath(p.location, root, env.home, env.platform), message: p.message })),
    harness,
    setting: setting === null ? null : { value: setting.value, from: setting.from === null ? null : displayPath(setting.from, root, env.home, env.platform) },
  };
}

/** The standing instructions an agent can load from the repo (reference/cockpit.md says what isn't listed). Reads only; never creates anything. */
export function governanceInventory(root: string, env: InventoryEnv, opts: InventoryOptions = {}): Inventory {
  return { root, ...collectItems(root, env, true, opts) };
}

/** The inventory with a fresh walk below the root: `governance list`, and the rows a review is checked against. */
export function fullInventory(root: string, env: InventoryEnv, opts: SubfolderOptions & { harness?: Harness } = {}): Inventory {
  const w = walkSubfolders(root, env, opts);
  return governanceInventory(root, env, { subfolders: w.found, subfolderProblems: w.problems, ...(opts.harness ? { harness: opts.harness } : {}) });
}

/**
 * Each build's build.json, guardrail log and gate files by size and time, from which accepted guardrails come: one stat
 * each, no file read. Builds and gate files are real entries only (a link is skipped, as listBuilds skips one), and each
 * path's links are checked before a stat or listing follows them: a network or device link counts as "-".
 */
function buildStats(root: string): string {
  const dir = join(root, BUILD_DIR);
  if (linkRefusal(root, dir) !== null) return '-';
  const stat = (p: string): string => {
    if (linkRefusal(root, p) !== null) return '-';
    try {
      const s = statSync(p);
      return `${s.size}-${s.mtimeMs}`;
    } catch {
      return '-';
    }
  };
  const names = (d: string, real: (e: Dirent) => boolean): string[] => {
    if (linkRefusal(root, d) !== null) return [];
    try {
      return readdirSync(d, { withFileTypes: true }).filter(real).map((e) => e.name).sort();
    } catch {
      return [];
    }
  };
  return names(dir, (e) => e.isDirectory())
    .map((b) => `${b}|${stat(join(dir, b, 'build.json'))}|${stat(join(dir, b, 'logs', 'guardrails.json'))}|${names(join(dir, b, 'gates'), (e) => e.isFile()).map((g) => `${g}:${stat(join(dir, b, 'gates', g))}`).join(',')}`)
    .join('\n');
}

/**
 * What the live poll compares, by stat: every item but the guardrails by location, size and time, each problem, and
 * buildStats. Titles, imports, settings and frontmatter come through the text cache, so a poll reads no file contents
 * unless a file changed (the first one reads them once).
 */
export function inventorySignature(root: string, env: InventoryEnv, harness?: Harness): string {
  const { items, problems, setting: s } = collectItems(root, env, false, harness ? { harness } : {});
  return [...items.map((i) => `${i.location}|${i.size}|${i.changed}`), ...problems.map((p) => `!${p.location}|${p.message}`), `setting|${s?.value ?? ''}|${s?.from ?? ''}`, '--', buildStats(root)].join('\n');
}

/** One item's text, by id from a fresh inventory: nothing here reads a path a caller names. */
export function readInventoryItem(root: string, env: InventoryEnv, id: string, opts: InventoryOptions = {}): { item: InventoryItem; text: string } {
  const item = governanceInventory(root, env, opts).items.find((i) => i.id === id);
  if (!item) throw new NexusError('No standing instruction with that id', 404);
  if (item.kind === 'guardrail') {
    const at = item.location.indexOf('#');
    const location = item.location.slice(0, at);
    const name = item.location.slice(at + 1);
    const g = guardrailItems(root).find((f) => f.anchor === name && displayPath(f.file, root, env.home, env.platform) === location);
    if (!g?.text) throw new NexusError('No standing instruction with that id', 404);
    return { item, text: g.text };
  }
  const file = item.location.startsWith('~/') ? resolve(env.home, item.location.slice(2)) : resolve(root, item.location);
  try {
    return { item, text: readFileSync(file, 'utf8') };
  } catch {
    throw new NexusError(`${item.location} can't be read`, 404);
  }
}
