// What build.mjs rewrites in each package's skills: Claude Code's own forms, where another harness reads others. Only
// Claude Code substitutes ${CLAUDE_PLUGIN_ROOT} in a skill's text, so the others run the CLI by a path relative to the
// skill's folder (skills/<name>/), which both harnesses show the model. Codex starts a plugin's skill as $nexus:<skill>
// (the Codex probe: skills are namespaced <plugin>:<skill>); Antigravity's form stays /nexus:<skill> until its proof.
import type { Harness } from '../core/harness.ts';

export const RESOLVE_LINE = 'Paths in this skill that start with `../../` are relative to the folder holding this SKILL.md: resolve them from there.';

/** The static rules /nexus:plan offers: each harness's own instruction files (it reads no CLAUDE.md). */
const OFFER = '(offer `CLAUDE.md` and any `.claude/rules/*`)';
/** init's stop on a set-up repo: in Codex and Antigravity init adds that harness to it instead (core/init/init.ts). */
const SET_UP = 'If `docs/_meta/` exists, the repo is already set up:\n   say so and stop.';
const ADD_HARNESS = 'If `docs/_meta/` exists, the repo is already set up,\n   perhaps from another harness: run `nexus init` with no questions, which adds only this harness\'s `AGENTS.md` block,\n   then report what it wrote (or that it was already there) and stop.';

export const WORDING: Record<Harness, [string, string][]> = {
  'claude-code': [],
  codex: [['${CLAUDE_PLUGIN_ROOT}/', '../../'], ['/nexus:', '$nexus:'], [OFFER, '(offer `AGENTS.md`)'], [SET_UP, ADD_HARNESS]],
  antigravity: [['${CLAUDE_PLUGIN_ROOT}/', '../../'], [OFFER, '(offer `AGENTS.md` and any `.agents/rules/*.md`)'], [SET_UP, ADD_HARNESS]],
};

/** A skill's text for the harness: the table's substitutions, then the line saying how to read a relative path. */
export function rewriteSkill(text: string, harness: Harness): string {
  let out = text;
  for (const [from, to] of WORDING[harness]) out = out.split(from).join(to);
  if (out === text || !out.includes('../../')) return out;
  const end = out.startsWith('---\n') ? out.indexOf('\n---\n', 4) : -1;
  const at = end === -1 ? 0 : end + 5;
  return `${out.slice(0, at)}${RESOLVE_LINE}\n${out.slice(at)}`;
}
