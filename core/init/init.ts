import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { NexusError } from '../errors.ts';
import { currentHarness, type Harness } from '../harness.ts';
import { ruleTarget } from '../vault/generate.ts';
import { readMarker } from '../vault/generated.ts';
import { answersText, parseAnswers, type InitAnswers } from './answers.ts';
import { addBlock, addLines, addSettings, type SharedResult } from './shared.ts';
import { REGISTRY_ENTRIES, REPO_NAME_TOKEN } from './standard.ts';

export type InitActionKind = 'create' | 'add' | 'present';
export interface InitAction { path: string; kind: InitActionKind; data: string | Uint8Array }
export interface InitPlan { actions: InitAction[]; problems: string[] }
/** `harness`: whose files init writes; unset is the one this package was built for. */
export interface PlanInitOptions { standard: string; answers: InitAnswers; downloads: Map<string, Uint8Array> | null; repoName: string; harness?: Harness }
export type Writer = (abs: string, data: string | Uint8Array) => void;

export const GITIGNORE_LINES = ['.scratch/', 'docs/.obsidian/workspace*.json'];
export const IGNORE_LINES = ['docs/governance/archive/', 'docs/superpowers/archive/'];

const flow = (items: string[]): string => `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;

/** Every file under dir, relative to it, with forward slashes. */
function filesUnder(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, r) : [r];
  });
}

/** docs/_meta/ from standard/, with the answers' components and tags in place of the empty lists. */
function registryFiles(standard: string, a: InitAnswers): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of REGISTRY_ENTRIES) {
    const src = join(standard, entry);
    const rels = statSync(src).isDirectory() ? filesUnder(src).map((f) => `${entry}/${f}`) : [entry];
    for (const rel of rels) out.set(`docs/_meta/${rel}`, readFileSync(join(standard, rel), 'utf8'));
  }
  const set = (rel: string, key: string, items: string[]): void => {
    out.set(rel, (out.get(rel) ?? '').replace(new RegExp(`^${key}: \\[\\]$`, 'm'), `${key}: ${flow(items)}`));
  };
  set('docs/_meta/components.md', 'components', a.components);
  set('docs/_meta/tags.md', 'vocabulary', a.tags);
  return out;
}

/** docs/.obsidian/ settings from standard/obsidian/vault/, with the repo's name where the settings ask for it. */
function obsidianFiles(standard: string, repoName: string): Map<string, string> {
  const dir = join(standard, 'obsidian', 'vault');
  const name = JSON.stringify(repoName).slice(1, -1);
  return new Map(filesUnder(dir).map((rel): [string, string] => [`docs/.obsidian/${rel}`, readFileSync(join(dir, rel), 'utf8').split(REPO_NAME_TOKEN).join(name)]));
}

const read = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** The same answers, however the file was written: compared by meaning, not by bytes (the skill writes it by hand). */
function sameAnswers(text: string, answers: InitAnswers): boolean {
  try {
    return answersText(parseAnswers(JSON.parse(text.replace(/^﻿/, '')))) === answersText(answers);
  } catch {
    return false;
  }
}

/**
 * What a repo already holds that init can't build on: notes in docs/ (init sets up an empty vault; legacy content is
 * pieced in afterwards), and hand-written files where generate writes, which it would stop on after init had written.
 */
function existingContent(root: string, harness: Harness): string[] {
  const problems: string[] = [];
  const docs = join(root, 'docs');
  if (existsSync(docs)) {
    const held = readdirSync(docs, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'README.md')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    if (held.length) problems.push(`docs/ already holds ${held.join(', ')}: init sets up an empty vault, so move them out first and piece them in after (nothing was written)`);
  }
  return [...problems, ...unmarkedRules(root, harness)];
}

/** Hand-written files where generate writes this harness's rules, which it would stop on after init had written. */
function unmarkedRules(root: string, harness: Harness): string[] {
  const problems: string[] = [];
  const target = ruleTarget(harness);
  const rules = target === null ? null : join(root, target.dir);
  if (target !== null && rules !== null && existsSync(rules)) {
    // Antigravity's folder is shared with the user's own rules: only the nexus- files are ours.
    const ours = target.prefix ? `${target.dir}/${target.prefix}*.md files are ones nexus generates` : `${target.dir}/ holds only files nexus generates`;
    for (const e of readdirSync(rules, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isFile() && e.name.endsWith('.md') && e.name.startsWith(target.prefix) && !readMarker(readFileSync(join(rules, e.name), 'utf8'))) {
        problems.push(`${target.dir}/${e.name} has no generated marker: ${ours}, so move it first`);
      }
    }
  }
  return problems;
}

/** The files a repo may already have that init adds to for this harness: its own instruction file, then the ignores. */
function sharedFiles(standard: string, harness: Harness): [string, (text: string | null) => SharedResult][] {
  // Claude Code gets its plugin setting and CLAUDE.md; Codex and Antigravity read AGENTS.md, each with its own block.
  const own: [string, (text: string | null) => SharedResult][] = harness === 'claude-code'
    ? [['.claude/settings.json', addSettings], ['CLAUDE.md', (t) => addBlock(t, readFileSync(join(standard, 'claude-block.md'), 'utf8'))]]
    : [['AGENTS.md', (t) => addBlock(t, readFileSync(join(standard, `${harness}-block.md`), 'utf8'))]];
  return [...own, ['.gitignore', (t) => addLines(t, GITIGNORE_LINES)], ['.ignore', (t) => addLines(t, IGNORE_LINES)]];
}

function planShared(root: string, standard: string, harness: Harness, plan: InitPlan): void {
  for (const [path, add] of sharedFiles(standard, harness)) {
    const r = add(read(join(root, path)));
    if (r.status === 'conflict') plan.problems.push(`${path}: ${r.reason ?? 'conflict'}`);
    else plan.actions.push({ path, kind: r.status, data: r.text ?? '' });
  }
}

/**
 * A repo already set up (docs/_meta/ is there) taking Codex or Antigravity as well: only that harness's own files, with
 * the vault, the answers and the downloads left as they are. Claude Code's init still runs only on a new repo.
 */
function planAddHarness(root: string, standard: string, harness: Exclude<Harness, 'claude-code'>): InitPlan {
  const plan: InitPlan = { actions: [], problems: unmarkedRules(root, harness) };
  planShared(root, standard, harness, plan);
  if (!plan.problems.length && plan.actions.every((a) => a.kind === 'present')) {
    return { actions: [], problems: [`this repo is already set up for ${harness} (docs/_meta/ and AGENTS.md's nexus block are there)`] };
  }
  return plan;
}

/** Everything init would do, and every reason it can't. Reads only; writes nothing. */
export function planInit(root: string, opts: PlanInitOptions): InitPlan {
  const harness = opts.harness ?? currentHarness();
  if (existsSync(join(root, 'docs', '_meta'))) {
    if (harness !== 'claude-code') return planAddHarness(root, opts.standard, harness);
    return { actions: [], problems: ['docs/_meta/ already exists: this repo is already set up (init runs once per repo)'] };
  }
  const actions: InitAction[] = [];
  const problems: string[] = [];
  const creates = new Map<string, string | Uint8Array>([...registryFiles(opts.standard, opts.answers), ...obsidianFiles(opts.standard, opts.repoName), ...(opts.downloads ?? [])]);
  for (const [path, data] of creates) {
    if (existsSync(join(root, path))) problems.push(`${path} already exists`);
    else actions.push({ path, kind: 'create', data });
  }
  problems.push(...existingContent(root, harness));
  const answers = '.nexus/init-answers.json';
  const current = read(join(root, answers));
  if (current === null) actions.push({ path: answers, kind: 'create', data: answersText(opts.answers) });
  else if (sameAnswers(current, opts.answers)) actions.push({ path: answers, kind: 'present', data: current });
  else problems.push(`${answers} already exists with other answers`);
  const plan: InitPlan = { actions, problems };
  planShared(root, opts.standard, harness, plan);
  return plan;
}

function ensureDir(dir: string, made: string[]): void {
  if (existsSync(dir)) return;
  ensureDir(dirname(dir), made);
  mkdirSync(dir);
  made.push(dir);
}

/** Writes a plan with no problems. If a write fails, removes what it created and restores what it added to. */
export function applyPlan(root: string, plan: InitPlan, writer: Writer = writeFileSync): void {
  if (plan.problems.length) throw new NexusError(`init stopped on ${plan.problems.length} problem(s); nothing was written`);
  const created: string[] = [];
  const dirs: string[] = [];
  const restore: { abs: string; text: string }[] = [];
  try {
    for (const a of plan.actions) {
      if (a.kind === 'present') continue;
      const abs = join(root, a.path);
      if (a.kind === 'add') restore.push({ abs, text: readFileSync(abs, 'utf8') });
      ensureDir(dirname(abs), dirs);
      if (a.kind === 'create') created.push(abs);
      writer(abs, a.data);
    }
  } catch (e) {
    // Each undo step on its own, so one that fails can't hide the first error or stop the rest.
    const stuck: string[] = [];
    const attempt = (abs: string, undo: () => void): void => {
      try {
        undo();
      } catch {
        stuck.push(relative(root, abs).replace(/\\/g, '/'));
      }
    };
    for (const f of created.reverse()) attempt(f, () => rmSync(f, { force: true }));
    for (const r of restore) attempt(r.abs, () => writeFileSync(r.abs, r.text));
    for (const d of dirs.reverse()) {
      try {
        rmdirSync(d);
      } catch {
        // A folder that still holds something wasn't only ours.
      }
    }
    const first = `init failed while writing (${(e as Error).message})`;
    throw new NexusError(stuck.length
      ? `${first}; it removed what it could, but couldn't restore ${stuck.join(', ')}: put those right by hand`
      : `${first}; everything it wrote was removed and the shared files were restored`);
  }
}

const GROUPS = ['docs/_meta/', 'docs/.obsidian/plugins/', 'docs/.obsidian/themes/', 'docs/.obsidian/'];

/** One line per group of created files, and per shared file. */
export function describePlan(plan: InitPlan): string[] {
  const rows = new Map<string, { kind: InitActionKind; group: string; count: number }>();
  for (const a of plan.actions) {
    const group = a.kind === 'create' ? (GROUPS.find((g) => a.path.startsWith(g)) ?? a.path) : a.path;
    const key = `${a.kind} ${group}`;
    rows.set(key, { kind: a.kind, group, count: (rows.get(key)?.count ?? 0) + 1 });
  }
  return [...rows.values()].map((r) => `  ${r.kind.padEnd(8)} ${r.group}${r.group.endsWith('/') ? ` (${r.count} files)` : ''}`);
}
