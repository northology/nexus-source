import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTopics, openedPages } from '../core/concept-pages.ts';
import { openGate } from '../core/gates.ts';
import { exampleRepo, NOW } from './helpers.ts';

const B = 'relay-rebuild';
const TITLE = 'Pick a direction for the status page';

describe('openedPages', () => {
  it('lists the pages of every opened gate, with the round title and gate', () => {
    const pages = openedPages(exampleRepo(), B);
    expect(pages).toContainEqual({ page: 'concepts/quiet-board.html', title: TITLE, gate: 'look' });
    expect(pages.map((p) => p.page)).toContain('concepts/dense-table.html');
  });
  it('ignores answers files and skips a gates file that is not JSON', () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', B, 'gates', 'broken.json'), '{ nope');
    writeFileSync(join(root, '.build', B, 'gates', 'x.answers.json'), JSON.stringify({ options: [{ page: 'concepts/answers-only.html' }] }));
    const pages = openedPages(root, B);
    expect(pages.map((p) => p.page)).not.toContain('concepts/answers-only.html');
    expect(pages.map((p) => p.page)).toContain('concepts/quiet-board.html');
  });
});

describe('buildTopics', () => {
  it('names the example build topic by its gate, and adds a gate topic, sorted and unique', () => {
    const root = exampleRepo();
    expect(buildTopics(root, B)).toEqual(['look']);
    const pick = (name: string) => ({
      name, type: 'concept-pick' as const, title: 'T', why: 'w', topic: 'status-look',
      options: [{ name: 'calm', label: 'A', page: `concepts/status-look/${name}-a.html` }, { name: 'bold', label: 'B', page: `concepts/status-look/${name}-b.html` }],
    });
    mkdirSync(join(root, '.build', B, 'concepts', 'status-look'), { recursive: true });
    for (const f of ['round-1-a', 'round-1-b', 'round-2-a', 'round-2-b']) writeFileSync(join(root, '.build', B, 'concepts', 'status-look', f + '.html'), '<p>x</p>');
    openGate(root, B, pick('round-1'), NOW);
    openGate(root, B, pick('round-2'), NOW);
    expect(buildTopics(root, B)).toEqual(['look', 'status-look']);
  });
});
