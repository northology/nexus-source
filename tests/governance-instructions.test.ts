import { describe, it, expect } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_NOTE, importsOf, instructionItems, titleOf } from '../core/governance/instructions.ts';
import type { Found, InventoryProblem } from '../core/governance/types.ts';
import { put, sandbox } from './governance-helpers.ts';

const names = (found: Found[], base: string) => found.map((f) => f.file.slice(base.length + 1).replace(/\\/g, '/'));

describe('importsOf', () => {
  it('reads @paths outside code, ignoring emails, fences and code spans', () => {
    const text = 'See @docs/guide.md and @~/notes/x.md.\nMail a@b.ca\n`@not/this.md`\n```\n@nor/this.md\n```\n@./local.md';
    expect(importsOf(text)).toEqual(['docs/guide.md', '~/notes/x.md', './local.md']);
  });
});

describe('importsOf fences', () => {
  it('skips fences indented up to three spaces and treats an unclosed fence as running to the end', () => {
    expect(importsOf('@one.md\n   ```\n@two.md\n   ```\n@three.md')).toEqual(['one.md', 'three.md']);
    expect(importsOf('@one.md\n```\n@two.md\n@three.md\n')).toEqual(['one.md']);
    expect(importsOf('@one.md\n~~~\n@two.md')).toEqual(['one.md']);
  });
});

describe('importsOf fence edges', () => {
  it('closes a fence only on the same marker, at least as long, with nothing after it', () => {
    expect(importsOf('```\n@a.md\n``` text\n@b.md\n````\n@c.md\n')).toEqual(['c.md']);
    expect(importsOf('````\n@a.md\n```\n@b.md\n````\n@c.md\n')).toEqual(['c.md']);
  });
  it('reads a line like ```x``` as inline code, not a fence', () => {
    expect(importsOf('```x``` here\n@a.md\n')).toEqual(['a.md']);
  });
  it('still opens a tilde fence when its info string repeats the marker', () => {
    expect(importsOf('~~~ a ~~~\n@x.md\n~~~\n@y.md\n')).toEqual(['y.md']);
  });
});

describe('titleOf', () => {
  it('does not let a bare # line borrow the next line', () => {
    expect(titleOf('#\nnot a title\n', 'dir/f.md')).toBe('f.md');
  });
  it('handles CRLF frontmatter and ignores headings inside fences', () => {
    expect(titleOf('---\r\nname: x\r\n---\r\n# Real\r\n', 'f.md')).toBe('Real');
    expect(titleOf('```\n# Not this\n```\n# This\n', 'f.md')).toBe('This');
    expect(titleOf('```\n# Unclosed\n', 'dir/f.md')).toBe('f.md');
  });
});

describe('instructionItems', () => {
  it('finds CLAUDE.md, CLAUDE.local.md and .claude/CLAUDE.md in the repo and each folder above, then user and managed', () => {
    const { base, root, outer, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n', 'CLAUDE.local.md': '# Local\n', '.claude/CLAUDE.md': '# Dot\n' });
    put(outer, { 'CLAUDE.md': '# Workspace\n' });
    put(env.configDir, { 'CLAUDE.md': '# Mine\n' });
    put(env.managedDir, { 'CLAUDE.md': '# Policy\n' });
    const found = instructionItems(root, env, []);
    expect(names(found, base)).toEqual([
      'outer/repo/CLAUDE.md', 'outer/repo/CLAUDE.local.md', 'outer/repo/.claude/CLAUDE.md',
      'outer/CLAUDE.md', 'home/.claude/CLAUDE.md', 'managed/CLAUDE.md',
    ]);
    expect(found.every((f) => f.kind === 'instructions' && f.scope === 'always' && f.launchedFrom === undefined)).toBe(true);
    expect(found[0]?.title).toBe('Repo');
  });
  it('says plainly that Claude Code does not load an AGENTS.md when the repo or a folder above has a CLAUDE.md', () => {
    const { root, outer, env } = sandbox();
    put(root, { 'AGENTS.md': '# Codex\n', 'CLAUDE.local.md': '# Local\n' });
    put(outer, { 'AGENTS.md': '# Above\n' });
    const agents = instructionItems(root, env, []).filter((f) => f.file.endsWith('AGENTS.md'));
    expect(agents.map((f) => f.conditional)).toEqual([AGENTS_NOTE, AGENTS_NOTE]);
    expect(AGENTS_NOTE).toBe("Claude Code doesn't load it here: this repo or a folder above has a CLAUDE.md");
  });
  it('lists an AGENTS.md with no note when no CLAUDE.md is in the repo or above, so Claude Code loads it', () => {
    const { root, outer, env } = sandbox();
    put(root, { 'AGENTS.md': '# Codex\n' });
    put(env.configDir, { 'CLAUDE.md': '# User\n' });
    put(outer, { 'AGENTS.md': '# Above\n' });
    const agents = instructionItems(root, env, []).filter((f) => f.file.endsWith('AGENTS.md'));
    expect(agents).toHaveLength(2);
    expect(agents.every((f) => f.conditional === undefined)).toBe(true);
  });
  it('still names the importer of an AGENTS.md that Claude Code would load anyway', () => {
    const { root, outer, env } = sandbox();
    put(env.configDir, { 'CLAUDE.md': '# User\n@~/../outer/repo/AGENTS.md\n' });
    put(root, { 'AGENTS.md': '# Codex\n' });
    const a = instructionItems(root, env, []).find((f) => f.file === join(root, 'AGENTS.md'));
    expect(a?.source).toBe(join(env.configDir, 'CLAUDE.md'));
    expect(a?.conditional).toBeUndefined();
  });
  it('follows imports four hops deep, each file once, naming the file that imports it', () => {
    const { base, root, env } = sandbox();
    put(root, {
      'CLAUDE.md': '# Repo\n@a.md\n',
      'a.md': '@b.md\n', 'b.md': '@c.md\n', 'c.md': '@d.md\n', 'd.md': '@e.md\n', 'e.md': 'five hops: not loaded\n',
    });
    const found = instructionItems(root, env, []);
    expect(names(found, base)).toEqual(['outer/repo/CLAUDE.md', 'outer/repo/a.md', 'outer/repo/b.md', 'outer/repo/c.md', 'outer/repo/d.md']);
    expect(found[1]?.source).toBe(join(root, 'CLAUDE.md'));
    expect(found[4]?.source).toBe(join(root, 'c.md'));
  });
  it('lists each file once when imports loop back', () => {
    const { base, root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n@a.md\n', 'a.md': '@b.md\n', 'b.md': '@a.md\n@CLAUDE.md\n@c.md\n', 'c.md': '@b.md\n' });
    expect(names(instructionItems(root, env, []), base)).toEqual(['outer/repo/CLAUDE.md', 'outer/repo/a.md', 'outer/repo/b.md', 'outer/repo/c.md']);
  });
  it('follows the imports of an AGENTS.md that an import made always-loaded', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': '# Codex\n@x.md\n', 'x.md': '# X\n' });
    const x = instructionItems(root, env, []).find((f) => f.file === join(root, 'x.md'));
    expect(x?.source).toBe(join(root, 'AGENTS.md'));
  });
  it('resolves ~/ imports against home and skips imports that do not exist', () => {
    const { base, root, env } = sandbox();
    put(root, { 'CLAUDE.md': '@~/shared.md\n@missing.md\n' });
    put(env.home, { 'shared.md': '# Shared\n' });
    expect(names(instructionItems(root, env, []), base)).toEqual(['outer/repo/CLAUDE.md', 'home/shared.md']);
  });
  it('reports a CLAUDE.md that is a link out of its folder and does not read it', () => {
    const { root, env, base } = sandbox();
    put(base, { 'elsewhere/CLAUDE.md': '# Linked\n' });
    put(root, {});
    // A folder link: .claude/ points outside the repo.
    symlinkSync(join(base, 'elsewhere'), join(root, '.claude'), 'junction');
    const problems: InventoryProblem[] = [];
    expect(instructionItems(root, env, problems)).toEqual([]);
    expect(problems).toEqual([{ location: join(root, '.claude', 'CLAUDE.md'), message: 'a link leads out of its folder; not read' }]);
  });
  it('treats AGENTS.md imported by a CLAUDE.md as always loaded, naming the importer', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n@AGENTS.md\n', 'AGENTS.md': '# Codex\n' });
    const found = instructionItems(root, env, []);
    expect(found).toHaveLength(2);
    const a = found.find((f) => f.file === join(root, 'AGENTS.md'));
    expect(a?.source).toBe(join(root, 'CLAUDE.md'));
    expect(a?.conditional).toBeUndefined();
  });
  it('lists an AGENTS.md in a folder above the repo with the note when the repo has a CLAUDE.md', () => {
    const { base, root, outer, env } = sandbox();
    put(outer, { 'AGENTS.md': '# Above\n' });
    put(root, { 'CLAUDE.md': '# Repo\n' });
    const found = instructionItems(root, env, []);
    expect(names(found, base)).toEqual(['outer/repo/CLAUDE.md', 'outer/AGENTS.md']);
    expect(found[1]?.conditional).toBe(AGENTS_NOTE);
  });
  it.skipIf(process.platform !== 'win32')('lists a file once when an import spells its name in a different case', () => {
    const { root, env } = sandbox();
    put(root, { 'CLAUDE.md': '# Repo\n@claude.md\n' });
    expect(instructionItems(root, env, [])).toHaveLength(1);
  });
  it('reports a CLAUDE.md that is a file link out of its folder', (ctx) => {
    const { root, env, base } = sandbox();
    put(base, { 'elsewhere/CLAUDE.md': '# Linked\n' });
    try {
      symlinkSync(join(base, 'elsewhere', 'CLAUDE.md'), join(root, 'CLAUDE.md'), 'file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw e;
    }
    const problems: InventoryProblem[] = [];
    expect(instructionItems(root, env, problems)).toEqual([]);
    expect(problems).toEqual([{ location: join(root, 'CLAUDE.md'), message: 'a link leads out of its folder; not read' }]);
  });
});
