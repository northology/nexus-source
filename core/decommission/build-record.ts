import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { NexusError } from '../errors.ts';
import { readLog } from '../logs.ts';
import { buildPath } from '../paths.ts';
import { readSnapshot } from '../snapshot.ts';
import type { LogEntry } from '../types.ts';
import { readFrontmatter, type Frontmatter } from '../vault/frontmatter.ts';
import { isVault, readRegistry } from '../vault/registry.ts';
import { buildRecordPath, isDecommissionGate, reportDraft } from './paths.ts';

const list = (v: unknown): unknown[] | null => (v === undefined || v === null ? null : Array.isArray(v) ? v : [v]);

function draft(root: string, build: string): Frontmatter | null {
  const file = buildPath(root, build, ...reportDraft(build).split('/'));
  return existsSync(file) ? readFrontmatter(readFileSync(file, 'utf8')) : null;
}

/** The build's approvals: what its approve gates (spec, plan, finish, permits) logged. They stay with the build. */
function approvals(root: string, build: string): LogEntry[] {
  const gates = new Set(readSnapshot(root, build, { progress: false }).gates.filter((g) => g.request.type === 'approve').map((g) => g.name));
  return readLog(root, build, 'decisions').entries.filter((e) => gates.has(e.name));
}

/** The decisions the agent chooses among: accepted, not an approval, and not one of the decommission gate's own marks. */
function candidates(root: string, build: string): LogEntry[] {
  const own = (source: string): boolean => source.endsWith(' gate') && isDecommissionGate(source.slice(0, -' gate'.length), build);
  const approved = new Set(approvals(root, build).map((e) => e.name));
  return readLog(root, build, 'decisions').entries.filter((e) => e.status === 'accepted' && !own(e.source) && !approved.has(e.name));
}

/** The decisions of note the draft lists, which go to the repo's decision log. */
export function chosenDecisions(root: string, build: string): LogEntry[] {
  const names = new Set((list(draft(root, build)?.data?.['decisions']) ?? []).map(String));
  return candidates(root, build).filter((e) => names.has(e.name));
}

/** What the draft report still lacks to become the build's record, one sentence each; empty when it has no draft. */
export function recordProblems(root: string, build: string): string[] {
  const fm = draft(root, build);
  if (!fm) return [];
  if (fm.error) return [`the final report's frontmatter can't be read: ${fm.error}`];
  const out: string[] = [];
  const data = fm.data ?? {};
  const known = candidates(root, build).map((e) => e.name);
  const listed = list(data['decisions']);
  if (listed === null) {
    if (known.length) out.push(`list the build's decisions of note in the draft's frontmatter: decisions: [...], from ${known.join(', ')} (an empty list is a choice)`);
  } else {
    const strangers = listed.map(String).filter((n) => !known.includes(n));
    if (strangers.length) out.push(`decisions names ${strangers.join(', ')}, which aren't accepted decisions of the build (approvals stay with it): use ${known.join(', ') || 'none'}`);
  }
  const docs = join(root, 'docs');
  const components = isVault(docs) ? [...readRegistry(docs).registry.components] : [];
  if (components.length) {
    const named = list(data['components'])?.map(String) ?? [];
    if (!named.length) out.push(`name the components the build touched in the draft's frontmatter: components: [${components.join(', ')}]`);
    const unlisted = named.filter((c) => !components.includes(c));
    if (unlisted.length) out.push(`components names ${unlisted.join(', ')}, which isn't listed in docs/_meta/components.md: use ${components.join(', ')}`);
  }
  return out;
}

const day = (time: string | undefined): string => (time ?? '').slice(0, 10);
const linkTo = (repoPath: string): string => `- [[${repoPath.replace(/^docs\//, '').replace(/\.md$/, '')}]]`;

/**
 * Writes the draft final report into the vault as the build's record: its own properties (but decisions), the
 * build-record ones, then a generated line of the build's approvals and a link to every archived file. Returns its path.
 */
export function writeBuildRecord(root: string, build: string, archived: string[]): string {
  const fm = draft(root, build);
  if (!fm || fm.error) throw new NexusError(`the final report can't be read: ${fm?.error ?? 'it is missing'}`);
  const { decisions: _chosen, ...own } = fm.data ?? {};
  const components = list(own['components']);
  const props = { ...own, class: 'build-record', component: 'shared', build, ...(components ? { components } : {}), 'nex-category': 'build-record' };
  const body = fm.body.join('\n').replace(/\s+$/, '');
  const approved = approvals(root, build)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.name.localeCompare(b.name))
    .map((e) => `${e.name} ${e.status === 'accepted' ? 'approved' : 'sent back'} ${day(e.time)}`);
  const parts = [body];
  if (approved.length) parts.push('## Approvals', approved.join(' · '));
  if (archived.length) parts.push('## Archive', archived.map(linkTo).join('\n'));
  const path = buildRecordPath(build);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(props)}---\n${parts.join('\n\n')}\n`);
  return path;
}
