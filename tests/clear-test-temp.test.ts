import { describe, it, expect } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testTempFolders } from '../scripts/clear-test-temp.ts';
import { tempDir } from './helpers.ts';

describe('clearing leftover test temp folders', () => {
  it('leaves folders changed since the cut-off, which a running test may still use', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'nexus-old123'));
    mkdirSync(join(dir, 'nexus-new123'));
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(join(dir, 'nexus-old123'), old, old);
    expect(testTempFolders(dir, Date.now() - 3600_000).get('nexus-')).toEqual([join(dir, 'nexus-old123')]);
    expect(testTempFolders(dir).get('nexus-')?.length).toBe(2);
  });
  it('groups only nexus test folders by prefix', () => {
    const dir = tempDir();
    for (const name of ['nexus-abc123', 'nexus-e2e-repo-Xy12Z9', 'nexus-gitcfg-q1w2e3', 'nexusfoo', 'nexus-']) mkdirSync(join(dir, name));
    writeFileSync(join(dir, 'nexus-zzzzzz.txt'), '');
    const groups = testTempFolders(dir);
    expect([...groups.keys()].sort()).toEqual(['nexus-', 'nexus-e2e-repo-', 'nexus-gitcfg-']);
    expect(groups.get('nexus-')).toEqual([join(dir, 'nexus-abc123')]);
    expect(groups.get('nexus-e2e-repo-')).toEqual([join(dir, 'nexus-e2e-repo-Xy12Z9')]);
    expect(groups.get('nexus-gitcfg-')).toEqual([join(dir, 'nexus-gitcfg-q1w2e3')]);
  });
});
