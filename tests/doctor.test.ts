import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { anchorsFrom, anchorTexts, checkAnchors, compareVersions, findSuperpowers, readAnchors, superpowersWhere, wallStrength, type Anchor } from '../core/doctor.ts';
import { NexusError } from '../core/errors.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { ARTIFACTS, tempDir, NOW } from './helpers.ts';

const DOC = readFileSync(join(ARTIFACTS, 'reference', 'superpowers.md'), 'utf8').replace(/\r\n/g, '\n');
const ANCHORS = anchorsFrom(DOC);

/**
 * The wording an install of `version` has for an anchor, and the file it sits in: the newest alternative at or below
 * that version (a version that changed nothing keeps the last wording), or the one wording every version shares.
 */
const wordingFor = (a: Anchor, version: string): { text: string; file: string } => {
  const fits = anchorTexts(a).filter((t) => t.version === '' || compareVersions(t.version, version) <= 0);
  const t = fits.sort((x, y) => compareVersions(x.version || '0', y.version || '0')).at(-1);
  return t ? { text: t.text, file: t.file ?? a.file } : { text: 'missing', file: a.file };
};

/** A fake home with Superpowers 6.3.0 (empty) and `version` (every anchor present in that version's wording), plus a stray folder. */
function fakeHome(skip: Anchor | null = null, version = '6.4.1'): { home: string; dir: string } {
  const home = tempDir('nexus-home-');
  const base = join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
  mkdirSync(join(base, '6.3.0', 'skills'), { recursive: true });
  mkdirSync(join(base, 'temp_download'), { recursive: true });
  const dir = join(base, version);
  for (const a of ANCHORS) {
    const w = wordingFor(a, version);
    const file = join(dir, w.file);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, a === skip ? '\nsomething else\n' : `\n${w.text}\n`);
  }
  return { home, dir };
}

/** The three brainstorming anchors whose wording differs between 6.4.1 and 7.0.0. */
const VERSIONED: [string, string][] = [
  ['(User preferences for spec location override this default)', "Your human partner's preferences override both."],
  ['Offer the visual companion just-in-time', '**Offer it just-in-time.**'],
  ['**Spec Self-Review:**', 'builder-check-prompt.md'],
];

describe('both Superpowers versions', () => {
  const cliIO = (out: string[], err: string[]): CliIO => ({ cwd: tempDir(), out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} });

  it('the reference lists 18 anchors: three brainstorming ones for 6.4.1 and 7.0.0, three fix-loop ones that moved in 7.0.1', () => {
    expect(ANCHORS).toHaveLength(18);
    const listed = ANCHORS.filter((a) => typeof a.text !== 'string');
    const brainstorming = listed.filter((a) => a.file === 'skills/brainstorming/SKILL.md');
    expect(brainstorming).toHaveLength(3);
    for (const a of brainstorming) expect(anchorTexts(a).map((t) => t.version)).toEqual(['6.4.1', '7.0.0']);
    const moved = listed.filter((a) => a.file === 'skills/subagent-driven-development/SKILL.md');
    expect(moved.map((a) => anchorTexts(a)[0]?.text)).toEqual(['minor (deferred)', 'Task <N>: fix round <R>/5 (', 'Task <N>: parked —']);
    for (const a of moved) {
      expect(anchorTexts(a).map((t) => t.version)).toEqual(['6.4.1', '7.0.1']);
      // Superpowers 7.0.1 moved the fix loop to its own file; the ledger lines nexus reads kept their wording.
      expect(anchorTexts(a)[1]).toEqual({ version: '7.0.1', text: anchorTexts(a)[0]?.text, file: 'skills/subagent-driven-development/references/fix-loop.md' });
    }
  });
  it('each brainstorming alternative is the exact wording of its version', () => {
    const listed = ANCHORS.filter((a) => a.file === 'skills/brainstorming/SKILL.md' && typeof a.text !== 'string').map((a) => anchorTexts(a).map((t) => t.text));
    expect(listed).toEqual(VERSIONED);
  });
  it('an alternative may name its own file, and is looked for there', () => {
    const doc = '<!-- anchors:start -->\n```json\n[{ "file": "a.md", "text": [{ "version": "1.0.0", "text": "x" }, { "version": "2.0.0", "text": "x", "file": "b.md" }], "breaks": "b" }]\n```\n<!-- anchors:end -->';
    const [a] = anchorsFrom(doc) as [Anchor];
    const dir = tempDir();
    mkdirSync(join(dir, 'x'), { recursive: true });
    appendFileSync(join(dir, 'b.md'), 'x');
    expect(checkAnchors(dir, [a])[0]?.matched).toEqual({ version: '2.0.0', text: 'x', file: 'b.md' });
    expect(() => anchorsFrom(doc.replace('"file": "b.md"', '"file": 3'))).toThrow(/each wording needs version and text/);
  });
  it('doctor superpowers passes on 6.4.1, 7.0.0 and 7.0.1 installs', async () => {
    for (const version of ['6.4.1', '7.0.0', '7.0.1']) {
      const out: string[] = [];
      expect(await main(['doctor', 'superpowers', '--path', fakeHome(null, version).dir], cliIO(out, []))).toBe(0);
      expect(out.at(-1)).toBe('All 18 anchors found.');
      if (version === '7.0.0') expect(out).toContain(`ok    skills/brainstorming/SKILL.md: "builder-check-prompt.md" (7.0.0)`);
    }
  });
  it('a missing alternatives anchor lists every wording it looked for', async () => {
    const err: string[] = [];
    const missing = ANCHORS.find((a) => typeof a.text !== 'string') as Anchor;
    expect(await main(['doctor', 'superpowers', '--path', fakeHome(missing, '7.0.0').dir], cliIO([], err))).toBe(1);
    const line = err.join('\n');
    for (const t of anchorTexts(missing)) expect(line).toContain(`"${t.text}" (${t.version})`);
    expect(line).toContain(missing.breaks);
  });
});

describe('the anchors', () => {
  it('are read from reference/superpowers.md', () => {
    expect(ANCHORS.length).toBeGreaterThanOrEqual(15);
    for (const a of ANCHORS) expect(a.file).toMatch(/^skills\/[a-z-]+\/SKILL\.md$/);
  });
  it('each belong to a skill named in the traceability table', () => {
    const table = DOC.slice(0, DOC.indexOf('## Anchors'));
    for (const a of ANCHORS) expect(table, a.file).toContain(`\`${a.file.split('/')[1]}\``);
  });
});

describe('doctor', () => {
  it('compares versions by number', () => {
    expect(compareVersions('6.10.0', '6.4.1')).toBeGreaterThan(0);
    expect(compareVersions('6.4.1', '6.4.1')).toBe(0);
  });
  it('finds the newest installed version', () => {
    const { home, dir } = fakeHome();
    expect(findSuperpowers(home)).toBe(dir);
    expect(findSuperpowers(tempDir())).toBeNull();
  });
  it('passes when every anchor is present, and names what breaks when one is gone', () => {
    expect(checkAnchors(fakeHome().dir, ANCHORS).every((r) => r.ok)).toBe(true);
    const missing = ANCHORS[0] as Anchor;
    const results = checkAnchors(fakeHome(missing).dir, ANCHORS);
    expect(results.filter((r) => !r.ok).map((r) => r.anchor)).toEqual([missing]);
  });
  it('runs from the command line without a build', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = (cwd: string): CliIO => ({ cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} });
    expect(await main(['doctor', 'superpowers', '--path', fakeHome().dir], io(tempDir()))).toBe(0);
    expect(out.at(-1)).toBe(`All ${ANCHORS.length} anchors found.`);
    const missing = ANCHORS[1] as Anchor;
    expect(await main(['doctor', 'superpowers', '--path', fakeHome(missing).dir], io(tempDir()))).toBe(1);
    expect(err.join('\n')).toContain(missing.breaks);
  });
  it('reads the anchors from a file, and a missing file is a NexusError that names it', () => {
    expect(readAnchors(join(ARTIFACTS, 'reference', 'superpowers.md'))).toEqual(ANCHORS);
    const missing = join(tempDir(), 'superpowers.md');
    expect(() => readAnchors(missing)).toThrow(NexusError);
    expect(() => readAnchors(missing)).toThrow(/Could not read the Superpowers anchors from .*superpowers\.md/);
  });
  it('rejects a document without the anchors block', () => {
    expect(() => anchorsFrom('# nothing here')).toThrow(/anchors/);
  });
});

describe('the doctor in each harness', () => {
  const versions = (base: string, names: string[]) => {
    for (const n of names) mkdirSync(join(base, n, 'skills'), { recursive: true });
  };
  it("finds the newest Superpowers in Codex's plugin cache, under CODEX_HOME when it is set", () => {
    const home = tempDir('nexus-home-');
    versions(join(home, '.codex', 'plugins', 'cache', 'obra', 'superpowers'), ['7.0.0', '7.0.1']);
    expect(findSuperpowers(home, 'codex')).toBe(join(home, '.codex', 'plugins', 'cache', 'obra', 'superpowers', '7.0.1'));
    expect(findSuperpowers(home, 'claude-code')).toBeNull();
    const codexHome = tempDir('nexus-codex-');
    versions(join(codexHome, 'plugins', 'cache', 'm', 'superpowers'), ['7.0.0']);
    expect(findSuperpowers(home, 'codex', { codexHome })).toBe(join(codexHome, 'plugins', 'cache', 'm', 'superpowers', '7.0.0'));
  });
  it("finds Superpowers in Antigravity's plugin folder, which keeps one version", () => {
    const home = tempDir('nexus-home-');
    expect(findSuperpowers(home, 'antigravity')).toBeNull();
    mkdirSync(join(home, '.gemini', 'config', 'plugins', 'superpowers', 'skills'), { recursive: true });
    expect(findSuperpowers(home, 'antigravity')).toBe(join(home, '.gemini', 'config', 'plugins', 'superpowers'));
  });
  it('says where it looked in each harness', () => {
    expect(superpowersWhere('claude-code')).toBe('~/.claude/plugins/cache/*/superpowers/');
    expect(superpowersWhere('codex')).toBe('$CODEX_HOME/plugins/cache/*/superpowers/ (~/.codex by default)');
    expect(superpowersWhere('antigravity')).toBe('~/.gemini/config/plugins/superpowers/');
  });
  it('names the harness and states how strong its wall is', () => {
    expect(wallStrength('claude-code')).toMatch(/^Harness: Claude Code\. .*refuses the write/);
    for (const h of ['codex', 'antigravity'] as const) {
      expect(wallStrength(h)).toMatch(new RegExp(`^Harness: ${h === 'codex' ? 'Codex' : 'Antigravity'}\\. `));
      expect(wallStrength(h)).toMatch(/writes go through/);
    }
    expect(wallStrength('codex')).toMatch(/trust/);
    // The Codex spike: exit 2 didn't block on codex-cli 0.162.0, so the line names every failure that lets a write through.
    expect(wallStrength('codex')).toMatch(/exit code, a timeout or unreadable output.*codex-cli 0\.162\.0/);
  });
});

describe('anchor alternatives', () => {
  const block = (anchors: unknown[]): string => `<!-- anchors:start -->\n\`\`\`json\n${JSON.stringify(anchors)}\n\`\`\`\n<!-- anchors:end -->`;
  const both = [{ version: '6.4.1', text: 'old words' }, { version: '7.0.0', text: 'new words' }];
  const listed: Anchor = { file: 'skills/a/SKILL.md', text: both, breaks: 'it breaks' };
  const dirWith = (words: string): string => {
    const dir = tempDir();
    mkdirSync(join(dir, 'skills', 'a'), { recursive: true });
    appendFileSync(join(dir, 'skills', 'a', 'SKILL.md'), `\r\n${words}\r\n`);
    return dir;
  };

  it('parses a block mixing plain strings and alternatives', () => {
    const plain = { file: 'skills/b/SKILL.md', text: 'plain words', breaks: 'b breaks' };
    expect(anchorsFrom(block([plain, listed]))).toEqual([plain, listed]);
  });
  it('refuses an empty list, an entry without version or text, and a repeated version', () => {
    for (const text of [[], [{ version: '6.4.1' }], [{ text: 'x' }], [{ version: '6.4.1', text: 'a' }, { version: '6.4.1', text: 'b' }]]) {
      expect(() => anchorsFrom(block([{ file: 'skills/c/SKILL.md', text, breaks: 'c' }]))).toThrow(/skills\/c\/SKILL\.md/);
    }
  });
  it('passes on either alternative and says which matched', () => {
    expect(checkAnchors(dirWith('new words'), [listed])).toEqual([{ anchor: listed, ok: true, matched: { version: '7.0.0', text: 'new words' } }]);
    expect(checkAnchors(dirWith('old words'), [listed])).toEqual([{ anchor: listed, ok: true, matched: { version: '6.4.1', text: 'old words' } }]);
  });
  it('fails when no alternative is present', () => {
    expect(checkAnchors(dirWith('other words'), [listed])).toEqual([{ anchor: listed, ok: false, matched: null }]);
  });
  it('a plain string anchor matches with an empty version', () => {
    const plain: Anchor = { file: 'skills/a/SKILL.md', text: 'old words', breaks: 'x' };
    expect(anchorTexts(plain)).toEqual([{ version: '', text: 'old words' }]);
    expect(checkAnchors(dirWith('old words'), [plain])[0]?.matched).toEqual({ version: '', text: 'old words' });
  });
});
