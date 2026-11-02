import { SCOPE_ORDER, SCOPE_TITLES, type InventoryItem, type ItemKind, type LoadScope, type RecordStatus } from '../../../core/governance/types.ts';
import { readFrontmatter } from '../../../core/vault/frontmatter.ts';
import type { RepoSnapshot } from '../../../core/types.ts';
import { GUIDANCE_ITEM, MAX_CELLS, type Cell, type RailItem } from './rail.ts';

export const REPO_SECTIONS = ['overview', 'decisions', 'rules', 'issues', 'instructions', 'memory', 'guardrails', 'views'] as const;
export type RepoSection = (typeof REPO_SECTIONS)[number];
export const SECTION_TITLES: Record<RepoSection, string> = {
  overview: 'Overview', decisions: 'Decisions', rules: 'Rules', issues: 'Issues',
  instructions: 'Instructions', memory: 'Memory', guardrails: 'Guardrails', views: 'Views',
};
export const SECTION_KINDS: Record<Exclude<RepoSection, 'overview' | 'views'>, ItemKind[]> = {
  decisions: ['decision'], rules: ['rule', 'generated'], issues: ['issue'],
  instructions: ['instructions', 'rule-file'], memory: ['memory'], guardrails: ['guardrail'],
};
export const ALL_RECORDS: RecordStatus[] = ['recorded', 'generated', 'outside', 'build'];

export function sectionOf(sub: string | null): RepoSection {
  return sub !== null && (REPO_SECTIONS as readonly string[]).includes(sub) ? (sub as RepoSection) : 'overview';
}

export function itemsFor(section: RepoSection, items: InventoryItem[]): InventoryItem[] {
  if (section === 'overview' || section === 'views') return items;
  const kinds = SECTION_KINDS[section];
  return items.filter((i) => kinds.includes(i.kind));
}

export function filterItems(items: InventoryItem[], q: string, show: RecordStatus[]): InventoryItem[] {
  const needle = q.trim().toLowerCase();
  return items.filter((i) => show.includes(i.record) && (needle === '' || [i.title, i.location, i.source ?? ''].some((v) => v.toLowerCase().includes(needle))));
}

export function groupByScope(items: InventoryItem[]): { scope: LoadScope; title: string; items: InventoryItem[] }[] {
  return SCOPE_ORDER.map((scope) => ({ scope, title: SCOPE_TITLES[scope], items: items.filter((i) => i.scope === scope) })).filter((g) => g.items.length > 0);
}

export function recordCounts(items: InventoryItem[]): { outside: number; recorded: number; build: number } {
  return {
    outside: items.filter((i) => i.record === 'outside').length,
    recorded: items.filter((i) => i.record === 'recorded' || i.record === 'generated').length,
    build: items.filter((i) => i.record === 'build').length,
  };
}

export function repoRailItems(repo: RepoSnapshot | null): RailItem[] {
  const items = repo?.inventory.items ?? [];
  const outside = recordCounts(items).outside;
  const kindItem = (section: Exclude<RepoSection, 'overview' | 'views'>): RailItem => {
    const list = itemsFor(section, items);
    return { category: 'repo', sub: section, label: SECTION_TITLES[section], count: String(list.length), needs: false, cells: list.slice(0, MAX_CELLS).map((i): Cell => (i.record === 'outside' ? 'need' : 'on')) };
  };
  return [
    { category: 'repo', sub: 'overview', label: 'Overview', count: `${outside} out`, needs: outside > 0, cells: [] },
    kindItem('decisions'), kindItem('rules'), kindItem('issues'), kindItem('instructions'), kindItem('memory'), kindItem('guardrails'),
    { category: 'repo', sub: 'views', label: 'Views', count: String(repo?.views.length ?? 0), needs: false, cells: (repo?.views ?? []).slice(0, MAX_CELLS).map((): Cell => 'on') },
    GUIDANCE_ITEM,
  ];
}

export function repoName(repo: RepoSnapshot | null): string {
  if (!repo) return 'Repo';
  return repo.inventory.root.split(/[\\/]/).filter(Boolean).pop() ?? 'Repo';
}

/**
 * The item the reader opens: the one the URL names, else the first visible one. A named item that has left the
 * section (deleted while open) is missing, so no other item stands in for it under its URL; one that is only filtered
 * out by the search or toggles gives way to the first visible item.
 */
export function selectItem(all: InventoryItem[], visible: InventoryItem[], wanted: string | undefined): { selected: InventoryItem | null; missing: boolean } {
  if (wanted !== undefined && !all.some((i) => i.id === wanted)) return { selected: null, missing: true };
  return { selected: visible.find((i) => i.id === wanted) ?? visible[0] ?? null, missing: false };
}

export type ReaderState = { id: string; kind: 'loading' } | { id: string; kind: 'gone'; message: string } | { id: string; kind: 'ready'; text: string };

/** A state read for another item belongs to that item: for this one the reader is still loading. */
export function readerStateFor(state: ReaderState, id: string): ReaderState {
  return state.id === id ? state : { id, kind: 'loading' };
}

/**
 * The body without its heading when that heading repeats the item's title (case and spacing aside). Unlike core's
 * titleOf, which takes the first h1 anywhere in a note, this looks only at the first non-blank line, after any leading
 * frontmatter block (kept in place): a heading further down is the note's own, not a repeat of the title above it.
 */
function withoutTitleHeading(body: string, title: string | undefined): string {
  if (title === undefined) return body;
  const lines = body.split('\n');
  let start = lines.findIndex((l) => l.trim() !== '');
  if (start >= 0 && (lines[start] ?? '').trim() === '---') {
    const close = lines.findIndex((l, n) => n > start && l.trim() === '---');
    if (close > start) start = lines.findIndex((l, n) => n > close && l.trim() !== '');
  }
  const heading = start < 0 ? null : /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(lines[start] ?? '');
  if (!heading || (heading[1] ?? '').trim().toLowerCase() !== title.trim().toLowerCase()) return body;
  let next = start + 1;
  while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
  const before = lines.slice(0, start).every((l) => l.trim() === '') ? [] : lines.slice(0, start);
  return [...before, ...lines.slice(next)].join('\n');
}

/**
 * What the reader shows of a file. An instruction file is text, as Claude Code loads it; notes, rule and memory files
 * open with frontmatter, shown as properties. Frontmatter that can't be read says why, and leaves the whole file as
 * text so nothing in it is hidden. A first heading that repeats the item's title (the reader shows the title above)
 * is left out of the body.
 */
export function readerFile(kind: ItemKind, text: string, title?: string): { properties: [string, unknown][]; error: string | null; body: string } {
  if (kind === 'instructions') return { properties: [], error: null, body: withoutTitleHeading(text, title) };
  const fm = readFrontmatter(text);
  if (fm.error !== null) return { properties: [], error: fm.error, body: text };
  return { properties: Object.entries(fm.data ?? {}), error: null, body: withoutTitleHeading(fm.body.join('\n'), title) };
}

/** Items at the repo root, then each subfolder's items under its folder, folders by name. Order inside is kept. */
export function splitByFolder(items: InventoryItem[]): { root: InventoryItem[]; folders: { folder: string; items: InventoryItem[] }[] } {
  const groups = new Map<string, InventoryItem[]>();
  const root: InventoryItem[] = [];
  for (const i of items) {
    if (i.folder === undefined) root.push(i);
    else groups.set(i.folder, [...(groups.get(i.folder) ?? []), i]);
  }
  const folders = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([folder, list]) => ({ folder, items: list }));
  return { root, folders };
}

const UNSEEN = "A --settings file given at launch can't be seen here.";

/** The overview's line on Claude Code's project-instructions setting: the value read, where, and the one blind spot. */
export function settingNote(setting: { value: string; from: string | null }): string {
  if (setting.from === null) return `Project instructions: Claude Code's default (${setting.value}); it isn't set in the managed or user settings. ${UNSEEN}`;
  return `Project instructions: ${setting.value}, from ${setting.from}. ${UNSEEN}`;
}
