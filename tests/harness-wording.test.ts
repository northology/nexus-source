import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { skillCommand } from '../core/harness.ts';
import { RESOLVE_LINE, rewriteSkill } from '../scripts/harness-wording.ts';
import { ARTIFACTS } from './helpers.ts';

const PLAN = readFileSync(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md'), 'utf8');

describe('rewriteSkill', () => {
  it('leaves a Claude Code skill as it is', () => {
    expect(rewriteSkill(PLAN, 'claude-code')).toBe(PLAN);
  });
  for (const h of ['codex', 'antigravity'] as const) {
    it(`under ${h} runs the CLI by a path relative to the skill, and says so once, after the frontmatter`, () => {
      const out = rewriteSkill(PLAN, h);
      expect(out).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      expect(out).toContain('node "../../bin/nexus.mjs" <command>');
      expect(out).toContain('`../../reference/gates.md`');
      expect(out.split(RESOLVE_LINE).length).toBe(2);
      const end = out.indexOf('\n---\n', 4);
      expect(out.slice(end + 5).startsWith(`${RESOLVE_LINE}\n`)).toBe(true);
      expect(out.startsWith('---\nname: plan\n')).toBe(true);
    });
  }
  it('under Codex names the skills as Codex starts them', () => {
    const out = rewriteSkill(PLAN, 'codex');
    expect(out).not.toMatch(/\/nexus:/);
    expect(out).toContain('`$nexus:plan` step 5');
    expect(rewriteSkill(PLAN, 'antigravity')).toContain('`/nexus:plan` step 5');
  });
  it("offers each harness's own instruction files as static rules", () => {
    expect(PLAN).toContain('(offer `CLAUDE.md` and any `.claude/rules/*`)');
    expect(rewriteSkill(PLAN, 'codex')).toContain('(offer `AGENTS.md`)');
    expect(rewriteSkill(PLAN, 'antigravity')).toContain('(offer `AGENTS.md` and any `.agents/rules/*.md`)');
  });
  it("lets the init skill add this harness to a repo another harness set up, and keeps Claude Code's stop", () => {
    const INIT = readFileSync(join(ARTIFACTS, 'skills', 'init', 'SKILL.md'), 'utf8');
    expect(INIT).toContain('If `docs/_meta/` exists, the repo is already set up:\n   say so and stop.');
    for (const h of ['codex', 'antigravity'] as const) {
      const out = rewriteSkill(INIT, h);
      expect(out).not.toContain('say so and stop.');
      expect(out).toContain('run `nexus init` with no questions');
    }
  });
  it('adds no line to a skill with no relative path', () => {
    const text = '---\nname: x\n---\n# X\n';
    expect(rewriteSkill(text, 'codex')).toBe(text);
  });
});

describe('every skill', () => {
  // Claude Code's frontmatter reader forgives what YAML doesn't; Antigravity's validator skips such a skill.
  it('has frontmatter that parses as strict YAML', () => {
    for (const s of readdirSync(join(ARTIFACTS, 'skills'))) {
      const text = readFileSync(join(ARTIFACTS, 'skills', s, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
      expect(() => parse(fm, { strict: true, uniqueKeys: true }), s).not.toThrow();
      expect((parse(fm) as { name: string }).name, s).toBe(s);
    }
  });
});

describe('skillCommand', () => {
  it('is /nexus:<skill>, and $nexus:<skill> in Codex', () => {
    expect(skillCommand('plan')).toBe('/nexus:plan');
    expect(skillCommand('plan', 'antigravity')).toBe('/nexus:plan');
    expect(skillCommand('decommission', 'codex')).toBe('$nexus:decommission');
  });
});
