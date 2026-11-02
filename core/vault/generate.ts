import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NexusError } from '../errors.ts';
import { currentHarness, type Harness } from '../harness.ts';
import { BLOCK_END, BLOCK_START, RULES_END, RULES_START } from '../init/shared.ts';
import { walkVault } from './check.ts';
import { readFrontmatter, type Frontmatter } from './frontmatter.ts';
import { lf, readMarker, withMarker } from './generated.ts';
import { linkFiles, typedLinkValues } from './links.ts';
import { isVault, readRegistry } from './registry.ts';
import { DIVISIONS } from './types.ts';

export const RULES_DIR = '.claude/rules/nexus';
export const HUBS_DIR = 'docs/dev/context';
/** Antigravity scans .agents/rules/ flat (its rules doc), so nexus's files sit there, told apart by this prefix. */
export const AGENT_RULES_DIR = '.agents/rules';
export const AGENT_RULES_PREFIX = 'nexus-';
/** Codex reads no rules folder: its rules go into a generated section of this file's nexus block. */
export const AGENTS_FILE = 'AGENTS.md';
const SECTION_SOURCE = 'docs/governance/rules/';
/** The markers that delimit nexus's block and Codex's section in AGENTS.md: each appears there once, and in no rule. */
const MARKERS = [BLOCK_START, BLOCK_END, RULES_START, RULES_END];

/**
 * True for a repo-relative path generate owns for this harness's rules: .claude/rules/nexus/ files, Antigravity's
 * .agents/rules/nexus-*.md. Codex's rules live in AGENTS.md, which the user owns too, so no path is wholly generate's.
 */
export function isGeneratedRule(harness: Harness, path: string): boolean {
  const target = ruleTarget(harness);
  if (target === null) return false;
  if (!path.startsWith(`${target.dir}/`)) return false;
  const rest = path.slice(target.dir.length + 1);
  return target.prefix === '' || (rest.startsWith(target.prefix) && rest.endsWith('.md') && !rest.includes('/'));
}

/** Where a harness's rule files go, and the name each starts with; null for Codex, whose rules go into AGENTS.md. */
export function ruleTarget(harness: Harness): { dir: string; prefix: string } | null {
  if (harness === 'claude-code') return { dir: RULES_DIR, prefix: '' };
  if (harness === 'antigravity') return { dir: AGENT_RULES_DIR, prefix: AGENT_RULES_PREFIX };
  return null;
}

export type GenerateKind = 'missing' | 'stale' | 'edited' | 'orphaned' | 'unmarked' | 'duplicate' | 'invalid';
export interface GenerateIssue { file: string; kind: GenerateKind }
/**
 * refusals: why generate won't write (a duplicate output, a rule it can't generate), one sentence each. section: under
 * Codex, the text of AGENTS.md's rules section (written between its markers when writes names AGENTS.md); else null.
 */
export interface GeneratePlan { expected: Map<string, string>; writes: string[]; removes: string[]; issues: GenerateIssue[]; refusals: string[]; section: string | null }

interface Doc { rel: string; fm: Frontmatter }
interface Rule { source: string; body: string[]; paths: string[] }
interface Outputs { out: Map<string, string>; issues: GenerateIssue[]; refusals: string[]; rules: Rule[] }

const archived = (rel: string): boolean => rel.startsWith('governance/archive/') || rel.startsWith('superpowers/archive/');
const link = (rel: string): string => `- [[${rel.replace(/\.md$/, '')}]]`;

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && (lines[a] ?? '').trim() === '') a += 1;
  while (b > a && (lines[b - 1] ?? '').trim() === '') b -= 1;
  return lines.slice(a, b);
}

/** The frontmatter that scopes a rule file: Claude Code's paths list, or Antigravity's trigger and globs string. */
function ruleHead(harness: Harness, paths: string[]): string[] {
  if (harness === 'antigravity') {
    return ['---', ...(paths.length ? ['trigger: glob', `globs: ${JSON.stringify(paths.join(', '))}`] : ['trigger: always_on']), '---'];
  }
  return paths.length ? ['---', 'paths:', ...paths.map((p) => `  - ${JSON.stringify(p)}`), '---'] : [];
}

/**
 * One rule file per active rule note, where the harness reads them (Codex's are kept for its AGENTS.md section); a
 * scoped rule carries its paths. Two notes that would write the same file, or a scoped rule with no usable paths, are
 * refused rather than dropped or loaded everywhere.
 */
function ruleFiles(docs: Doc[], g: Outputs, harness: Harness): void {
  const target = ruleTarget(harness);
  const sources = new Map<string, string>();
  for (const n of docs) {
    const d = n.fm.data;
    if (!d || d['class'] !== 'rule' || d['status'] !== 'active' || archived(n.rel)) continue;
    const source = `docs/${n.rel}`;
    const name = (n.rel.split('/').at(-1) ?? '').replace(/\.md$/, '');
    const file = target === null ? source : `${target.dir}/${target.prefix}${name}.md`;
    const paths = Array.isArray(d['paths']) ? d['paths'].filter((p): p is string => typeof p === 'string' && p !== '') : [];
    if (d['tier'] === 'scoped' && paths.length === 0) {
      g.issues.push({ file: source, kind: 'invalid' });
      g.refusals.push(`${source} is a scoped rule with no paths, so it would load everywhere; give it paths: (nexus docs check names the problem)`);
      continue;
    }
    const earlier = sources.get(file);
    if (earlier) {
      g.out.delete(file);
      g.issues.push({ file, kind: 'duplicate' });
      g.refusals.push(`${earlier} and ${source} both generate ${file}; rename one of the rule notes`);
      continue;
    }
    sources.set(file, source);
    const scoped = d['tier'] === 'scoped' ? paths : [];
    // Codex's rules are written inside AGENTS.md's block, where a quoted marker would end the section or the block early.
    const quoted = target === null ? MARKERS.find((m) => n.fm.body.some((l) => l.includes(m))) : undefined;
    if (quoted !== undefined) {
      g.issues.push({ file: source, kind: 'invalid' });
      g.refusals.push(`${source} quotes a nexus block marker (${quoted}); inside AGENTS.md it would cut nexus's section short, so reword it`);
      continue;
    }
    if (target === null) g.rules.push({ source, body: trimBlank(n.fm.body), paths: scoped });
    else g.out.set(file, withMarker([...ruleHead(harness, scoped), ...trimBlank(n.fm.body), ''].join('\n'), source));
  }
}

/** Headings pushed three levels down (to at most ######), outside fenced blocks, so a rule sits under the section's. */
function demote(lines: string[]): string[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (f !== undefined && (fence === null || (f[0] === fence[0] && f.length >= fence.length))) fence = fence === null ? f : null;
    const h = fence === null ? /^(#{1,6})([ \t].*)$/.exec(line) : null;
    return h?.[1] && h[2] !== undefined ? `${'#'.repeat(Math.min(6, h[1].length + 3))}${h[2]}` : line;
  });
}

/** Codex's rules section: the always rules in full, then each scoped one by its note and paths. */
function codexSection(rules: Rule[]): string {
  const sorted = [...rules].sort((a, b) => a.source.localeCompare(b.source));
  const always = sorted.filter((r) => r.paths.length === 0);
  const scoped = sorted.filter((r) => r.paths.length > 0);
  const lines = ['### Standing rules', ''];
  if (!sorted.length) lines.push('The vault has no active rules.');
  for (const r of always) lines.push(...demote(r.body), '', `Generated from \`${r.source}\`.`, '');
  if (scoped.length) {
    lines.push('Read each of these before working in its paths:', '');
    for (const r of scoped) {
      const title = r.body.map((l) => /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(l)?.[1]).find((t) => t !== undefined);
      lines.push(`- ${title ? `${title}: ` : ''}\`${r.source}\`, for ${r.paths.map((p) => `\`${p}\``).join(', ')}`);
    }
  }
  return withMarker([...trimBlank(lines), ''].join('\n'), SECTION_SOURCE);
}

/** Where the rules section's text runs in AGENTS.md (after its start line, up to its end marker); null when it has none. */
function findSection(text: string): { start: number; end: number } | null {
  const block = text.indexOf(BLOCK_START);
  const blockEnd = block === -1 ? -1 : text.indexOf(BLOCK_END, block);
  const at = block === -1 ? -1 : text.indexOf(RULES_START, block);
  const end = at === -1 ? -1 : text.indexOf(RULES_END, at);
  if (blockEnd === -1 || at === -1 || end === -1 || end > blockEnd) return null;
  const nl = /^\r?\n/.exec(text.slice(at + RULES_START.length))?.[0] ?? '';
  return { start: at + RULES_START.length + nl.length, end };
}

/** Plans Codex's section like a generated file: missing, current, stale, edited or unmarked, judged by its marker. */
function planSection(root: string, plan: GeneratePlan, section: string): void {
  const path = join(root, AGENTS_FILE);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  // A marker that appears twice (a hand edit, or text quoting one) makes the section's edges a guess: stop, don't splice.
  if (current !== null && MARKERS.some((m) => current.split(m).length > 2)) {
    plan.issues.push({ file: AGENTS_FILE, kind: 'invalid' });
    plan.refusals.push(`${AGENTS_FILE}'s nexus rules section holds a nexus marker more than once, so its edges are unclear: put the block back to one ${BLOCK_START} … ${BLOCK_END} with one ${RULES_START} and ${RULES_END} inside, by hand`);
    return;
  }
  const at = current === null ? null : findSection(current);
  if (current === null || at === null) {
    plan.issues.push({ file: AGENTS_FILE, kind: 'missing' });
    plan.refusals.push(`${AGENTS_FILE} has no nexus rules section (${RULES_START} and ${RULES_END} inside its nexus block): run nexus init from Codex, which adds nexus's block with that section, or put those two lines inside the block by hand`);
    return;
  }
  const inner = current.slice(at.start, at.end);
  if (lf(inner).trim() === '') {
    plan.writes.push(AGENTS_FILE);
    plan.issues.push({ file: AGENTS_FILE, kind: 'missing' });
    return;
  }
  const marker = readMarker(inner);
  if (!marker) {
    plan.issues.push({ file: AGENTS_FILE, kind: 'unmarked' });
    return;
  }
  if (lf(inner) === lf(section)) return;
  plan.writes.push(AGENTS_FILE);
  plan.issues.push({ file: AGENTS_FILE, kind: marker.hash === marker.actual ? 'stale' : 'edited' });
}

/** The repo's decision and issue logs, docs-relative, which a hub's Builds section links beside the records. */
const REPO_LOGS = ['governance/decisions.json', 'governance/issues.json'];

/**
 * One hub per component (or, with none listed, per division) that has notes: its notes by class, then what it uses
 * and feeds elsewhere, then its builds: the build records naming it (the governance hub takes them all when no
 * components are listed) and the repo's two logs.
 */
function hubFiles(docs: Doc[], components: string[], out: Map<string, string>, docsDir: string): void {
  const isRecord = (n: Doc): boolean => n.fm.data?.['class'] === 'build-record';
  const records = docs.filter((n) => !archived(n.rel) && isRecord(n));
  const logs = REPO_LOGS.filter((l) => existsSync(join(docsDir, l)));
  const live = docs.filter((n) => !archived(n.rel) && typeof n.fm.data?.['class'] === 'string' && n.fm.data['class'] !== 'hub');
  // Uses and Feeds point only at live notes: archived ones and other hubs are left out, as they are from the lists.
  const componentOf = new Map<string, unknown>(live.map((n): [string, unknown] => [n.rel, n.fm.data?.['component']]));
  const groups = components.length
    ? components.map((c) => ({ name: c, component: c, notes: live.filter((n) => n.fm.data?.['component'] === c) }))
    : DIVISIONS.map((d) => ({ name: d as string, component: 'shared', notes: live.filter((n) => n.rel.startsWith(`${d}/`)) }));
  for (const g of groups) {
    const builds = components.length
      ? records.filter((r) => { const c = r.fm.data?.['components']; return (Array.isArray(c) ? c : [c]).includes(g.component); })
      : g.name === 'governance' ? records : [];
    const notes = g.notes.filter((n) => !isRecord(n));
    if (notes.length === 0 && builds.length === 0) continue;
    const byClass = new Map<string, string[]>();
    for (const n of notes) {
      const c = String(n.fm.data?.['class']);
      byClass.set(c, [...(byClass.get(c) ?? []), n.rel]);
    }
    const across = (key: 'uses' | 'feeds'): string[] => {
      if (!components.length) return [];
      const targets = notes.flatMap((n) =>
        typedLinkValues(n.fm.data?.[key]).links.flatMap((inner) => {
          const file = linkFiles(inner).find((f) => componentOf.has(f));
          return file && componentOf.get(file) !== g.component ? [file] : [];
        }),
      );
      return [...new Set(targets)].sort();
    };
    const lines = ['---', 'class: hub', `component: ${g.component}`, '---', `# ${g.name}`];
    for (const c of [...byClass.keys()].sort()) lines.push('', `## ${c}`, '', ...(byClass.get(c) ?? []).sort().map(link));
    for (const [title, list] of [['Uses', across('uses')], ['Feeds', across('feeds')]] as const) {
      if (list.length) lines.push('', `## ${title}`, '', ...list.map(link));
    }
    if (builds.length) lines.push('', '## Builds', '', ...builds.map((r) => r.rel).sort().map(link), ...logs.map((l) => `- [[${l}]]`));
    out.set(`${HUBS_DIR}/${g.name}.md`, withMarker([...lines, ''].join('\n'), 'the vault'));
  }
}

function outputs(root: string, harness: Harness): Outputs {
  const g: Outputs = { out: new Map(), issues: [], refusals: [], rules: [] };
  const docsDir = join(root, 'docs');
  if (!isVault(docsDir)) return g;
  const { registry } = readRegistry(docsDir);
  const docs: Doc[] = walkVault(docsDir).notes.map((rel) => ({ rel, fm: readFrontmatter(readFileSync(join(docsDir, rel), 'utf8')) }));
  ruleFiles(docs, g, harness);
  hubFiles(docs, [...registry.components].sort(), g.out, docsDir);
  return g;
}

/**
 * Every file docs generate would write, repo-relative, with its full text. Empty outside a vault. `harness` (unset: the
 * one this package was built for) decides where rule files go; Codex's section isn't a file, so it isn't here.
 */
export function expectedOutputs(root: string, harness: Harness = currentHarness()): Map<string, string> {
  return outputs(root, harness).out;
}

/** What generate would change, read-only. Comparisons are on LF text, so a CRLF checkout reads as current. */
export function planGenerate(root: string, harness: Harness = currentHarness()): GeneratePlan {
  const g = outputs(root, harness);
  const vault = isVault(join(root, 'docs'));
  const section = vault && harness === 'codex' ? codexSection(g.rules) : null;
  const plan: GeneratePlan = { expected: g.out, writes: [], removes: [], issues: [...g.issues], refusals: [...g.refusals], section };
  if (!vault) return plan;
  for (const [file, text] of [...plan.expected].sort(([a], [b]) => a.localeCompare(b))) {
    const path = join(root, file);
    if (!existsSync(path)) {
      plan.writes.push(file);
      plan.issues.push({ file, kind: 'missing' });
      continue;
    }
    const current = readFileSync(path, 'utf8');
    const marker = readMarker(current);
    if (!marker) {
      plan.issues.push({ file, kind: 'unmarked' });
      continue;
    }
    if (lf(current) === lf(text)) continue;
    plan.writes.push(file);
    plan.issues.push({ file, kind: marker.hash === marker.actual ? 'stale' : 'edited' });
  }
  if (section !== null) planSection(root, plan, section);
  const target = ruleTarget(harness);
  for (const { dir, prefix } of [...(target ? [target] : []), { dir: HUBS_DIR, prefix: '' }]) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${dir}/${e.name}`;
      if (!e.isFile() || !e.name.endsWith('.md') || !e.name.startsWith(prefix) || plan.expected.has(file) || plan.issues.some((i) => i.file === file && i.kind === 'duplicate')) continue;
      if (readMarker(readFileSync(join(abs, e.name), 'utf8'))) {
        plan.removes.push(file);
        plan.issues.push({ file, kind: 'orphaned' });
      } else {
        plan.issues.push({ file, kind: 'unmarked' });
      }
    }
  }
  return plan;
}

/** Writes and removes what the plan says. An unmarked file, or anything it refuses, stops it before anything is touched. */
export function applyGenerate(root: string, plan: GeneratePlan): void {
  const unmarked = plan.issues.filter((i) => i.kind === 'unmarked').map((i) => i.file);
  const reasons = [...plan.refusals];
  if (unmarked.length) {
    reasons.push(`${unmarked.join(', ')} ${unmarked.length === 1 ? 'has' : 'have'} no generated marker. nexus never overwrites or deletes a file it can't prove it wrote: move it out of the way, then run nexus docs generate again.`);
  }
  if (reasons.length) throw new NexusError(reasons.join('\n'));
  for (const file of plan.writes) {
    const path = join(root, file);
    if (file === AGENTS_FILE && plan.section !== null) {
      // Only the text between the section's markers changes, in the file's own line endings.
      const current = readFileSync(path, 'utf8');
      const at = findSection(current);
      if (at === null) throw new NexusError(`${AGENTS_FILE} lost its nexus rules section while generate ran; run it again`);
      const eol = current.includes('\r\n') ? '\r\n' : '\n';
      writeFileSync(path, `${current.slice(0, at.start)}${plan.section.replace(/\n/g, eol)}${current.slice(at.end)}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, plan.expected.get(file) ?? '');
  }
  for (const file of plan.removes) rmSync(join(root, file), { force: true });
}
