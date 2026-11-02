import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryKey } from '../core/governance/env.ts';
import { governanceInventory } from '../core/governance/inventory.ts';
import type { InventoryEnv } from '../core/governance/types.ts';
import { applyReview, listReviews, openReview, readReview, reviewPath, submitReviewAnswers } from '../core/reviews.ts';
import { readReviewIndex } from '../core/review-files.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { withMarker } from '../core/vault/generated.ts';
import { LATER, NOW } from './helpers.ts';
import { put, sandbox } from './governance-helpers.ts';

/** A repo with a CLAUDE.md, a hand-written rule, a generated rule and two memory files (all written at run time). */
function reviewRepo(): { root: string; env: InventoryEnv; id: (location: string) => string; memory: string } {
  const { root, env } = sandbox();
  put(root, {
    'CLAUDE.md': '# Repo\n',
    '.claude/rules/old.md': '# Old rule\n',
    '.claude/rules/nexus/keep.md': withMarker('# Keep\n', 'docs/governance/rules/keep.md'),
  });
  const memoryDir = join(env.configDir, 'projects', memoryKey(root), 'memory');
  put(memoryDir, { 'MEMORY.md': '- [Tidy](tidy.md)\n', 'tidy.md': '---\nname: tidy\n---\nKeep it tidy.\n' });
  const items = governanceInventory(root, env).items;
  const id = (location: string): string => {
    const item = items.find((i) => i.location === location);
    if (!item) throw new Error(`no item at ${location}: ${items.map((i) => i.location).join(', ')}`);
    return item.id;
  };
  return { root, env, id, memory: `~/.claude/projects/${memoryKey(root)}/memory` };
}

function request(r: ReturnType<typeof reviewRepo>, name = 'tidy-memory') {
  return {
    name,
    type: 'review' as const,
    title: 'Tidy the standing instructions',
    why: 'Mark each one.',
    items: [
      { name: 'repo-claude', text: 'The repo CLAUDE.md', item: r.id('CLAUDE.md'), target: 'CLAUDE.md' },
      { name: 'tidy-memory-file', text: 'The tidy memory', item: r.id(`${r.memory}/tidy.md`), target: `${r.memory}/tidy.md` },
      { name: 'old-rule', text: 'The old rule file', item: r.id('.claude/rules/old.md'), target: '.claude/rules/old.md' },
    ],
  };
}

describe('openReview', () => {
  it('writes the request, the index and a .gitignore that keeps the folder off git', () => {
    const r = reviewRepo();
    const opened = openReview(r.root, request(r), NOW, r.env);
    expect(opened.opened).toBe(NOW);
    expect(JSON.parse(readFileSync(reviewPath(r.root, 'tidy-memory'), 'utf8'))).toMatchObject({ name: 'tidy-memory', type: 'review' });
    expect(JSON.parse(readFileSync(join(r.root, '.nexus', 'reviews', 'index.json'), 'utf8'))).toEqual({ 'tidy-memory': { opened: NOW, read: null } });
    expect(readFileSync(join(r.root, '.nexus', 'reviews', '.gitignore'), 'utf8')).toBe('*\n');
  });
  it('refuses other gate types, which open in a build', () => {
    const r = reviewRepo();
    expect(() => openReview(r.root, { ...request(r), type: 'mark-list' }, NOW, r.env)).toThrow(/gate of type "review"/);
  });
  it('refuses a row that names no listed item, or whose target is not that item', () => {
    const r = reviewRepo();
    const base = request(r);
    const unknown = { ...base, items: [{ name: 'ghost', text: 'x', item: '000000000000', target: 'CLAUDE.md' }] };
    expect(() => openReview(r.root, unknown, NOW, r.env)).toThrow(/names no listed item/);
    const moved = { ...base, items: [{ name: 'repo-claude', text: 'x', item: r.id('CLAUDE.md'), target: 'AGENTS.md' }] };
    expect(() => openReview(r.root, moved, NOW, r.env)).toThrow(/target must be the item's location, CLAUDE.md/);
  });
  it('refuses a generated rule file: it changes through its source note', () => {
    const r = reviewRepo();
    const gen = { ...request(r), items: [{ name: 'keep', text: 'x', item: r.id('.claude/rules/nexus/keep.md'), target: '.claude/rules/nexus/keep.md' }] };
    expect(() => openReview(r.root, gen, NOW, r.env)).toThrow(/changes through its source note/);
  });
  it('refuses rows without item and target, and repeated row names', () => {
    const r = reviewRepo();
    expect(() => openReview(r.root, { ...request(r), items: [{ name: 'bare', text: 'x' }] }, NOW, r.env)).toThrow(/invalid/);
    const first = request(r).items[0];
    if (!first) throw new Error('no row');
    expect(() => openReview(r.root, { ...request(r), items: [first, first] }, NOW, r.env)).toThrow(/unique names/);
  });
  it('refuses the reserved name index, and writes nothing', () => {
    const r = reviewRepo();
    expect(() => openReview(r.root, request(r, 'index'), NOW, r.env)).toThrow('"index" is reserved for .nexus/reviews/index.json; choose another name');
    expect(existsSync(join(r.root, '.nexus', 'reviews', 'index.json'))).toBe(false);
  });
  it('refuses the build-only fields a review never carries', () => {
    const r = reviewRepo();
    const extras = [{ step: 'scope' as const }, { document: 'documents/notes.md' }, { options: [{ name: 'one-way', label: 'x', page: 'concepts/one.html' }, { name: 'two-way', label: 'y', page: 'concepts/two.html' }] }];
    for (const extra of extras) {
      expect(() => openReview(r.root, { ...request(r), ...extra }, NOW, r.env), Object.keys(extra)[0]).toThrow(/Review request is invalid: .*must NOT be valid/);
    }
  });
  it('refuses a name that is open or already answered', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    expect(() => openReview(r.root, request(r), NOW, r.env)).toThrow(/already open/);
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'repo-claude': 'accepted', 'tidy-memory-file': 'accepted', 'old-rule': 'accepted' } }, NOW, r.env);
    expect(() => openReview(r.root, request(r), NOW, r.env)).toThrow(/already answered/);
  });
});

describe('submitReviewAnswers', () => {
  const marks = { 'repo-claude': 'accepted', 'tidy-memory-file': 'research', 'old-rule': 'declined' } as const;
  it('stamps the gate, the time, the row texts and the files each row may change', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    const a = submitReviewAnswers(r.root, 'tidy-memory', { marks, notes: { 'tidy-memory-file': 'Say "tidy" once' }, targets: { 'repo-claude': ['/etc/passwd'] } }, LATER, r.env);
    expect(a).toMatchObject({ gate: 'tidy-memory', submitted: LATER, marks });
    expect(a.texts).toEqual({ 'repo-claude': 'The repo CLAUDE.md', 'tidy-memory-file': 'The tidy memory', 'old-rule': 'The old rule file' });
    // Client-supplied targets are dropped; the server's come from a fresh inventory. A memory file brings its index.
    expect(a.targets).toEqual({
      'repo-claude': ['CLAUDE.md'],
      'tidy-memory-file': [`${r.memory}/tidy.md`, `${r.memory}/MEMORY.md`],
      'old-rule': ['.claude/rules/old.md'],
    });
    expect(existsSync(reviewPath(r.root, 'tidy-memory', true))).toBe(true);
  });
  it('gives a row whose item is gone no target, so nothing opens for it', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    writeFileSync(join(r.root, '.claude', 'rules', 'old.md'), ''); // still a file: still listed
    const gone = join(r.env.configDir, 'projects', memoryKey(r.root), 'memory', 'tidy.md');
    rmSync(gone);
    const a = submitReviewAnswers(r.root, 'tidy-memory', { marks }, LATER, r.env);
    expect(a.targets?.['tidy-memory-file']).toBeUndefined();
    expect(a.targets?.['old-rule']).toEqual(['.claude/rules/old.md']);
  });
  it('gives a row no target when its item is a kind a review cannot change', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    // Request files aren't walled: point a row at the generated rule after the review opened.
    const file = reviewPath(r.root, 'tidy-memory');
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as { items: { item: string; target: string }[] };
    const row = tampered.items[2];
    if (!row) throw new Error('no row');
    row.item = r.id('.claude/rules/nexus/keep.md');
    row.target = '.claude/rules/nexus/keep.md';
    writeFileSync(file, JSON.stringify(tampered));
    const a = submitReviewAnswers(r.root, 'tidy-memory', { marks }, LATER, r.env);
    expect(a.targets?.['old-rule']).toBeUndefined();
    expect(a.targets?.['repo-claude']).toEqual(['CLAUDE.md']);
  });
  it('refuses a row pointed at a generated item while keeping its old target, as a changed request', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    const file = reviewPath(r.root, 'tidy-memory');
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as { items: { item: string }[] };
    const row = tampered.items[2];
    if (!row) throw new Error('no row');
    row.item = r.id('.claude/rules/nexus/keep.md');
    writeFileSync(file, JSON.stringify(tampered));
    expect(() => submitReviewAnswers(r.root, 'tidy-memory', { marks }, LATER, r.env)).toThrow(/no longer matches/);
  });
  it('refuses a request changed after it opened', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    const file = reviewPath(r.root, 'tidy-memory');
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as { items: { target: string }[] };
    const row = tampered.items[0];
    if (!row) throw new Error('no row');
    row.target = '.claude/rules/old.md';
    writeFileSync(file, JSON.stringify(tampered));
    expect(() => submitReviewAnswers(r.root, 'tidy-memory', { marks }, LATER, r.env)).toThrow(/no longer matches/);
  });
  it('needs every row marked, refuses notes for rows it lacks, and answers once', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    expect(() => submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'repo-claude': 'accepted' } }, LATER, r.env)).toThrow(/every row must be marked/);
    expect(() => submitReviewAnswers(r.root, 'tidy-memory', { marks, notes: { ghost: 'x' } }, LATER, r.env)).toThrow(/notes for rows that are not in the gate/);
    expect(() => submitReviewAnswers(r.root, 'tidy-memory', { decision: 'approve' }, LATER, r.env)).toThrow(/^a review gate needs marks/);
    submitReviewAnswers(r.root, 'tidy-memory', { marks }, LATER, r.env);
    expect(() => submitReviewAnswers(r.root, 'tidy-memory', { marks }, LATER, r.env)).toThrow(/already been answered/);
  });
});

describe('applyReview and listReviews', () => {
  it('lists waiting, answered and applied reviews, and skips what is not a review', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    openReview(r.root, request(r, 'second-look'), NOW, r.env);
    writeFileSync(join(r.root, '.nexus', 'reviews', 'broken.json'), '{ nope');
    writeFileSync(join(r.root, '.nexus', 'reviews', 'second-look.json.tmp'), '{}');
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'repo-claude': 'accepted', 'tidy-memory-file': 'research', 'old-rule': 'declined' }, notes: { 'tidy-memory-file': 'Shorter' } }, LATER, r.env);
    const problems: string[] = [];
    const states = listReviews(r.root, problems);
    expect(states.map((s) => [s.request.name, s.answers === null ? 'waiting' : 'answered', s.read])).toEqual([
      ['second-look', 'waiting', null],
      ['tidy-memory', 'answered', null],
    ]);
    expect(problems).toEqual([expect.stringMatching(/^broken\.json: /)]);
  });
  it('applies once, returning marks, notes and each row\'s file', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    expect(() => applyReview(r.root, 'tidy-memory', LATER)).toThrow(/hasn't been answered/);
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'repo-claude': 'accepted', 'tidy-memory-file': 'research', 'old-rule': 'declined' }, notes: { 'tidy-memory-file': 'Shorter' } }, LATER, r.env);
    expect(applyReview(r.root, 'tidy-memory', LATER)).toEqual({
      marks: { 'repo-claude': 'accepted', 'tidy-memory-file': 'research', 'old-rule': 'declined' },
      notes: { 'tidy-memory-file': 'Shorter' },
      targets: { 'repo-claude': 'CLAUDE.md', 'tidy-memory-file': `${r.memory}/tidy.md`, 'old-rule': '.claude/rules/old.md' },
    });
    expect(readReview(r.root, 'tidy-memory').read).toBe(LATER);
    expect(() => applyReview(r.root, 'tidy-memory', LATER)).toThrow(/already applied/);
  });
  it('returns no target for a row whose item was gone at submission', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    rmSync(join(r.env.configDir, 'projects', memoryKey(r.root), 'memory', 'tidy.md'));
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'repo-claude': 'accepted', 'tidy-memory-file': 'research', 'old-rule': 'declined' } }, LATER, r.env);
    expect(applyReview(r.root, 'tidy-memory', LATER).targets).toEqual({ 'repo-claude': 'CLAUDE.md', 'old-rule': '.claude/rules/old.md' });
  });
  it('names the reservation when index is submitted, read or applied', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    const reserved = '"index" is reserved for .nexus/reviews/index.json; choose another name';
    expect(() => submitReviewAnswers(r.root, 'index', { marks: {} }, LATER, r.env)).toThrow(reserved);
    expect(() => readReview(r.root, 'index')).toThrow(reserved);
    expect(() => applyReview(r.root, 'index', LATER)).toThrow(reserved);
  });
  it('refuses an index key that is not a review name, such as __proto__', () => {
    const r = reviewRepo();
    openReview(r.root, request(r), NOW, r.env);
    writeFileSync(join(r.root, '.nexus', 'reviews', 'index.json'), '{ "__proto__": { "opened": "x", "read": null } }');
    expect(() => readReviewIndex(r.root)).toThrow(/"__proto__" is not a review name/);
  });
  it('refuses a review when the index cannot be read, and writes nothing', () => {
    const r = reviewRepo();
    put(r.root, { '.nexus/reviews/index.json': '{ nope' });
    expect(() => openReview(r.root, request(r), NOW, r.env)).toThrow(/index\.json is not valid JSON/);
    expect(existsSync(reviewPath(r.root, 'tidy-memory'))).toBe(false);
  });
});

describe('nexus review', () => {
  function io(cwd: string, env: InventoryEnv) {
    const out: string[] = [];
    const err: string[] = [];
    const vars = { CLAUDE_CONFIG_DIR: env.configDir, NEXUS_INVENTORY_MANAGED: env.managedDir, NEXUS_INVENTORY_CEILING: env.ceiling ?? '' };
    const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: vars };
    return { value, out, err };
  }
  it('opens, lists and applies a review with no build', async () => {
    const r = reviewRepo();
    const file = join(r.root, 'review.json');
    writeFileSync(file, JSON.stringify({ ...request(r), items: request(r).items.slice(0, 1) }));
    const opened = io(r.root, r.env);
    expect(await main(['review', 'open', 'review.json'], opened.value)).toBe(0);
    expect(opened.out).toEqual(['Opened review "tidy-memory" (1 row). It is waiting in the cockpit\'s Repo view.']);
    const listed = io(r.root, r.env);
    expect(await main(['review', 'list'], listed.value)).toBe(0);
    expect(listed.out).toEqual(['tidy-memory  waiting  Tidy the standing instructions']);
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'repo-claude': 'declined' } }, NOW, r.env);
    const applied = io(r.root, r.env);
    expect(await main(['review', 'apply', 'tidy-memory'], applied.value)).toBe(0);
    expect(applied.out).toEqual(['Applied review "tidy-memory": 0 kept, 0 to adjust, 1 to remove. Its permits are closed.', '  remove  repo-claude · CLAUDE.md']);
    const after = io(r.root, r.env);
    expect(await main(['review', 'list'], after.value)).toBe(0);
    expect(after.out).toEqual(['tidy-memory  applied  Tidy the standing instructions']);
  });
  it('says a row whose item was gone at submission is no longer listed', async () => {
    const r = reviewRepo();
    openReview(r.root, { ...request(r), items: request(r).items.slice(1, 2) }, NOW, r.env);
    rmSync(join(r.env.configDir, 'projects', memoryKey(r.root), 'memory', 'tidy.md'));
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { 'tidy-memory-file': 'research' }, notes: { 'tidy-memory-file': 'Shorter' } }, NOW, r.env);
    const applied = io(r.root, r.env);
    expect(await main(['review', 'apply', 'tidy-memory'], applied.value)).toBe(0);
    expect(applied.out).toEqual(['Applied review "tidy-memory": 0 kept, 1 to adjust, 0 to remove. Its permits are closed.', '  adjust  tidy-memory-file · (no longer listed or reviewable) · note: Shorter']);
  });
  it('reads a row named constructor from its own keys only, never a prototype value', async () => {
    const r = reviewRepo();
    const row = { name: 'constructor', text: 'The repo CLAUDE.md', item: r.id('CLAUDE.md'), target: 'CLAUDE.md' };
    openReview(r.root, { ...request(r), items: [row] }, NOW, r.env);
    submitReviewAnswers(r.root, 'tidy-memory', { marks: { constructor: 'research' } }, NOW, r.env);
    const applied = io(r.root, r.env);
    expect(await main(['review', 'apply', 'tidy-memory'], applied.value)).toBe(0);
    expect(applied.out).toEqual(['Applied review "tidy-memory": 0 kept, 1 to adjust, 0 to remove. Its permits are closed.', '  adjust  constructor · CLAUDE.md']);
  });
  it('says so when there are no reviews', async () => {
    const r = reviewRepo();
    const listed = io(r.root, r.env);
    expect(await main(['review', 'list'], listed.value)).toBe(0);
    expect(listed.out).toEqual(['No reviews in this repo.']);
  });
});
