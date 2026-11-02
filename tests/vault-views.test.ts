import { describe, it, expect } from 'vitest';
import { checkVault } from '../core/vault/check.ts';
import { readRegistry } from '../core/vault/registry.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vaultRepo } from './vault-helpers.ts';

const view = (props: Record<string, unknown>, body = 'Requests per region, from the nightly export.\n') =>
  `---\n${Object.entries({ name: 'traffic-load', title: 'Traffic load', type: 'table', data: 'data/out/traffic-load.csv', ...props })
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}`;
const V = 'docs/_meta/views/traffic-load.md';
const rules = (root: string) => checkVault(root).findings.map((f) => [f.rule, f.level, f.file, f.message]);

describe('declared views', () => {
  it('reads a valid view into the registry with its description, and checks clean', () => {
    const root = vaultRepo({ [V]: view({}), 'data/out/traffic-load.csv': 'region,requests\nA,1\n' });
    const { registry } = readRegistry(join(root, 'docs'));
    expect(registry.views.get('traffic-load')).toEqual({
      name: 'traffic-load', title: 'Traffic load', type: 'table', data: 'data/out/traffic-load.csv',
      description: 'Requests per region, from the nightly export.', file: V,
    });
    expect(rules(root)).toEqual([]);
  });
  it('blocks an unknown type, a bad schema and a chart without its columns', () => {
    expect(rules(vaultRepo({ [V]: view({ type: 'map' }) }))[0]?.slice(0, 2)).toEqual(['view-invalid', 'block']);
    expect(rules(vaultRepo({ [V]: view({ colour: 'red' }) }))[0]?.[3]).toMatch(/\("colour"\)/);
    expect(rules(vaultRepo({ [V]: view({ type: 'chart' }), 'data/out/traffic-load.csv': 'a\n1\n' }))).toEqual([
      ['view-invalid', 'block', V, 'a chart view names its columns: chart: { kind: bar, x: <column>, y: <column or list> }'],
    ]);
  });
  it('lists four view types in the schema: table, markdown, chart, gallery', () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'schemas', 'view.schema.json'), 'utf8')) as { properties: { type: { enum: string[] } } };
    expect(schema.properties.type.enum).toEqual(['table', 'markdown', 'chart', 'gallery']);
  });
  it("says why a canvas view isn't one: JSON Canvas boards live in the vault", () => {
    expect(rules(vaultRepo({ [V]: view({ type: 'canvas' }) }))).toEqual([
      ['view-invalid', 'block', V, "canvas isn't a view type: JSON Canvas boards live in the vault, where Obsidian shows them"],
    ]);
  });
  const DOCS = "data sits inside docs/: a view's data lives outside the vault";
  const GIT = "data can't be inside .git/";
  it('blocks table or chart options on a view of another type', () => {
    const csv = { 'data/out/traffic-load.csv': 'a\n1\n' };
    expect(rules(vaultRepo({ [V]: view({ type: 'markdown', table: { columns: ['a'] } }), ...csv }))).toEqual([
      ['view-invalid', 'block', V, 'table options apply only to a table view'],
    ]);
    expect(rules(vaultRepo({ [V]: view({ chart: { kind: 'bar', x: 'a', y: 'b' } }), ...csv }))).toEqual([
      ['view-invalid', 'block', V, 'chart options apply only to a chart view'],
    ]);
  });
  it('blocks data that is absolute, leaves the repo, or sits in docs/ or .git/', () => {
    for (const [data, why] of [
      ['/etc/passwd', 'data is a path from the repo root, not an absolute path'],
      ['C:/data/x.csv', 'data is a path from the repo root, not an absolute path'],
      ['data/../../x.csv', "data can't leave the repo: no .. segments"],
      ['docs/data/x.csv', DOCS],
      ['.git/config', "data can't be inside .git/"],
      ['Docs/x.csv', DOCS], ['./docs/x.csv', DOCS], ['docs//x.csv', DOCS], ['docs\\data\\x.csv', DOCS],
      ['.GIT/config', GIT], ['.git./config', GIT],
      ['data\\..\\..\\x.csv', "data can't leave the repo: no .. segments"],
    ] as const) {
      expect(rules(vaultRepo({ [V]: view({ data }) }))).toEqual([['view-invalid', 'block', V, why]]);
    }
  });
  it('turns a view note that cannot be read into a finding, keeping the other views', () => {
    const root = vaultRepo({ [V]: view({}), 'docs/_meta/views/other.md': view({ name: 'other' }), 'data/out/traffic-load.csv': 'a\n1\n' });
    const failing = ((file: string, ...rest: unknown[]) => {
      if (String(file).endsWith('traffic-load.md')) throw Object.assign(new Error('injected'), { code: 'EBUSY' });
      return (readFileSync as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof readFileSync;
    const { registry, findings } = readRegistry(join(root, 'docs'), failing);
    expect([...registry.views.keys()]).toEqual(['other']);
    expect(findings.map((f) => [f.rule, f.level, f.file, f.message])).toContainEqual(['view-invalid', 'block', V, "can't be read: EBUSY"]);
  });
  it('blocks a component that is not registered', () => {
    expect(rules(vaultRepo({ [V]: view({ component: 'nowhere' }), 'data/out/traffic-load.csv': 'a\n1\n' }))).toEqual([
      ['view-invalid', 'block', V, 'component "nowhere" isn\'t registered in docs/_meta/components.md'],
    ]);
  });
  it('blocks a view note not named <name>.md, and a second view with the same name', () => {
    const root = vaultRepo({ 'docs/_meta/views/load.md': view({}), 'data/out/traffic-load.csv': 'a\n1\n' });
    expect(rules(root)).toEqual([['view-file-name', 'block', 'docs/_meta/views/load.md', 'the view is named "traffic-load", so its note is traffic-load.md; rename the file']]);
    const twice = vaultRepo({ [V]: view({}), 'docs/_meta/views/zz.md': view({}), 'data/out/traffic-load.csv': 'a\n1\n' });
    expect(rules(twice)).toContainEqual(['view-invalid', 'block', 'docs/_meta/views/zz.md', `view "traffic-load" is already declared in ${V}`]);
  });
  it('warns when the data does not exist yet', () => {
    expect(rules(vaultRepo({ [V]: view({}) }))).toEqual([['view-data-missing', 'warn', V, 'data/out/traffic-load.csv doesn\'t exist yet; the view shows an empty state until it does']]);
  });
  it('reports a view note\'s findings when that one file is checked, as the write hook does', () => {
    const root = vaultRepo({ [V]: view({ type: 'map' }) });
    expect(checkVault(root, { file: V }).findings.map((f) => f.rule)).toEqual(['view-invalid']);
  });
});
