import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS, readJsonFile } from './helpers.ts';

// The nexus marketplace publishes the committed release in plugins/nexus/ (see README "Releasing").
describe('the nexus marketplace and its release', () => {
  const source = () => readJsonFile(join(ARTIFACTS, '.claude-plugin', 'plugin.json')) as { name: string; version: string };
  it('lists nexus from plugins/nexus, and nothing outside the nexus umbrella', () => {
    const market = readJsonFile(join(ARTIFACTS, '.claude-plugin', 'marketplace.json')) as { name: string; plugins: { name: string; source: string }[] };
    expect(market.name).toBe('nexus');
    expect(market.plugins.map((p) => [p.name, p.source])).toEqual([['nexus', './plugins/nexus']]);
  });
  it('holds a release whose manifest matches the source, so a version bump and its release land together', () => {
    const released = join(ARTIFACTS, 'plugins', 'nexus');
    expect(readJsonFile(join(released, '.claude-plugin', 'plugin.json'))).toEqual(source());
    for (const p of ['bin/nexus.mjs', 'bin/guard.mjs', 'bin/guard-core.mjs', 'hooks/hooks.json', 'cockpit/index.html', 'README.md', 'CHANGELOG.md']) {
      expect(existsSync(join(released, p)), p).toBe(true);
    }
  });
  it('holds the Codex and Antigravity releases at the same version, each listed where its harness looks', () => {
    const { version } = source();
    const codex = join(ARTIFACTS, 'plugins', 'nexus-codex');
    const agy = join(ARTIFACTS, 'plugins', 'nexus-antigravity');
    expect(readJsonFile(join(codex, '.codex-plugin', 'plugin.json'))).toMatchObject({ name: 'nexus', version });
    expect(readJsonFile(join(agy, '.antigravity-plugin', 'plugin.json'))).toMatchObject({ name: 'nexus', version });
    for (const p of ['bin/nexus.mjs', 'bin/guard.mjs', 'hooks/hooks.json', 'cockpit/index.html']) expect(existsSync(join(codex, p)), `codex ${p}`).toBe(true);
    for (const p of ['bin/nexus.mjs', 'bin/guard.mjs', 'hooks.json', 'cockpit/index.html']) expect(existsSync(join(agy, p)), `antigravity ${p}`).toBe(true);
    const agents = readJsonFile(join(ARTIFACTS, '.agents', 'plugins', 'marketplace.json')) as { plugins: { name: string; source: { path: string } }[] };
    expect(agents.plugins.map((p) => [p.name, p.source.path])).toEqual([['nexus', './plugins/nexus-codex']]);
  });
  it('is a 1.x release with its changelog entry', () => {
    const { version } = source();
    expect(version).toMatch(/^1\.\d+\.\d+$/);
    expect(readFileSync(join(ARTIFACTS, 'CHANGELOG.md'), 'utf8')).toContain(`\n## ${version} `);
  });
});
