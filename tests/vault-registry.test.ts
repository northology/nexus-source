import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { archiveFolder, isVault, readRegistry } from '../core/vault/registry.ts';
import { tempDir } from './helpers.ts';

const classNote = (fields: Record<string, unknown>) =>
  `---\n${Object.entries({
    class: 'class', name: 'decision', division: 'governance', folder: 'governance/decisions', produced: 'log',
    thing: false, statuses: ['accepted'], archive: ['superseded'], required: [], optional: [], ...fields,
  }).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n# Class\n`;

function docs(files: Record<string, string>): string {
  const root = tempDir('nexus-registry-');
  const dir = join(root, 'docs');
  mkdirSync(join(dir, '_meta', 'classes'), { recursive: true });
  for (const [rel, text] of Object.entries({ '_meta/contract.md': '---\ncontract: 1\n---\n', ...files })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe('readRegistry', () => {
  it('reads classes, tags, components and the contract', () => {
    const dir = docs({
      '_meta/classes/decision.md': classNote({}),
      '_meta/tags.md': '---\nvocabulary: [retrieval]\n---\n',
      '_meta/components.md': '---\ncomponents: [api]\n---\n',
    });
    const { registry, findings } = readRegistry(dir);
    expect(findings).toEqual([]);
    expect([...registry.classes.keys()]).toEqual(['decision']);
    expect(registry.classes.get('decision')).toMatchObject({ folder: 'governance/decisions', file: 'docs/_meta/classes/decision.md' });
    expect([...registry.tags]).toEqual(['retrieval']);
    expect([...registry.components]).toEqual(['api']);
    expect(registry.contract).toBe(1);
  });
  it('treats missing tags.md and components.md as empty', () => {
    const { registry, findings } = readRegistry(docs({ '_meta/classes/decision.md': classNote({}) }));
    expect(findings).toEqual([]);
    expect(registry.tags.size + registry.components.size).toBe(0);
  });
  it.each([
    ['unreadable frontmatter', '---\nname: [x\n---\n', /can't be read/],
    ['a schema problem', classNote({ division: 'ops' }), /invalid/],
    ['a folder outside its division', classNote({ folder: 'dev/decisions' }), /isn't inside its division/],
    ['a folder inside assets/', classNote({ folder: 'governance/assets/x' }), /assets/],
    ['a folder in the governance archive', classNote({ folder: 'governance/archive/x' }), /governance archive/],
    ['archive statuses outside governance', classNote({ division: 'dev', folder: 'dev/x', archive: ['old'] }), /only governance classes/],
    ['a status both live and archive', classNote({ archive: ['accepted'] }), /both live and archive/],
  ])('blocks a class note with %s and leaves the class out', (_label, text, why) => {
    const { registry, findings } = readRegistry(docs({ '_meta/classes/decision.md': text }));
    expect(registry.classes.size).toBe(0);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'registry-invalid', level: 'block', file: 'docs/_meta/classes/decision.md' });
    expect(findings[0]?.message).toMatch(why);
  });
  it('blocks a second class with the same name', () => {
    const { registry, findings } = readRegistry(docs({ '_meta/classes/a.md': classNote({}), '_meta/classes/b.md': classNote({}) }));
    expect(registry.classes.size).toBe(1);
    expect(findings).toMatchObject([
      { rule: 'class-file-name', file: 'docs/_meta/classes/a.md' },
      { rule: 'registry-invalid', file: 'docs/_meta/classes/b.md' },
    ]);
  });
  it('blocks a missing or invalid contract, and invalid tags or components', () => {
    const root = tempDir('nexus-registry-');
    mkdirSync(join(root, 'docs', '_meta', 'classes'), { recursive: true });
    expect(readRegistry(join(root, 'docs')).findings).toMatchObject([{ rule: 'registry-invalid', file: 'docs/_meta/contract.md' }]);
    const bad = readRegistry(docs({ '_meta/contract.md': '---\ncontract: one\n---\n', '_meta/tags.md': '---\ntags: [x]\n---\n', '_meta/components.md': '---\ncomponents: [shared]\n---\n' }));
    expect(bad.findings.map((f) => f.file).sort()).toEqual(['docs/_meta/components.md', 'docs/_meta/contract.md', 'docs/_meta/tags.md']);
    expect(bad.registry.contract).toBeNull();
  });
});

describe('isVault and archiveFolder', () => {
  it('knows a vault by its classes folder', () => {
    expect(isVault(docs({}))).toBe(true);
    expect(isVault(join(tempDir(), 'docs'))).toBe(false);
  });
  it('mirrors a class folder under governance/archive/', () => {
    const base = { name: 'x', produced: 'log' as const, thing: false, statuses: [], archive: ['retired'], required: [], optional: [], file: '' };
    expect(archiveFolder({ ...base, division: 'governance', folder: 'governance/decisions' })).toBe('governance/archive/decisions');
    expect(archiveFolder({ ...base, division: 'governance', folder: 'governance' })).toBe('governance/archive');
  });
});
