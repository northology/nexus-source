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

/** The wall's list of permanent rules, in the nexus skill and in /nexus:plan, as each harness's own files. */
const WALL_NEXUS = '(CLAUDE.md, CLAUDE.local.md, AGENTS.md,\n`.claude/settings*`, `.claude/rules/`, memory, `.nexus/config.json`, `docs/_meta/`)';
const WALL_PLAN = '(CLAUDE.md, CLAUDE.local.md, AGENTS.md, `.claude/settings*`, `.claude/rules/`, memory,\n  `.nexus/config.json`, `docs/_meta/`)';
const wall = (files: string, indent: string): string => `(${files},\n${indent}\`.nexus/config.json\`, \`docs/_meta/\`, and other harnesses' rule files)`;
const AGY_WALL = 'AGENTS.md, GEMINI.md, `.agents/rules/`, `.agents/hooks.json`, `.agents/plugins/`, `~/.gemini/config/`';
const CODEX_WALL = 'AGENTS.md, AGENTS.override.md, `.codex/config.toml`';

/** What every harness but Claude Code rewrites the same way: Claude Code's own files, commands and tools. */
const SHARED: [string, string][] = [
  ['${CLAUDE_PLUGIN_ROOT}/', '../../'],
  [OFFER, ''],
  [SET_UP, ADD_HARNESS],
  ['`CLAUDE.md`, `.claude/settings.json`,\n   `.gitignore`', '`AGENTS.md`,\n   `.gitignore`'],
  ['(not output styles or\n   hook context; `/context` shows what this session loaded)', '(not hook context)'],
  ['(a memory, or a CLAUDE.md or rules file', '(a memory, or an AGENTS.md or rules file'],
  ['--raised-by claude`', '--raised-by agent`'],
  ['> - When offering execution approaches, also offer a Workflow (the Workflow tool), used only if the user asks for it.\n', ''],
];
const own = (offer: string, extra: [string, string][]): [string, string][] => SHARED.map(([from, to]): [string, string] => [from, from === OFFER ? offer : to]).concat(extra);

export const WORDING: Record<Harness, [string, string][]> = {
  'claude-code': [],
  codex: own('(offer `AGENTS.md`)', [
    ['/nexus:', '$nexus:'],
    ['memory, CLAUDE.md or settings', 'memory, AGENTS.md or config'],
    [WALL_NEXUS, wall(CODEX_WALL, '')],
    [WALL_PLAN, wall(CODEX_WALL, '  ')],
    // Codex gets no generated rule files (core/vault/generate.ts ruleTarget).
    ["it, and git doesn't ignore `.claude/rules/nexus/`.", 'it.'],
    ["never write `.claude/rules/nexus/`, the archive, the build's record or\n  this build's entries in the two logs: apply does all five.", "never write the archive, the build's record or\n  this build's entries in the two logs: apply does all four."],
  ]),
  antigravity: own('(offer `AGENTS.md` and any `.agents/rules/*.md`)', [
    ['memory, CLAUDE.md or settings', 'memory, AGENTS.md or `.agents/rules/`'],
    [WALL_NEXUS, wall(AGY_WALL, '')],
    [WALL_PLAN, wall(AGY_WALL, '  ')],
    ["git doesn't ignore `.claude/rules/nexus/`.", "git doesn't ignore `.agents/rules/`."],
    ['never write `.claude/rules/nexus/`,', 'never write `.agents/rules/nexus-*.md`,'],
    // Antigravity lists a plugin's skills without the plugin's name (seen in the 2026-11-21 pilot, AGY-009).
    ['`superpowers:', "Superpowers' `"],
  ]),
};

/** Whether a skill is for the user to start only (disable-model-invocation), in an LF or CRLF checkout. */
export function userOnly(text: string): boolean {
  return /^disable-model-invocation: true\r?$/m.test(text);
}

/** A skill's text for the harness: the table's substitutions, then the line saying how to read a relative path. */
export function rewriteSkill(text: string, harness: Harness): string {
  // The table and the frontmatter test are LF; a CRLF checkout reads the same.
  const lf = text.replace(/\r\n/g, '\n');
  let out = lf;
  for (const [from, to] of WORDING[harness]) out = out.split(from).join(to);
  if (out === lf || !out.includes('../../')) return out;
  const end = out.startsWith('---\n') ? out.indexOf('\n---\n', 4) : -1;
  const at = end === -1 ? 0 : end + 5;
  return `${out.slice(0, at)}${RESOLVE_LINE}\n${out.slice(at)}`;
}
