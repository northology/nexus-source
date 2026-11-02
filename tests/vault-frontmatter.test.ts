import { describe, it, expect } from 'vitest';
import { readFrontmatter } from '../core/vault/frontmatter.ts';

describe('readFrontmatter', () => {
  it('reads properties, the body and where each key sits', () => {
    const fm = readFrontmatter('---\nclass: decision\nstatus: accepted\n---\n# Title\nText\n');
    expect(fm.error).toBeNull();
    expect(fm.data).toEqual({ class: 'decision', status: 'accepted' });
    expect(fm.body).toEqual(['# Title', 'Text', '']);
    expect(fm.bodyLine).toBe(5);
    expect(fm.keyLines.get('status')).toBe(3);
  });
  it('handles CRLF line endings and a UTF-8 BOM', () => {
    const fm = readFrontmatter('﻿---\r\nclass: decision\r\n---\r\nBody\r\n');
    expect(fm.data).toEqual({ class: 'decision' });
    expect(fm.body[0]).toBe('Body');
  });
  it('keeps dates and quoted wikilinks as strings, and unquoted wikilinks as nested lists', () => {
    const fm = readFrontmatter('---\ndate: 2026-10-07\nuses: "[[dev/systems/a]]"\nfeeds: [[dev/systems/b]]\n---\n');
    expect(fm.data).toEqual({ date: '2026-10-07', uses: '[[dev/systems/a]]', feeds: [['dev/systems/b']] });
  });
  it('treats a note with no frontmatter as having none', () => {
    const fm = readFrontmatter('# Just a note\n');
    expect(fm).toMatchObject({ data: null, error: null, bodyLine: 1 });
  });
  it('treats empty frontmatter as no properties', () => {
    expect(readFrontmatter('---\n---\nBody\n').data).toEqual({});
  });
  it.each([
    ['an unclosed block', '---\nclass: decision\n', /no closing ---/],
    ['invalid YAML', '---\nclass: [decision\n---\n', /.+/],
    ['a list instead of properties', '---\n- one\n- two\n---\n', /not a set of properties/],
    ['a repeated key', '---\nclass: a\nclass: b\n---\n', /.+/],
  ])('reports %s without throwing', (_label, text, why) => {
    const fm = readFrontmatter(text);
    expect(fm.data).toBeNull();
    expect(fm.error).toMatch(why);
  });
});
