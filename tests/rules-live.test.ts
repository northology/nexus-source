import { describe, it, expect } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruleFiles } from '../core/rules.ts';
import { watchBuilds } from '../server/events.ts';
import { exampleRepo } from './helpers.ts';

function withRules(): { root: string; file: string } {
  const root = exampleRepo();
  mkdirSync(join(root, '.nexus'), { recursive: true });
  writeFileSync(join(root, '.nexus', 'config.json'), JSON.stringify({ staticRules: ['RULES.md'] }));
  const file = join(root, 'RULES.md');
  writeFileSync(file, '# Rules\n');
  return { root, file };
}

describe('static rule files change live', () => {
  it('carry a revision that changes when the file does', () => {
    const { root, file } = withRules();
    const before = ruleFiles(root).rules[0]?.revision;
    expect(before).toMatch(/^\d+(\.\d+)?-\d+$/);
    writeFileSync(file, '# Rules\n\nOne more.\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(ruleFiles(root).rules[0]?.revision).not.toBe(before);
  });
  it('a missing file has no revision', () => {
    const { root } = withRules();
    writeFileSync(join(root, '.nexus', 'config.json'), JSON.stringify({ staticRules: ['GONE.md'] }));
    expect(ruleFiles(root).rules[0]?.revision).toBeNull();
  });
  it('the watcher reports a change to a listed rules file', async () => {
    const { root, file } = withRules();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 100 });
    await new Promise((r) => setTimeout(r, 300));
    seen.length = 0;
    writeFileSync(file, '# Rules\n\nChanged.\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(seen).toContain(null);
  });
});
