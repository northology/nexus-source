import { describe, it, expect } from 'vitest';
import { addBlock, addLines, addSettings } from '../core/init/shared.ts';

const BLOCK = '<!-- nexus:start -->\n## Docs vault (nexus)\n- one\n<!-- nexus:end -->\n';

describe('addLines', () => {
  it('creates a missing file', () => {
    expect(addLines(null, ['.scratch/', 'docs/.obsidian/workspace*.json'])).toEqual({ status: 'create', text: '.scratch/\ndocs/.obsidian/workspace*.json\n' });
  });
  it('appends only the missing lines, keeping CRLF and a missing final newline', () => {
    expect(addLines('node_modules/\r\n.scratch/', ['.scratch/', 'docs/x/'])).toEqual({ status: 'add', text: 'node_modules/\r\n.scratch/\r\ndocs/x/\r\n' });
  });
  it('is present when every line is there', () => {
    expect(addLines('a/\n.scratch/\n', ['.scratch/'])).toEqual({ status: 'present' });
  });
});

describe('addSettings', () => {
  // The release marketplace entry, as a member: the enabledPlugins tests carry it already, so they check that key alone.
  const SOURCE = { source: { source: 'github', repo: 'northology/nexus' } };
  const MARKET = '"extraKnownMarketplaces": { "nexus": { "source": { "source": "github", "repo": "northology/nexus" } } }';
  it('creates settings that name the release marketplace and enable nexus', () => {
    expect(addSettings(null)).toEqual({
      status: 'create',
      text: '{\n  "extraKnownMarketplaces": {\n    "nexus": { "source": { "source": "github", "repo": "northology/nexus" } }\n  },\n  "enabledPlugins": {\n    "nexus@nexus": true\n  }\n}\n',
    });
    expect(JSON.parse(addSettings(null).text ?? '')).toEqual({ extraKnownMarketplaces: { nexus: SOURCE }, enabledPlugins: { 'nexus@nexus': true } });
  });
  it('adds the key and keeps every other key, the indentation and a BOM', () => {
    const r = addSettings(`﻿{\n    "permissions": { "deny": ["x"] },\n    ${MARKET},\n    "enabledPlugins": { "other@m": false }\n}\n`);
    expect(r.status).toBe('add');
    expect(r.text?.startsWith('﻿{\n    "permissions"')).toBe(true);
    expect(JSON.parse((r.text ?? '').slice(1))).toEqual({ permissions: { deny: ['x'] }, extraKnownMarketplaces: { nexus: SOURCE }, enabledPlugins: { 'other@m': false, 'nexus@nexus': true } });
  });
  it('adds enabledPlugins as a new line and leaves every existing line as it was', () => {
    const before = `{\n  "permissions": {\n    "allow": ["Bash(git *)", "Read"]\n  },\n  ${MARKET},\n  "n": 1.0\n}\n`;
    const r = addSettings(before);
    expect(r.status).toBe('add');
    expect(r.text).toBe(`{\n  "enabledPlugins": { "nexus@nexus": true },\n  "permissions": {\n    "allow": ["Bash(git *)", "Read"]\n  },\n  ${MARKET},\n  "n": 1.0\n}\n`);
  });
  it('adds the key as a new line inside an existing multi-line enabledPlugins, in CRLF', () => {
    const before = `{\r\n  ${MARKET},\r\n  "enabledPlugins": {\r\n    "other@m": false\r\n  }\r\n}\r\n`;
    expect(addSettings(before)).toEqual({ status: 'add', text: `{\r\n  ${MARKET},\r\n  "enabledPlugins": {\r\n    "nexus@nexus": true,\r\n    "other@m": false\r\n  }\r\n}\r\n` });
  });
  it('fills an empty enabledPlugins or an empty file object', () => {
    expect(addSettings(`{${MARKET}, "enabledPlugins": {}}`).text).toBe(`{${MARKET}, "enabledPlugins": { "nexus@nexus": true }}`);
    expect(addSettings('{}').text).toBe(`{ ${MARKET}, "enabledPlugins": { "nexus@nexus": true } }`);
  });
  it('finds the top-level enabledPlugins, not a nested key or a string that looks like one', () => {
    const before = '{\n  "note": "\\"enabledPlugins\\": {",\n  "env": { "enabledPlugins": { "x": 1 }, "extraKnownMarketplaces": { "y": 1 } }\n}\n';
    const r = addSettings(before);
    expect(JSON.parse(r.text ?? '')).toEqual({
      extraKnownMarketplaces: { nexus: SOURCE },
      enabledPlugins: { 'nexus@nexus': true },
      note: '"enabledPlugins": {',
      env: { enabledPlugins: { x: 1 }, extraKnownMarketplaces: { y: 1 } },
    });
  });
  it('adds the release marketplace beside other marketplaces when nexus is already enabled', () => {
    const before = '{\n  "extraKnownMarketplaces": {\n    "other": { "source": { "source": "github", "repo": "o/m" } }\n  },\n  "enabledPlugins": { "nexus@nexus": true }\n}\n';
    expect(addSettings(before)).toEqual({
      status: 'add',
      text: '{\n  "extraKnownMarketplaces": {\n    "nexus": { "source": { "source": "github", "repo": "northology/nexus" } },\n    "other": { "source": { "source": "github", "repo": "o/m" } }\n  },\n  "enabledPlugins": { "nexus@nexus": true }\n}\n',
    });
  });
  it('leaves an existing nexus marketplace alone, whatever its source', () => {
    const dev = '{"extraKnownMarketplaces":{"nexus":{"source":{"source":"directory","path":"/src/nexus"}}},"enabledPlugins":{"nexus@nexus":true}}';
    expect(addSettings(dev)).toEqual({ status: 'present' });
    const r = addSettings('{"extraKnownMarketplaces":{"nexus":{"source":{"source":"directory","path":"/src/nexus"}}}}');
    expect(JSON.parse(r.text ?? '')).toEqual({ enabledPlugins: { 'nexus@nexus': true }, extraKnownMarketplaces: { nexus: { source: { source: 'directory', path: '/src/nexus' } } } });
  });
  it('is present when nexus is enabled and its marketplace named', () => {
    expect(addSettings(`{${MARKET},"enabledPlugins":{"nexus@nexus":true}}`)).toEqual({ status: 'present' });
  });
  it.each([
    ['nexus switched off', '{"enabledPlugins":{"nexus@nexus":false}}', /set to false/],
    ['comments', '{\n  // mine\n  "a": 1\n}', /isn't valid JSON/],
    ['an array', '[]', /isn't a JSON object/],
    ['enabledPlugins not an object', '{"enabledPlugins":[]}', /enabledPlugins isn't an object/],
    ['extraKnownMarketplaces not an object', '{"extraKnownMarketplaces":[]}', /extraKnownMarketplaces isn't an object/],
  ])('stops on %s', (_label, text, reason) => {
    const r = addSettings(text);
    expect(r.status).toBe('conflict');
    expect(r.reason).toMatch(reason);
  });
});

describe('addBlock', () => {
  it('creates CLAUDE.md with only the block', () => {
    expect(addBlock(null, BLOCK)).toEqual({ status: 'create', text: BLOCK });
  });
  it("appends the block after a blank line, in the file's own line endings", () => {
    expect(addBlock('# Repo\r\nRules.\r\n', BLOCK)).toEqual({ status: 'add', text: `# Repo\r\nRules.\r\n\r\n${BLOCK.replace(/\n/g, '\r\n')}` });
  });
  it('is present when the same block is there, whatever its line endings', () => {
    expect(addBlock(`# Repo\r\n\r\n${BLOCK.replace(/\n/g, '\r\n')}`, BLOCK)).toEqual({ status: 'present' });
  });
  it('stops on a nexus block with other content, or one with no end', () => {
    expect(addBlock(`# Repo\n\n${BLOCK.replace('- one', '- two')}`, BLOCK)).toMatchObject({ status: 'conflict', reason: expect.stringMatching(/other content/) });
    expect(addBlock('# Repo\n<!-- nexus:start -->\n', BLOCK)).toMatchObject({ status: 'conflict', reason: expect.stringMatching(/no <!-- nexus:end -->/) });
  });
});
