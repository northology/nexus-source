import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontmatter } from '../core/vault/frontmatter.ts';
import { readRegistry } from '../core/vault/registry.ts';
import { checkNote } from '../core/vault/rules.ts';
import { note, vaultRepo } from './vault-helpers.ts';

const META = {
  'docs/_meta/components.md': '---\ncomponents: [api]\n---\n',
  'docs/_meta/tags.md': '---\nvocabulary: [retrieval]\n---\n',
};

function check(rel: string, text: string, extra: Record<string, string> = {}) {
  const root = vaultRepo({ ...META, ...extra, [`docs/${rel}`]: text });
  const docs = join(root, 'docs');
  const { registry } = readRegistry(docs);
  const fm = readFrontmatter(readFileSync(join(docs, rel), 'utf8'));
  return checkNote({ file: `docs/${rel}`, rel, fm }, registry, docs);
}
const golden = (fs: ReturnType<typeof check>) => fs.map(({ rule, level, line }) => ({ rule, level, line }));

describe('checkNote: valid notes', () => {
  it.each<[string, string]>([
    ['dev/systems/api/retrieval.md', note({ class: 'system', component: 'api', source: 'services/retrieval', tags: ['retrieval'] })],
    ['governance/decisions/x.md', note({ class: 'decision', component: 'shared', status: 'accepted' })],
    ['governance/archive/decisions/y.md', note({ class: 'decision', component: 'shared', status: 'superseded' })],
    ['governance/rules/z.md', note({ class: 'rule', component: 'shared', status: 'active', tier: 'scoped', paths: ['data/**'] })],
    ['governance/issues/i.md', note({ class: 'issue', component: 'api', status: 'deferred' })],
    ['documentation/technical/runbooks/r.md', note({ class: 'runbook', component: 'shared' })],
    ['documentation/technical/m.md', note({ class: 'manual', component: 'shared', aliases: ['M'] })],
    ['superpowers/archive/landing-card/spec.md', note({ class: 'spec', component: 'shared', build: 'landing-card' })],
    ['governance/builds/landing-card.md', note({ class: 'build-record', component: 'shared', build: 'landing-card', components: ['api'], 'nex-category': 'build-record' })],
  ])('%s has no findings', (rel, text) => {
    expect(check(rel, text)).toEqual([]);
  });
});

describe('checkNote: the golden table', () => {
  it.each<[string, string, string, { rule: string; level: string; line?: number }[]]>([
    ['unreadable frontmatter', 'dev/systems/a.md', '---\nclass: [x\n---\n', [{ rule: 'frontmatter-invalid', level: 'block', line: 1 }]],
    ['no class', 'dev/systems/a.md', '# No frontmatter\n', [{ rule: 'class-missing', level: 'block', line: 1 }]],
    ['an unknown class', 'dev/systems/a.md', note({ class: 'sytem' }), [{ rule: 'class-unknown', level: 'block', line: 2 }]],
    ['the wrong folder', 'dev/integrations/a.md', note({ class: 'system', component: 'api', source: 's' }), [{ rule: 'folder-wrong', level: 'block', line: 2 }]],
    ['a more specific class folder', 'documentation/technical/runbooks/a.md', note({ class: 'manual', component: 'shared' }), [{ rule: 'folder-wrong', level: 'block', line: 2 }]],
    ['an archive status in the live folder', 'governance/decisions/a.md', note({ class: 'decision', component: 'shared', status: 'superseded' }), [{ rule: 'status-invalid', level: 'block', line: 4 }]],
    ['a live status in the archive', 'governance/archive/decisions/a.md', note({ class: 'decision', component: 'shared', status: 'accepted' }), [{ rule: 'status-invalid', level: 'block', line: 4 }]],
    ['a missing status', 'governance/issues/a.md', note({ class: 'issue', component: 'shared' }), [{ rule: 'status-invalid', level: 'block' }]],
    ['a status on a class without statuses', 'dev/context/a.md', note({ class: 'hub', component: 'shared', status: 'current' }), [{ rule: 'status-invalid', level: 'block', line: 4 }]],
    ['a resolved issue', 'governance/issues/a.md', note({ class: 'issue', component: 'shared', status: 'resolved' }), [{ rule: 'status-invalid', level: 'block', line: 4 }]],
    ['a thing with no source', 'data/methods/a.md', note({ class: 'method', component: 'shared' }), [{ rule: 'source-missing', level: 'block', line: 2 }]],
    ['a missing component', 'dev/context/a.md', note({ class: 'hub' }), [{ rule: 'component-missing', level: 'block', line: 2 }]],
    ['an unknown component', 'dev/context/a.md', note({ class: 'hub', component: 'metrics' }), [{ rule: 'component-unknown', level: 'block', line: 3 }]],
    ['a build record naming an unlisted component', 'governance/builds/b.md', note({ class: 'build-record', component: 'shared', build: 'b', components: ['api', 'metrics'] }), [{ rule: 'component-unknown', level: 'block', line: 5 }]],
    ['an unregistered tag', 'dev/context/a.md', note({ class: 'hub', component: 'shared', tags: ['retrieval', 'equity'] }), [{ rule: 'tag-unregistered', level: 'block', line: 4 }]],
    ['a missing required property', 'superpowers/archive/b/spec.md', note({ class: 'spec', component: 'shared' }), [{ rule: 'property-missing', level: 'block', line: 2 }]],
    ['an invalid tier', 'governance/rules/a.md', note({ class: 'rule', component: 'shared', status: 'active', tier: 'sometimes' }), [{ rule: 'tier-invalid', level: 'block', line: 5 }]],
    ['a scoped rule with no paths', 'governance/rules/a.md', note({ class: 'rule', component: 'shared', status: 'active', tier: 'scoped' }), [{ rule: 'scoped-paths-missing', level: 'block', line: 5 }]],
    ['a JS query block', 'dev/context/a.md', note({ class: 'hub', component: 'shared' }, '# A\n```dataviewjs\ndv.list()\n```\n'), [{ rule: 'js-query', level: 'block', line: 6 }]],
    ['an unresolved body link', 'dev/context/a.md', note({ class: 'hub', component: 'shared' }, 'See [[dev/systems/nowhere]].\n'), [{ rule: 'link-unresolved', level: 'warn', line: 5 }]],
    ['a short body link', 'dev/context/a.md', note({ class: 'hub', component: 'shared' }, 'See [[retrieval]].\n'), [{ rule: 'link-short', level: 'warn', line: 5 }]],
    ['an unquoted typed link', 'dev/context/a.md', note({ class: 'hub', component: 'shared' }, '# A\n').replace('component: shared', 'component: shared\nuses: [[dev/systems/a]]'), [{ rule: 'link-malformed', level: 'warn', line: 4 }]],
    ['an unresolved typed link', 'dev/context/a.md', note({ class: 'hub', component: 'shared', relates: '"[[dev/systems/nowhere]]"' }), [{ rule: 'link-unresolved', level: 'warn', line: 4 }]],
    ['an unknown property', 'dev/context/a.md', note({ class: 'hub', component: 'shared', owner: 'sam' }), [{ rule: 'property-unknown', level: 'warn', line: 4 }]],
    ['a Dataview inline field', 'dev/context/a.md', note({ class: 'hub', component: 'shared' }, 'owner:: sam\n'), [{ rule: 'inline-field', level: 'warn', line: 5 }]],
  ])('%s', (_label, rel, text, expected) => {
    expect(golden(check(rel, text))).toEqual(expected.map((e) => ({ line: undefined, ...e })));
  });
});

describe('checkNote: messages say how to fix the note', () => {
  it('names the right folder and the archive', () => {
    expect(check('dev/integrations/a.md', note({ class: 'system', component: 'api', source: 's' }))[0]?.message).toMatch(/docs\/dev\/systems\//);
    expect(check('governance/decisions/a.md', note({ class: 'decision', component: 'shared', status: 'retired' }))[0]?.message).toMatch(/governance\/archive\/decisions/);
  });
  it('says paths must be a list when it is a single string', () => {
    const fs = check('governance/rules/a.md', note({ class: 'rule', component: 'shared', status: 'active', tier: 'scoped', paths: 'data/**' }));
    expect(fs.map((f) => f.rule)).toEqual(['scoped-paths-missing']);
    expect(fs[0]?.message).toMatch(/a list of the paths/);
  });
  it('lists the components to choose from', () => {
    expect(check('dev/context/a.md', note({ class: 'hub' }))[0]?.message).toMatch(/api, shared/);
  });
});
