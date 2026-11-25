import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NexusError } from '../errors.ts';
import { fileAddedCommit, gitTry, insideGit, revParse } from '../git.ts';
import { walkVault } from './check.ts';
import { readFrontmatter } from './frontmatter.ts';
import { isVault, META, readRegistry } from './registry.ts';
import { noteClass, type Note } from './rules.ts';

/** A changed path and how it changed: A (added or untracked), M (modified), D (deleted), or git's other letters. */
export interface ChangedPath { status: string; path: string }

export interface TouchedNote { note: string; component: string | null; source: string; paths: ChangedPath[] }

export interface TouchedReport {
  /** The commit the changes are counted from. */
  base: string;
  /** Where the base came from: --since, the change stream's last commit, or the commit that set the vault up. */
  from: 'since' | 'change-stream' | 'vault-setup';
  notes: TouchedNote[];
  uncovered: ChangedPath[];
}

const CHANGE_STREAM = 'docs/governance/change';
/** The vault records the work, and a build's folder is its own record: neither is work to record. */
const LEFT_OUT = ['docs', '.build'];

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);
const cleanSource = (s: string): string => s.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

function baseCommit(root: string, since: string | undefined): Pick<TouchedReport, 'base' | 'from'> {
  if (since !== undefined) {
    const base = revParse(root, since);
    if (!base) throw new NexusError(`"${since}" names no commit in this repository`);
    return { base, from: 'since' };
  }
  const last = gitTry(root, ['log', '-1', '--format=%H', '--', CHANGE_STREAM]);
  if (last.ok && last.out) return { base: last.out, from: 'change-stream' };
  const setup = fileAddedCommit(root, `docs/${META}/contract.md`) ?? fileAddedCommit(root, `docs/${META}`);
  if (setup) return { base: setup, from: 'vault-setup' };
  throw new NexusError('The vault has no commits yet: commit it, or pass --since <ref>');
}

/** Committed and uncommitted changes since base, untracked files included, outside the vault and the build folder. */
function changedPaths(root: string, base: string): ChangedPath[] {
  const byPath = new Map<string, string>();
  const diff = gitTry(root, ['diff', '--name-status', '--no-renames', '-z', base, '--'], { raw: true });
  if (!diff.ok) throw new NexusError(`git diff failed: ${diff.err}`);
  const parts = diff.out.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = (parts[i] ?? '').trim().slice(0, 1);
    const path = parts[i + 1] ?? '';
    if (status && path) byPath.set(path, status);
  }
  const untracked = gitTry(root, ['ls-files', '--others', '--exclude-standard', '-z'], { raw: true });
  if (untracked.ok) for (const path of untracked.out.split('\0')) if (path) byPath.set(path, 'A');
  return [...byPath]
    .filter(([path]) => !LEFT_OUT.some((p) => under(path, p)))
    .map(([path, status]) => ({ status, path }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The thing notes whose source covers a path changed since base, and the changed paths no note covers. Read-only:
 * git and the vault's notes. A source covers itself and everything under it.
 */
export function touchedNotes(root: string, opts: { since?: string } = {}): TouchedReport {
  const docs = join(root, 'docs');
  if (!isVault(docs)) throw new NexusError('not a nexus vault: docs/_meta/classes/ not found');
  if (!insideGit(root)) throw new NexusError('docs touched needs a git repository');
  const { base, from } = baseCommit(root, opts.since);
  const changed = changedPaths(root, base);
  const { registry } = readRegistry(docs);
  const things: { note: Note; source: string }[] = [];
  for (const rel of walkVault(docs).notes) {
    const n: Note = { rel, file: `docs/${rel}`, fm: readFrontmatter(readFileSync(join(docs, rel), 'utf8')) };
    const source = n.fm.data?.['source'];
    if (noteClass(n, registry)?.thing && typeof source === 'string' && cleanSource(source) !== '') things.push({ note: n, source: cleanSource(source) });
  }
  const covered = new Set<string>();
  const notes: TouchedNote[] = [];
  for (const { note: n, source } of things) {
    const paths = changed.filter((c) => under(c.path, source));
    if (!paths.length) continue;
    for (const p of paths) covered.add(p.path);
    const component = n.fm.data?.['component'];
    notes.push({ note: n.file, component: typeof component === 'string' ? component : null, source, paths });
  }
  notes.sort((a, b) => a.note.localeCompare(b.note));
  return { base, from, notes, uncovered: changed.filter((c) => !covered.has(c.path)) };
}

/** The report as text: a header, each note with its paths, then the paths no note covers. */
export function formatTouched(r: TouchedReport): string[] {
  const count = new Set([...r.notes.flatMap((n) => n.paths.map((p) => p.path)), ...r.uncovered.map((p) => p.path)]).size;
  const how = r.from === 'since' ? '--since' : r.from === 'change-stream' ? 'the change stream\'s last commit' : 'the commit that set the vault up';
  const lines = [`nexus docs touched: since ${r.base.slice(0, 7)} (${how}), ${count} changed path${count === 1 ? '' : 's'}`];
  for (const n of r.notes) {
    lines.push(`  note       ${n.note} (${n.component ?? 'no component'}, ${n.source})`);
    for (const p of n.paths) lines.push(`    ${p.status} ${p.path}`);
  }
  for (const p of r.uncovered) lines.push(`  uncovered  ${p.status} ${p.path}`);
  return lines;
}
