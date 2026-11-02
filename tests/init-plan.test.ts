import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPlan, describePlan, planInit } from '../core/init/init.ts';
import { answersText, EMPTY_ANSWERS, type InitAnswers } from '../core/init/answers.ts';
import { checkVault } from '../core/vault/check.ts';
import { tempDir, treeHash } from './helpers.ts';
import { STANDARD } from './vault-helpers.ts';

const ANSWERS: InitAnswers = { answers: 1, components: ['api', 'web'], tags: ['billing'], seeding: [{ what: 'the spec', where: 'docs-old/spec.md' }] };
const opts = (answers = ANSWERS) => ({ standard: STANDARD, answers, downloads: null, repoName: 'acme-app' });
const kinds = (root: string) => Object.fromEntries(planInit(root, opts()).actions.filter((a) => !a.path.startsWith('docs/')).map((a) => [a.path, a.kind]));

describe('planInit on a fresh repo', () => {
  it('creates the registry, settings, answers and the four shared files, and the result checks clean', () => {
    const root = tempDir('nexus-init-');
    const plan = planInit(root, opts());
    expect(plan.problems).toEqual([]);
    applyPlan(root, plan);
    expect(readFileSync(join(root, 'docs/_meta/components.md'), 'utf8')).toMatch(/^---\ncomponents: \["api", "web"\]\n---/);
    expect(readFileSync(join(root, 'docs/_meta/tags.md'), 'utf8')).toMatch(/^---\nvocabulary: \["billing"\]\n---/);
    expect(readFileSync(join(root, '.nexus/init-answers.json'), 'utf8')).toBe(answersText(ANSWERS));
    expect(JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'))).toEqual({ enabledPlugins: { 'nexus@nexus': true } });
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(readFileSync(join(STANDARD, 'claude-block.md'), 'utf8'));
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.scratch/\ndocs/.obsidian/workspace*.json\n');
    expect(readFileSync(join(root, '.ignore'), 'utf8')).toBe('docs/governance/archive/\ndocs/superpowers/archive/\n');
    expect(JSON.parse(readFileSync(join(root, 'docs/.obsidian/plugins/hearth/data.json'), 'utf8'))).toMatchObject({ title: 'acme-app' });
    expect(checkVault(root)).toMatchObject({ vault: true, notes: 0, findings: [] });
  });
  it('writes no notes and no division folders', () => {
    const root = tempDir('nexus-init-');
    applyPlan(root, planInit(root, opts()));
    for (const d of ['dev', 'data', 'governance', 'documentation', 'design', 'superpowers']) expect(existsSync(join(root, 'docs', d)), d).toBe(false);
  });
  it('adds to shared files that exist and leaves identical entries alone', () => {
    const root = tempDir('nexus-init-');
    writeFileSync(join(root, 'CLAUDE.md'), '# Acme\n');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n.scratch/\n');
    expect(kinds(root)).toMatchObject({ 'CLAUDE.md': 'add', '.gitignore': 'add', '.ignore': 'create', '.claude/settings.json': 'create' });
  });
  it('treats the answers file it was given as present when it holds the same answers', () => {
    const root = tempDir('nexus-init-');
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus/init-answers.json'), answersText(ANSWERS));
    const plan = planInit(root, opts());
    expect(plan.problems).toEqual([]);
    expect(plan.actions.find((a) => a.path === '.nexus/init-answers.json')?.kind).toBe('present');
  });
});

describe('planInit and an answers file written by hand', () => {
  it.each([
    ['compact', JSON.stringify(ANSWERS)],
    ['four-space indented, CRLF, with a BOM', `﻿${JSON.stringify(ANSWERS, null, 4).replace(/\n/g, '\r\n')}\r\n`],
    ['with its keys in another order', JSON.stringify({ seeding: ANSWERS.seeding, tags: ANSWERS.tags, components: ANSWERS.components, answers: 1 })],
  ])('treats the same answers %s as present', (_label, text) => {
    const root = tempDir('nexus-init-');
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus/init-answers.json'), text);
    const plan = planInit(root, opts());
    expect(plan.problems).toEqual([]);
    expect(plan.actions.find((a) => a.path === '.nexus/init-answers.json')?.kind).toBe('present');
  });
});

describe('planInit refusals', () => {
  it('refuses a docs/ that already holds files, naming them, but not one with only dot-entries or a README', () => {
    const root = tempDir('nexus-init-');
    mkdirSync(join(root, 'docs', 'dev', 'context'), { recursive: true });
    writeFileSync(join(root, 'docs/dev/context/notes.md'), '# mine\n');
    writeFileSync(join(root, 'docs/guide.md'), '# guide\n');
    expect(planInit(root, opts()).problems).toEqual(['docs/ already holds dev/, guide.md: init sets up an empty vault, so move them out first and piece them in after (nothing was written)']);
    const fine = tempDir('nexus-init-');
    mkdirSync(join(fine, 'docs'));
    writeFileSync(join(fine, 'docs/.gitkeep'), '');
    writeFileSync(join(fine, 'docs/README.md'), '# Docs\n');
    expect(planInit(fine, opts()).problems).toEqual([]);
  });
  it('refuses unmarked files in .claude/rules/nexus/, which generate would stop on', () => {
    const root = tempDir('nexus-init-');
    mkdirSync(join(root, '.claude', 'rules', 'nexus'), { recursive: true });
    writeFileSync(join(root, '.claude/rules/nexus/mine.md'), '# hand-written\n');
    expect(planInit(root, opts()).problems).toEqual(['.claude/rules/nexus/mine.md has no generated marker: .claude/rules/nexus/ holds only files nexus generates, so move it first']);
  });
  it('stops on an initialized repo', () => {
    const root = tempDir('nexus-init-');
    mkdirSync(join(root, 'docs', '_meta'), { recursive: true });
    expect(planInit(root, opts()).problems).toEqual(['docs/_meta/ already exists: this repo is already set up (init runs once per repo)']);
  });
  it('names every conflict at once', () => {
    const root = tempDir('nexus-init-');
    mkdirSync(join(root, 'docs', '.obsidian'), { recursive: true });
    writeFileSync(join(root, 'docs/.obsidian/app.json'), '{}');
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude/settings.json'), '{"enabledPlugins":{"nexus@nexus":false}}');
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus/init-answers.json'), answersText(EMPTY_ANSWERS));
    expect(planInit(root, opts()).problems).toEqual([
      'docs/.obsidian/app.json already exists',
      '.nexus/init-answers.json already exists with other answers',
      ".claude/settings.json: enabledPlugins[\"nexus@nexus\"] is set to false; init won't change it",
    ]);
  });
});

describe('applyPlan', () => {
  it('rolls everything back when a write fails partway', () => {
    const root = tempDir('nexus-init-');
    writeFileSync(join(root, 'CLAUDE.md'), '# Acme\n');
    const before = treeHash(root);
    const plan = planInit(root, opts());
    // Fail on the last write (.ignore), after CLAUDE.md was added to: both removal and restore are exercised.
    const last = plan.actions.filter((a) => a.kind !== 'present').length;
    let n = 0;
    const failing = (abs: string, data: string | Uint8Array) => {
      n += 1;
      if (n === last) throw new Error('disk full');
      writeFileSync(abs, data);
    };
    expect(() => applyPlan(root, plan, failing)).toThrow(/disk full.*removed/);
    expect(treeHash(root)).toBe(before);
  });
  it('keeps the first error when the rollback also fails, and names what it could not restore', () => {
    const root = tempDir('nexus-init-');
    writeFileSync(join(root, 'CLAUDE.md'), '# Acme\n');
    const plan = planInit(root, opts());
    const last = plan.actions.filter((a) => a.kind !== 'present').length;
    let n = 0;
    const failing = (abs: string, data: string | Uint8Array) => {
      n += 1;
      if (n === last) {
        chmodSync(join(root, 'CLAUDE.md'), 0o444);
        throw new Error('disk full');
      }
      writeFileSync(abs, data);
    };
    try {
      expect(() => applyPlan(root, plan, failing)).toThrow(/init failed while writing \(disk full\).*couldn't restore CLAUDE\.md/s);
    } finally {
      chmodSync(join(root, 'CLAUDE.md'), 0o644);
    }
  });
  it('refuses a plan with problems', () => {
    expect(() => applyPlan(tempDir(), { actions: [], problems: ['x'] })).toThrow(/nothing was written/);
  });
});

describe('describePlan', () => {
  it('groups the registry and the Obsidian files, and lists shared files one by one', () => {
    const root = tempDir('nexus-init-');
    writeFileSync(join(root, 'CLAUDE.md'), '# Acme\n');
    const lines = describePlan(planInit(root, opts()));
    expect(lines[0]).toMatch(/^ {2}create {3}docs\/_meta\/ \(27 files\)$/);
    expect(lines).toContain('  add      CLAUDE.md');
    expect(lines).toContain('  create   .nexus/init-answers.json');
  });
});
