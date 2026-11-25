import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { NexusError } from '../errors.ts';
import { gitTry, insideGit } from '../git.ts';
import { globToRegExp } from '../protect.ts';
import { checkVault, walkVault } from './check.ts';
import { readFrontmatter } from './frontmatter.ts';
import { planGenerate, type GenerateIssue } from './generate.ts';
import { isVault } from './registry.ts';
import { cleanSource, thingNotes, under } from './touched.ts';

/**
 * How a thing note's source stands: a path in the working tree, a path git once tracked that is gone, or a name that
 * was never a repo path (a database view, a service, an external system).
 */
export type SourceState = 'present' | 'gone' | 'not-a-path';

export interface AuditNote {
  note: string;
  class: string;
  component: string | null;
  source: string;
  state: SourceState;
  /** The note's last commit; null when it has none yet. */
  noteCommit: string | null;
  /** Commits touching the source after noteCommit: `git diff <noteCommit> -- <source>` shows what they changed. */
  sourceCommits: number;
  /** The source has changes not yet committed. */
  uncommitted: boolean;
}

/** A file, or a folder whose every file no note covers, rolled up to one entry. */
export interface UncoveredEntry { path: string; folder: boolean; files: number; sample: string[] }

export interface AuditIssue {
  name: string;
  /** The issues log (docs/governance/issues.json), or an issue note. */
  from: 'log' | 'note';
  status: string;
  text: string;
  /** The issue note's file, when it is one. */
  file?: string;
  /** When it was logged (an ISO time), or the note's last commit time; null when neither is known. */
  since: string | null;
  /** Commits in the repo since then. */
  commitsSince: number;
  /** The repo paths its text names, and whether each still exists. */
  paths: { path: string; exists: boolean }[];
}

export interface AuditRule {
  name: string;
  file: string;
  title: string;
  tier: string;
  paths: string[];
  /** Files a scoped rule's paths match; null for a rule with no paths. */
  matches: number | null;
}

export interface AuditReport {
  head: string | null;
  components: string[];
  notes: AuditNote[];
  uncovered: { files: number; entries: UncoveredEntry[] };
  links: { file: string; line: number | null; message: string }[];
  check: { blocks: number; warnings: number };
  generated: GenerateIssue[];
  issues: AuditIssue[];
  rules: AuditRule[];
}

/** The vault records the work, and a build's folder is its own record: neither needs a note. */
const LEFT_OUT = ['docs', '.build'];
const SAMPLE = 3;
const OPEN = new Set(['open', 'deferred']);
/** A path-like token in an issue's text: a/b, or a name with a file extension. */
const PATH_TOKEN = /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:ts|tsx|js|mjs|cjs|json|md|css|html|py|sql|yml|yaml|toml|ps1|sh))(?=$|[\s`'"),;:])/g;

const lines = (out: string): string[] => out.split('\0').filter(Boolean);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Tracked and untracked (not ignored) files outside the vault and build folders. */
function repoFiles(root: string): string[] {
  const r = gitTry(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { raw: true });
  if (!r.ok) throw new NexusError(`git ls-files failed: ${r.err}`);
  return [...new Set(lines(r.out))].filter((p) => existsSync(join(root, p)) && !LEFT_OUT.some((x) => under(p, x))).sort();
}

function lastCommit(root: string, path: string): string | null {
  const r = gitTry(root, ['log', '-1', '--format=%H', '--', path]);
  return r.ok && r.out ? r.out : null;
}

function count(root: string, args: string[]): number {
  const r = gitTry(root, ['rev-list', '--count', ...args]);
  return r.ok && r.out ? Number(r.out) : 0;
}

function sourceState(root: string, source: string): SourceState {
  if (existsSync(join(root, source))) return 'present';
  const r = gitTry(root, ['log', '-1', '--format=%H', '--all', '--', source]);
  return r.ok && r.out !== '' ? 'gone' : 'not-a-path';
}

/**
 * Uncovered files rolled up: a folder of two or more files none of which is covered becomes one entry; inside a
 * folder that is partly covered, each uncovered file and each wholly uncovered subfolder is its own entry.
 */
function rollUp(files: string[], covered: (p: string) => boolean): UncoveredEntry[] {
  const out: UncoveredEntry[] = [];
  const walk = (prefix: string, members: string[]): void => {
    const direct: string[] = [];
    const groups = new Map<string, string[]>();
    for (const f of members) {
      const rest = prefix ? f.slice(prefix.length + 1) : f;
      const slash = rest.indexOf('/');
      if (slash < 0) direct.push(f);
      else {
        const dir = prefix ? `${prefix}/${rest.slice(0, slash)}` : rest.slice(0, slash);
        groups.set(dir, [...(groups.get(dir) ?? []), f]);
      }
    }
    for (const f of direct) if (!covered(f)) out.push({ path: f, folder: false, files: 1, sample: [] });
    for (const [dir, inside] of groups) {
      const [only] = inside;
      if (inside.length === 1 && only !== undefined) {
        if (!covered(only)) out.push({ path: only, folder: false, files: 1, sample: [] });
      } else if (inside.every((f) => !covered(f))) out.push({ path: dir, folder: true, files: inside.length, sample: inside.slice(0, SAMPLE) });
      else if (inside.some((f) => !covered(f))) walk(dir, inside);
    }
  };
  walk('', files);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function issuePaths(root: string, text: string): { path: string; exists: boolean }[] {
  const seen = new Set<string>();
  const out: { path: string; exists: boolean }[] = [];
  for (const m of text.matchAll(PATH_TOKEN)) {
    const path = cleanSource((m[1] ?? '').replace(/[.]+$/, ''));
    if (!path || seen.has(path) || /^https?:/.test(path)) continue;
    seen.add(path);
    out.push({ path, exists: existsSync(join(root, path)) });
  }
  return out;
}

function sinceCount(root: string, since: string | null): number {
  return since ? count(root, [`--since=${since}`, 'HEAD']) : 0;
}

function logIssues(root: string): AuditIssue[] {
  const file = join(root, 'docs', 'governance', 'issues.json');
  if (!existsSync(file)) return [];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new NexusError('docs/governance/issues.json is not valid JSON');
  }
  const entries = (data as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const out: AuditIssue[] = [];
  for (const e of entries as Record<string, unknown>[]) {
    const name = str(e['name']);
    const status = str(e['status']) ?? '';
    if (!name || !OPEN.has(status)) continue;
    const text = str(e['text']) ?? '';
    const since = str(e['time']);
    out.push({ name, from: 'log', status, text, since, commitsSince: sinceCount(root, since), paths: issuePaths(root, text) });
  }
  return out;
}

/**
 * What the vault claims, laid against the repo as it stands: each thing note's source and how far it moved since
 * the note, the files no note covers, the open issues and the paths they name, the active rules and what their
 * paths match, unresolved links and generated drift. Read-only: git and the vault. The judgement calls (does the
 * note still say what the code does, is the issue fixed, does the code follow the rule) are left to the reviewer
 * that reads this.
 */
export function auditVault(root: string): AuditReport {
  const docs = join(root, 'docs');
  if (!insideGit(root)) throw new NexusError('docs audit needs a git repository');
  if (!isVault(docs)) throw new NexusError('not a nexus vault: docs/_meta/classes/ not found');
  const head = lastCommitOf(root);
  const things = thingNotes(docs);
  const notes: AuditNote[] = things.map(({ note: n, source }) => {
    const noteCommit = lastCommit(root, n.file);
    const state = sourceState(root, source);
    const status = state === 'present' ? gitTry(root, ['status', '--porcelain', '--', source]) : null;
    return {
      note: n.file,
      class: str(n.fm.data?.['class']) ?? '',
      component: str(n.fm.data?.['component']),
      source,
      state,
      noteCommit,
      sourceCommits: noteCommit && state !== 'not-a-path' ? count(root, [`${noteCommit}..HEAD`, '--', source]) : 0,
      uncommitted: status !== null && status.ok && status.out !== '',
    };
  }).sort((a, b) => a.note.localeCompare(b.note));

  const files = repoFiles(root);
  const sources = things.map((t) => t.source);
  const covered = (p: string): boolean => sources.some((s) => under(p, s));
  const uncovered = { files: files.filter((f) => !covered(f)).length, entries: rollUp(files, covered) };

  const report = checkVault(root);
  const links = report.findings.filter((f) => f.rule === 'link-unresolved').map((f) => ({ file: f.file, line: f.line ?? null, message: f.message }));
  const check = { blocks: report.findings.filter((f) => f.level === 'block').length, warnings: report.findings.filter((f) => f.level === 'warn').length };
  let generated: GenerateIssue[] = [];
  try {
    generated = planGenerate(root).issues;
  } catch {
    generated = [];
  }

  const issues: AuditIssue[] = logIssues(root);
  const rules: AuditRule[] = [];
  for (const rel of walkVault(docs).notes) {
    const fm = readFrontmatter(readFileSync(join(docs, rel), 'utf8'));
    const cls = str(fm.data?.['class']);
    const status = str(fm.data?.['status']) ?? '';
    const file = `docs/${rel}`;
    const name = basename(rel, '.md');
    if (cls === 'issue' && OPEN.has(status)) {
      const at = gitTry(root, ['log', '-1', '--format=%cI', '--', file]);
      const since = at.ok && at.out ? at.out : null;
      const text = fm.body.join('\n').trim();
      issues.push({ name, from: 'note', status, text, file, since, commitsSince: sinceCount(root, since), paths: issuePaths(root, text) });
    }
    if (cls === 'rule' && status === 'active') {
      const raw = fm.data?.['paths'];
      const paths = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]).filter((p): p is string => typeof p === 'string');
      const res = paths.map((p) => globToRegExp(cleanSource(p)));
      rules.push({
        name, file,
        title: (fm.body.find((l) => l.startsWith('# ')) ?? '').slice(2).trim(),
        tier: str(fm.data?.['tier']) ?? '',
        paths,
        matches: paths.length ? files.filter((f) => res.some((re) => re.test(f))).length : null,
      });
    }
  }
  issues.sort((a, b) => a.name.localeCompare(b.name));
  rules.sort((a, b) => a.name.localeCompare(b.name));

  const components = [...new Set([...notes.map((n) => n.component).filter((c): c is string => c !== null)])].sort();
  return { head, components, notes, uncovered, links, check, generated, issues, rules };
}

function lastCommitOf(root: string): string | null {
  const r = gitTry(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  return r.ok && r.out ? r.out : null;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The report as text: a header, then what needs a look, section by section. */
export function formatAudit(r: AuditReport): string[] {
  const out = [`nexus docs audit: ${plural(r.notes.length, 'thing note')}, ${plural(r.uncovered.files, 'uncovered file')}, ${plural(r.issues.length, 'open issue')}, ${plural(r.rules.length, 'active rule')}`];
  for (const n of r.notes) {
    if (n.state === 'present' && !n.sourceCommits && !n.uncommitted) continue;
    const why = n.state === 'gone' ? 'source gone' : n.state === 'not-a-path' ? 'source is not a repo path' : [n.sourceCommits ? `${plural(n.sourceCommits, 'commit')} since ${n.noteCommit?.slice(0, 7)}` : '', n.uncommitted ? 'uncommitted changes' : ''].filter(Boolean).join(', ');
    out.push(`  note       ${n.note} (${n.source}): ${why}`);
  }
  for (const e of r.uncovered.entries) out.push(`  uncovered  ${e.path}${e.folder ? `/ (${plural(e.files, 'file')})` : ''}`);
  for (const l of r.links) out.push(`  link       ${l.file}${l.line ? `:${l.line}` : ''}: ${l.message}`);
  for (const g of r.generated) out.push(`  generated  ${g.kind} ${g.file}`);
  for (const i of r.issues) {
    const gone = i.paths.filter((p) => !p.exists).map((p) => p.path);
    const since = i.since ? `${plural(i.commitsSince, 'commit')} since ${i.since.slice(0, 10)}` : 'no date';
    out.push(`  issue      ${i.name} (${i.from}, ${i.status}): ${since}${gone.length ? `; names missing ${gone.join(', ')}` : ''}`);
  }
  const scoped = r.rules.filter((x) => x.matches !== null);
  if (r.rules.length) out.push(`  rules      ${r.rules.length} active: ${r.rules.length - scoped.length} with no paths, ${scoped.length} scoped`);
  for (const x of scoped) if (x.matches === 0) out.push(`  rule       ${x.name}: its paths match no file (${x.paths.join(', ')})`);
  if (r.check.blocks || r.check.warnings) out.push(`  check      ${plural(r.check.blocks, 'block')}, ${plural(r.check.warnings, 'warning')}: run nexus docs check`);
  return out;
}
