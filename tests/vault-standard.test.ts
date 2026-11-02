import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRegistry } from '../core/vault/registry.ts';
import { STANDARD, vaultRepo } from './vault-helpers.ts';

const EXPECTED: [string, string, string, boolean][] = [
  ['system', 'dev/systems', 'authored', true],
  ['integration', 'dev/integrations', 'authored', true],
  ['script', 'dev/ad-hoc', 'authored', true],
  ['agent-runbook', 'dev/runbooks', 'authored', false],
  ['hub', 'dev/context', 'generated', false],
  ['dataset', 'data/datasets', 'authored', true],
  ['pipeline', 'data/pipelines', 'authored', true],
  ['contract', 'data/contracts', 'authored', true],
  ['dictionary', 'data/dictionary', 'generated', true],
  ['method', 'data/methods', 'authored', true],
  ['decision', 'governance/decisions', 'log', false],
  ['rule', 'governance/rules', 'log', false],
  ['issue', 'governance/issues', 'log', false],
  ['change', 'governance/change', 'log', false],
  ['build-record', 'governance/builds', 'log', false],
  ['guide', 'documentation/general', 'authored', false],
  ['manual', 'documentation/technical', 'authored', false],
  ['runbook', 'documentation/technical/runbooks', 'authored', false],
  ['explainer', 'documentation/business', 'authored', false],
  ['design-note', 'design', 'authored', false],
  ['brief', 'superpowers/archive', 'authored', false],
  ['spec', 'superpowers/archive', 'authored', false],
  ['plan', 'superpowers/archive', 'authored', false],
  ['report', 'superpowers/archive', 'authored', false],
];

describe('the shipped standard', () => {
  const { registry, findings } = readRegistry(join(vaultRepo(), 'docs'));
  it('reads with no findings, at contract 3, with empty vocabularies', () => {
    expect(findings).toEqual([]);
    expect(registry.contract).toBe(3);
    expect(registry.tags.size + registry.components.size).toBe(0);
  });
  it('has the 24 baseline classes, in the folders the spec names', () => {
    expect([...registry.classes.values()].map((c) => [c.name, c.folder, c.produced, c.thing]).sort()).toEqual([...EXPECTED].sort());
  });
  it('gives only governance its statuses, as the spec sets them', () => {
    const s = (n: string) => ({ statuses: registry.classes.get(n)?.statuses, archive: registry.classes.get(n)?.archive });
    expect(s('decision')).toEqual({ statuses: ['accepted'], archive: ['superseded', 'retired'] });
    expect(s('rule')).toEqual({ statuses: ['active'], archive: ['retired'] });
    expect(s('issue')).toEqual({ statuses: ['open', 'deferred'], archive: [] });
    expect(s('change')).toEqual({ statuses: [], archive: [] });
    const others = [...registry.classes.values()].filter((c) => !['decision', 'rule', 'issue'].includes(c.name));
    expect(others.every((c) => c.statuses.length === 0 && c.archive.length === 0)).toBe(true);
    expect(registry.classes.get('rule')).toMatchObject({ required: ['tier'], optional: ['paths'] });
    for (const n of ['brief', 'spec', 'plan', 'report']) expect(registry.classes.get(n)?.required).toEqual(['build']);
  });
  it('gives every class a fenced markdown template that names its class', () => {
    for (const f of readdirSync(join(STANDARD, 'classes'))) {
      const text = readFileSync(join(STANDARD, 'classes', f), 'utf8');
      const name = f.replace(/\.md$/, '');
      expect(text, f).toMatch(new RegExp('```markdown\r?\n---\r?\nclass: ' + name + '\r?\n'));
    }
  });
  it('names no file CLAUDE.md or AGENTS.md', () => {
    const all = readdirSync(STANDARD, { recursive: true }).map(String);
    expect(all.filter((p) => /(^|[\/])(CLAUDE|AGENTS)\.md$/i.test(p))).toEqual([]);
  });
});
