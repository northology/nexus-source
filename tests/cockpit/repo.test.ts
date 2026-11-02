import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '../../core/governance/types.ts';
import type { RepoSnapshot } from '../../core/types.ts';
import {
  filterItems, groupByScope, itemsFor, readerFile, readerStateFor, recordCounts, repoName, repoRailItems, sectionOf, selectItem, settingNote, splitByFolder,
} from '../../cockpit/src/lib/repo.ts';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'aaaaaaaaaaaa', kind: 'instructions', title: 'T', location: 'CLAUDE.md', scope: 'always', record: 'outside', size: 1, changed: '2026-10-08T00:00:00Z', ...over,
});
const ITEMS = [
  item({ id: '1', kind: 'rule', title: 'Stage explicit paths', location: 'docs/governance/rules/s.md', record: 'recorded' }),
  item({ id: '2', kind: 'instructions', title: 'Repo', location: 'CLAUDE.md' }),
  item({ id: '3', kind: 'memory', title: 'Resolve findings', location: '~/.claude/projects/x/memory/r.md', scope: 'on-demand' }),
  item({ id: '4', kind: 'decision', title: 'Registry walled', location: 'docs/governance/decisions/w.md', scope: 'on-demand', record: 'recorded' }),
  item({ id: '5', kind: 'guardrail', title: 'read-only', location: '.build/b/logs/guardrails.json#read-only', scope: 'build', record: 'build' }),
  item({ id: '6', kind: 'generated', title: 'Stage', location: '.claude/rules/nexus/s.md', record: 'generated', source: 'docs/governance/rules/s.md' }),
  item({ id: '7', kind: 'rule-file', title: 'Web', location: '.claude/rules/web.md', scope: 'path-scoped', paths: ['web/**'] }),
];
const REPO: RepoSnapshot = { inventory: { root: '/w/agent-infra', vault: true, items: ITEMS, problems: [], harness: 'claude-code', setting: { value: 'claude-md-or-agents-md', from: null } }, views: [], problems: [] };

describe('repo sections', () => {
  it('falls back to the overview for an unknown section', () => {
    expect([sectionOf(null), sectionOf('memory'), sectionOf('nope')]).toEqual(['overview', 'memory', 'overview']);
  });
  it('files each kind under its section', () => {
    expect(itemsFor('rules', ITEMS).map((i) => i.id)).toEqual(['1', '6']);
    expect(itemsFor('instructions', ITEMS).map((i) => i.id)).toEqual(['2', '7']);
    expect(itemsFor('overview', ITEMS)).toHaveLength(7);
  });
  it('filters by text and record, and groups by scope in load order', () => {
    expect(filterItems(ITEMS, 'stage', ['recorded', 'generated', 'outside', 'build']).map((i) => i.id)).toEqual(['1', '6']);
    expect(filterItems(ITEMS, '', ['outside']).map((i) => i.id)).toEqual(['2', '3', '7']);
    expect(groupByScope(ITEMS).map((g) => [g.title, g.items.length])).toEqual([['Always loaded', 3], ['Path-scoped', 1], ['On demand', 2], ['This build', 1]]);
  });
  it('counts outside, recorded (with generated) and this build', () => {
    expect(recordCounts(ITEMS)).toEqual({ outside: 3, recorded: 3, build: 1 });
  });
});

describe('repoRailItems', () => {
  it('puts the drift count on Overview and a cell per item, red when outside the record', () => {
    const rail = repoRailItems(REPO);
    expect(rail.map((r) => [r.label, r.sub ?? null, r.count, r.needs])).toEqual([
      ['Overview', 'overview', '3 out', true],
      ['Decisions', 'decisions', '1', false],
      ['Rules', 'rules', '2', false],
      ['Issues', 'issues', '0', false],
      ['Instructions', 'instructions', '2', false],
      ['Memory', 'memory', '1', false],
      ['Guardrails', 'guardrails', '1', false],
      ['Views', 'views', '0', false],
      ['Guidance', null, '', false],
    ]);
    expect(rail[4]?.cells).toEqual(['need', 'need']);
  });
  it('names the repo by its folder', () => {
    expect([repoName(REPO), repoName(null)]).toEqual(['agent-infra', 'Repo']);
  });
});

describe('the reader', () => {
  it('opens the item the URL names, says when it is gone, and falls back to the first only when none is named', () => {
    const all = itemsFor('rules', ITEMS);
    const visible = all.filter((i) => i.id === '6');
    expect(selectItem(all, visible, '6')).toEqual({ selected: visible[0], missing: false });
    expect(selectItem(all, visible, undefined)).toEqual({ selected: visible[0], missing: false });
    // Deleted while open: no other item stands in for it under its URL.
    expect(selectItem(all, visible, 'gone00000000')).toEqual({ selected: null, missing: true });
    // Still here, only filtered out by the search or toggles: the first visible item, as before.
    expect(selectItem(all, visible, '1')).toEqual({ selected: visible[0], missing: false });
    expect(selectItem(all, [], undefined)).toEqual({ selected: null, missing: false });
  });
  it('treats a state read for another item as loading, so a new title never shows the old body', () => {
    const ready = { id: 'a', kind: 'ready', text: 'Old body' } as const;
    expect(readerStateFor(ready, 'a')).toBe(ready);
    expect(readerStateFor(ready, 'b')).toEqual({ id: 'b', kind: 'loading' });
  });
  it('shows properties for notes, rule and memory files, and an instruction file as Claude Code loads it', () => {
    expect(readerFile('rule-file', '---\npaths: ["web/**"]\n---\n# Web\n')).toEqual({ properties: [['paths', ['web/**']]], error: null, body: '# Web\n' });
    expect(readerFile('instructions', '---\nname: x\n---\n# Repo\n')).toEqual({ properties: [], error: null, body: '---\nname: x\n---\n# Repo\n' });
    // An empty block is no properties at all.
    expect(readerFile('rule', '---\n---\n# Bare\n')).toEqual({ properties: [], error: null, body: '# Bare\n' });
    // Unreadable: the reason, and the whole file as text so nothing in it is hidden.
    const half = '---\ntier: always\n# Half\n';
    expect(readerFile('rule', half)).toEqual({ properties: [], error: 'the frontmatter has no closing ---', body: half });
  });
});

describe('the reader leaves out a body heading that repeats the title', () => {
  it('drops the first heading when it matches the title, ignoring case and spacing', () => {
    expect(readerFile('rule', '---\ntier: always\n---\n# Stage explicit paths\n\nNever add all.\n', 'stage Explicit paths ').body).toBe('Never add all.\n');
    expect(readerFile('instructions', '\n## Relay\nText\n', 'Relay').body).toBe('Text\n');
  });
  it('keeps a heading that differs, a later heading, and a body with no title given', () => {
    expect(readerFile('rule', '# Other\nText\n', 'Title').body).toBe('# Other\nText\n');
    expect(readerFile('rule', 'Intro\n# Title\nText\n', 'Title').body).toBe('Intro\n# Title\nText\n');
    expect(readerFile('rule', '# Title\nText\n').body).toBe('# Title\nText\n');
  });
  it('keeps the whole text when the properties cannot be read', () => {
    const half = '---\ntier: always\n# Half\n';
    expect(readerFile('rule', half, 'Half').body).toBe(half);
  });
});

describe('the title heading rule, in detail', () => {
  it('looks past leading frontmatter in an instructions file', () => {
    expect(readerFile('instructions', '---\nname: x\n---\n# Relay\nText\n', 'Relay').body).toBe('---\nname: x\n---\nText\n');
  });
  it('leaves nothing when the body is only the heading', () => {
    expect(readerFile('rule', '# Only\n', 'Only').body).toBe('');
  });
  it('reads a closed heading, `# Title #`', () => {
    expect(readerFile('rule', '# Title #\nText\n', 'Title').body).toBe('Text\n');
  });
});

describe('subfolder items and the setting', () => {
  const at = (id: string, folder?: string) =>
    ({ id, kind: 'instructions', title: id, location: folder ? `${folder}/CLAUDE.md` : 'CLAUDE.md', scope: 'on-demand', record: 'outside', size: 1, changed: '2026-10-10T00:00:00Z', ...(folder ? { folder } : {}) }) as InventoryItem;
  it('keeps root items first, then one group per folder, by folder name', () => {
    const out = splitByFolder([at('b1', 'packages/web'), at('r1'), at('a1', 'packages/api'), at('a2', 'packages/api')]);
    expect(out.root.map((i) => i.id)).toEqual(['r1']);
    expect(out.folders.map((f) => [f.folder, f.items.map((i) => i.id)])).toEqual([
      ['packages/api', ['a1', 'a2']],
      ['packages/web', ['b1']],
    ]);
  });
  it('says which project-instructions value was read and where, and what it cannot see', () => {
    expect(settingNote({ value: 'claude-md-and-agents-md', from: '~/.claude/settings.json' })).toBe(
      "Project instructions: claude-md-and-agents-md, from ~/.claude/settings.json. A --settings file given at launch can't be seen here.",
    );
    expect(settingNote({ value: 'claude-md-or-agents-md', from: null })).toBe(
      "Project instructions: Claude Code's default (claude-md-or-agents-md); it isn't set in the managed or user settings. A --settings file given at launch can't be seen here.",
    );
  });
});
