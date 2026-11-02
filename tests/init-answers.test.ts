import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answersText, EMPTY_ANSWERS, parseAnswers, readAnswers } from '../core/init/answers.ts';
import { validate } from '../core/schemas.ts';
import { tempDir } from './helpers.ts';

const good = { answers: 1, components: ['api', 'web'], tags: ['billing', 'topic/sub'], seeding: [{ what: 'the calls dataset', where: 'BigQuery ops.calls' }] };

describe('the answers file', () => {
  it('accepts a full answers file and round-trips it', () => {
    expect(parseAnswers(good)).toEqual(good);
    const file = join(tempDir(), 'a.json');
    writeFileSync(file, answersText(parseAnswers(good)));
    expect(readAnswers(file)).toEqual(good);
  });
  it.each([
    ['a capitalised component', { ...good, components: ['Api'] }],
    ['shared as a component', { ...good, components: ['shared'] }],
    ['a tag with a space', { ...good, tags: ['two words'] }],
    ['a seeding line with no where', { ...good, seeding: [{ what: 'x' }] }],
    ['another version', { ...good, answers: 2 }],
    ['an extra key', { ...good, colour: 'red' }],
  ])('refuses %s', (_label, data) => {
    expect(() => parseAnswers(data)).toThrow(/answers file is invalid/);
  });
  it('says which file could not be read', () => {
    expect(() => readAnswers(join(tempDir(), 'missing.json'))).toThrow(/Could not read the answers file/);
  });
  it('has empty answers for a bare init', () => {
    expect(EMPTY_ANSWERS).toEqual({ answers: 1, components: [], tags: [], seeding: [] });
  });
});

describe('the pinned plugin list schema', () => {
  const sha = 'a'.repeat(64);
  const plugin = { id: 'dataview', version: '0.5.68', repo: 'blacksmithgu/obsidian-dataview', files: [{ name: 'main.js', sha256: sha }] };
  const pins = {
    plugins: [plugin],
    theme: { name: 'Baseline', version: '3.2.12', repo: 'aaaaalexis/obsidian-baseline', commit: 'b'.repeat(40), files: [{ name: 'theme.css', sha256: sha }] },
  };
  it('accepts a pinned list', () => {
    expect(validate('obsidian-pins', pins)).toEqual([]);
  });
  it.each([
    ['a plugin id with a slash', { ...pins, plugins: [{ ...plugin, id: '../x' }] }],
    ['a short hash', { ...pins, plugins: [{ ...plugin, files: [{ name: 'main.js', sha256: 'abc' }] }] }],
    ['an unknown file', { ...pins, plugins: [{ ...plugin, files: [{ name: 'evil.sh', sha256: sha }] }] }],
    ['a theme with no commit', { ...pins, theme: { ...pins.theme, commit: 'main' } }],
  ])('refuses %s', (_label, data) => {
    expect(validate('obsidian-pins', data)).not.toEqual([]);
  });
});
