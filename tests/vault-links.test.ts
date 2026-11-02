import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { linkFiles, linkState, scanBody, typedLinkValues } from '../core/vault/links.ts';
import { vaultRepo } from './vault-helpers.ts';

describe('scanBody', () => {
  it('finds wikilinks and embeds with their lines', () => {
    const scan = scanBody(['See [[dev/systems/a]] and [[dev/systems/b|B]].', '', '![[design/assets/logo.svg]]'], 10);
    expect(scan.links).toEqual([
      { target: 'dev/systems/a', line: 10 },
      { target: 'dev/systems/b|B', line: 10 },
      { target: 'design/assets/logo.svg', line: 12 },
    ]);
  });
  it('skips code fences and inline code', () => {
    const scan = scanBody(['```', '[[dev/systems/x]]', 'key:: value', '```', 'Use `[[not/a/link]]` here.', '~~~js', '```dataviewjs', '~~~'], 1);
    expect(scan).toEqual({ links: [], jsBlocks: [], inlineFields: [] });
  });
  it('flags dataviewjs and datacorejs fences', () => {
    expect(scanBody(['```dataviewjs', 'dv.list()', '```', 'text', '~~~datacorejs', 'x', '~~~'], 3).jsBlocks).toEqual([3, 7]);
  });
  it('keeps shorter fences inside a longer outer fence: an example of a JS block is not one', () => {
    const body = ['````markdown', '```', 'text', '```', '```dataviewjs', 'dv.list()', '```', '````', 'after [[dev/systems/a]]'];
    const scan = scanBody(body, 1);
    expect(scan.jsBlocks).toEqual([]);
    expect(scan.links).toEqual([{ target: 'dev/systems/a', line: 9 }]);
  });
  it('flags a JS fence that opens right after another fence closes', () => {
    expect(scanBody(['```', 'a', '```', '```dataviewjs', 'b', '```'], 1).jsBlocks).toEqual([4]);
  });
  it('flags Dataview inline fields, but not code-like double colons', () => {
    const scan = scanBody(['owner:: Sam', 'A [due:: 2026-10-07] task', 'std::vector is fine', 'see https://x.y'], 1);
    expect(scan.inlineFields).toEqual([1, 2]);
  });
});

describe('typedLinkValues', () => {
  it.each([
    ['a quoted link', '[[dev/systems/a]]', { links: ['dev/systems/a'], malformed: 0 }],
    ['a list of quoted links', ['[[a/b]]', '[[c/d]]'], { links: ['a/b', 'c/d'], malformed: 0 }],
    ['nothing', undefined, { links: [], malformed: 0 }],
    ['an empty list', [], { links: [], malformed: 0 }],
    ['an unquoted link (a nested list)', [['dev/systems/a']], { links: [], malformed: 1 }],
    ['plain text', 'dev/systems/a', { links: [], malformed: 1 }],
    ['a number', 3, { links: [], malformed: 1 }],
  ])('reads %s', (_label, value, expected) => {
    expect(typedLinkValues(value)).toEqual(expected);
  });
});

describe('linkState and linkFiles', () => {
  const docs = join(vaultRepo({ 'docs/dev/systems/a.md': '# A\n', 'docs/dev/systems/nexus-1.0.md': '# N\n', 'docs/design/assets/logo.svg': '<svg/>' }), 'docs');
  it.each([
    ['dev/systems/a', 'ok'],
    ['dev/systems/nexus-1.0', 'ok'],
    ['dev/systems/a|Alias', 'ok'],
    ['dev/systems/a#Heading', 'ok'],
    ['dev/systems/a.md', 'ok'],
    ['design/assets/logo.svg', 'ok'],
    ['#Heading in this note', 'ok'],
    ['a', 'short'],
    ['dev/systems/missing', 'unresolved'],
  ])('[[%s]] is %s', (inner, state) => {
    expect(linkState(docs, inner)).toBe(state);
  });
  it('names the files a link can point to: the note first, then the target as written when it looks like a file', () => {
    expect(linkFiles('governance/decisions/x|X')).toEqual(['governance/decisions/x.md']);
    expect(linkFiles('dev/systems/nexus-1.0')).toEqual(['dev/systems/nexus-1.0.md', 'dev/systems/nexus-1.0']);
    expect(linkFiles('design/assets/logo.svg')).toEqual(['design/assets/logo.svg.md', 'design/assets/logo.svg']);
    expect(linkFiles('dev/systems/a.md')).toEqual(['dev/systems/a.md']);
  });
});
