import { readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gitTry } from '../git.ts';
import { cachedText } from '../text-cache.ts';
import { readFrontmatter } from '../vault/frontmatter.ts';
import { attempt, factsError, fileFacts, fold, isInside, linkProblem } from './env.ts';
import { titleOf } from './instructions.ts';
import { mdFiles, pathsOf } from './rule-files.ts';
import { DEFAULT_INSTRUCTION_FILES, instructionFilesSetting, notLoaded, type InstructionFiles } from './settings.ts';
import type { Found, InventoryEnv, InventoryProblem } from './types.ts';

// Instruction files below the repo root, which Claude Code loads on demand when it works in their folder (its memory
// docs, checked 2026-10-10). Walked on a slower cycle than the root files' 2 s poll; see server/events.ts.

export const SUBFOLDER_LIMIT = 20000;
const SKIP_NAMES = new Set(['.git', 'node_modules', '.build', '.claude']);
const SKIP_PATHS = new Set(['docs/governance/archive', 'docs/superpowers/archive']);
const DOT_CLAUDE = join('.claude', 'CLAUDE.md');
const CLAUDE_FILES = ['CLAUDE.md', 'CLAUDE.local.md', DOT_CLAUDE];
const LEADS_OUT = 'a link leads out of the repo; not walked';

export const SUBFOLDER_NOTES = {
  claude: (folder: string): string => `loads when Claude Code reads, writes or edits a file in ${folder}/`,
  rules: (folder: string): string => `loads on demand when Claude Code works in ${folder}/ (Claude Code's docs don't name the trigger)`,
  scoped: 'loads when Claude Code reads a matching file',
  dotClaude: "Claude Code's docs don't say whether this loads",
  agentsShadowed: (folder: string): string => `Claude Code doesn't load it: ${folder}/ has a CLAUDE.md`,
  agentsBoth: (folder: string): string => `loads when Claude Code works in ${folder}/`,
} as const;

/**
 * `gitEnv` is laid over this process's environment for the walk's git calls (tests pass gitRepo()'s). `list` is
 * injectable so a folder that can't be listed can be tested without an unreadable folder.
 */
export interface SubfolderOptions { limit?: number; gitEnv?: Record<string, string | undefined>; setting?: InstructionFiles; list?: typeof readdirSync }

const NOT_SKIPPED = 'so nothing below the repo is skipped for being ignored';
/** One listing can name every ignored file in a large repo; past this the listing fails and is named. */
const LIST_BUFFER = 64 * 1024 * 1024;

/**
 * What git ignores below root, repo-relative with forward slashes (a wholly ignored folder is one entry ending in /,
 * with nothing listed inside it). Empty outside git. -z prints each path as it is, NUL-terminated, whatever
 * core.quotePath says, and the paths are only ever compared with what the walk itself lists. When git can't run, refuses
 * the repo (an unsafe owner, a broken config) or can't list, that is a problem and nothing is skipped for being ignored;
 * only git's own "not a git repository" is the ordinary outside-git case. The rules are this repo's alone: a nested
 * git repo or submodule is walked like any folder, its .git skipped by name and its own ignore rules not applied.
 */
function ignoredPaths(root: string, gitEnv: Record<string, string | undefined> | undefined, problems: InventoryProblem[]): Set<string> {
  // The C locale for the first call, so git's refusal reads the same in any language.
  const inside = gitTry(root, ['rev-parse', '--is-inside-work-tree'], { env: { LC_ALL: 'C', ...gitEnv } });
  if (!inside.ok) {
    if (!/not a git repository/i.test(inside.err)) {
      problems.push({ location: root, message: `git couldn't say whether this is a repository (${inside.err.split('\n')[0] ?? ''}), ${NOT_SKIPPED}` });
    }
    return new Set();
  }
  if (inside.out !== 'true') return new Set();
  const listed = gitTry(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { ...(gitEnv ? { env: gitEnv } : {}), raw: true, maxBuffer: LIST_BUFFER });
  if (!listed.ok) {
    problems.push({ location: root, message: `git couldn't list what it ignores (${listed.err.split('\n')[0] ?? ''}), ${NOT_SKIPPED}` });
    return new Set();
  }
  return new Set(listed.out.split('\0').filter((p) => p !== ''));
}

interface Folder { path: string; real: string }

export function subfolderItems(root: string, env: InventoryEnv, problems: InventoryProblem[], opts: SubfolderOptions = {}): Found[] {
  const limit = opts.limit ?? SUBFOLDER_LIMIT;
  const setting = opts.setting ?? DEFAULT_INSTRUCTION_FILES;
  const found: Found[] = [];
  const base = attempt(root, problems, () => realpathSync(root));
  if (base === null) return found;
  const ignored = ignoredPaths(root, opts.gitEnv, problems);
  const list = opts.list ?? readdirSync;
  const relOf = (p: string): string => relative(root, p).split(sep).join('/');
  /** Ignored itself, or inside a folder git ignores as a whole (which git lists as one entry, not file by file). */
  const isIgnored = (r: string, folder = false): boolean => {
    if (ignored.size === 0) return false;
    if (ignored.has(folder ? `${r}/` : r)) return true;
    for (let i = r.indexOf('/'); i !== -1; i = r.indexOf('/', i + 1)) if (ignored.has(r.slice(0, i + 1))) return true;
    return false;
  };
  // The real path of every folder queued, so a second path to one (a link, a loop back to the root) isn't walked again.
  const walkedReal = new Set<string>([fold(base, env.platform)]);

  const onDisk = (file: string, folder: string): boolean => {
    const facts = fileFacts(file, folder);
    return facts !== null && !('problem' in facts);
  };

  const addFile = (file: string, folder: string, conditional: string): void => {
    const facts = fileFacts(file, folder);
    if (facts === null) return;
    if ('problem' in facts) {
      problems.push({ location: file, message: facts.problem });
      return;
    }
    const text = attempt(file, problems, () => cachedText(file));
    if (text === null) return;
    found.push({ kind: 'instructions', title: titleOf(text, file), file, scope: 'on-demand', folder, conditional });
  };

  /** `names`: the folder's entries in lower case, so a folder holding none of these files costs no further file call. */
  const collect = (dir: string, names: Set<string>): void => {
    const r = relOf(dir);
    const dotClaude = names.has('.claude');
    const listed = (name: string): boolean => (name === DOT_CLAUDE ? dotClaude : names.has(name.toLowerCase()));
    for (const name of CLAUDE_FILES) {
      const file = join(dir, name);
      if (!listed(name) || (name !== 'CLAUDE.local.md' && isIgnored(relOf(file)))) continue;
      addFile(file, dir, name === DOT_CLAUDE ? SUBFOLDER_NOTES.dotClaude : SUBFOLDER_NOTES.claude(r));
    }
    const agents = join(dir, 'AGENTS.md');
    if (names.has('agents.md') && !isIgnored(relOf(agents))) {
      // On disk, ignored or not: Claude Code reads a CLAUDE.md git ignores. One behind a refused link doesn't count.
      const shadowed = (): boolean => CLAUDE_FILES.some((n) => listed(n) && onDisk(join(dir, n), dir));
      const note =
        setting === 'claude-md' || setting === 'managed-only'
          ? notLoaded(setting)
          : setting === 'claude-md-and-agents-md'
            ? SUBFOLDER_NOTES.agentsBoth(r)
            : shadowed()
              ? SUBFOLDER_NOTES.agentsShadowed(r)
              : SUBFOLDER_NOTES.claude(r);
      addFile(agents, dir, note);
    }
    const rulesDir = join(dir, '.claude', 'rules');
    if (!dotClaude || isIgnored(relOf(rulesDir), true)) return;
    // mdFiles keeps what it reads inside rulesDir; this keeps rulesDir itself (through a linked .claude or rules) in the repo.
    if (linkProblem(rulesDir, dir) === null) {
      let real: string | null = null;
      try {
        real = realpathSync(rulesDir);
      } catch {
        real = null; // nothing there
      }
      if (real !== null && !isInside(base, real, env.platform)) {
        problems.push({ location: rulesDir, message: LEADS_OUT });
        return;
      }
    }
    for (const file of mdFiles(rulesDir, rulesDir, problems, list, new Set(), dir)) {
      if (isIgnored(relOf(file))) continue;
      const facts = fileFacts(file, rulesDir);
      if (facts === null) continue;
      if ('problem' in facts) {
        problems.push({ location: file, message: facts.problem });
        continue;
      }
      const text = attempt(file, problems, () => cachedText(file));
      if (text === null) continue;
      const paths = pathsOf(readFrontmatter(text).data);
      found.push({
        kind: 'rule-file',
        title: titleOf(text, file),
        file,
        scope: paths.length > 0 ? 'path-scoped' : 'on-demand',
        folder: dir,
        conditional: paths.length > 0 ? SUBFOLDER_NOTES.scoped : SUBFOLDER_NOTES.rules(r),
        ...(paths.length > 0 ? { paths } : {}),
      });
    }
  };

  /** The folders directly inside `dir` worth walking, in name order; links judged before anything follows them. */
  const children = (dir: Folder, entries: Dirent[]): Folder[] => {
    const out: Folder[] = [];
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_NAMES.has(e.name)) continue;
      const p = join(dir.path, e.name);
      const r = relOf(p);
      if (SKIP_PATHS.has(r) || isIgnored(r, true)) continue;
      let real: string;
      if (e.isSymbolicLink()) {
        const refused = linkProblem(p, dir.path);
        if (refused !== null) {
          problems.push({ location: p, message: refused.problem });
          continue;
        }
        try {
          real = realpathSync(p);
          if (!statSync(real).isDirectory()) continue;
        } catch (err) {
          // A link to nothing is no folder; any other failure is named.
          const failed = factsError(err);
          if (failed !== null) problems.push({ location: p, message: failed.problem });
          continue;
        }
        if (!isInside(base, real, env.platform)) {
          problems.push({ location: p, message: LEADS_OUT });
          continue;
        }
        // A link is skipped for where it leads too, as that folder reached directly would be: in or under a skipped
        // name (`deps` → node_modules, `lib` → node_modules/lib), an archive, or a folder git ignores.
        const realRel = relative(base, real).split(sep).join('/');
        if (realRel.split('/').some((s) => SKIP_NAMES.has(s)) || [...SKIP_PATHS].some((s) => realRel === s || realRel.startsWith(`${s}/`)) || isIgnored(realRel, true)) continue;
      } else if (e.isDirectory()) {
        real = join(dir.real, e.name); // a real folder inside a folder whose real path is known
      } else continue;
      if (walkedReal.has(fold(real, env.platform))) continue; // already walked through another path: once is enough
      walkedReal.add(fold(real, env.platform));
      out.push({ path: p, real });
    }
    return out;
  };

  // Breadth first, so the cap keeps the shallowest folders, which Claude Code is likeliest to reach. The root (first in
  // the queue) is listed for its folders only: its own files are the other collectors'.
  const queue: Folder[] = [{ path: root, real: base }];
  let walked = 0;
  for (let i = 0; i < queue.length; i++) {
    const dir = queue[i];
    if (dir === undefined) break;
    if (i > 0) {
      if (walked >= limit) {
        problems.push({ location: root, message: `the walk below the repo stopped at ${limit} folders; instruction files deeper than that aren't listed` });
        break;
      }
      walked++;
    }
    const entries = attempt(dir.path, problems, () => list(dir.path, { withFileTypes: true }));
    if (entries === null) continue;
    if (i > 0) collect(dir.path, new Set(entries.map((e) => e.name.toLowerCase())));
    queue.push(...children(dir, entries));
  }
  return found;
}

/**
 * The walk with the setting read from the environment: what the server's cache and `governance list` use. Never
 * throws: a failure the walk didn't already turn into a problem becomes one at the repo root.
 */
export function walkSubfolders(root: string, env: InventoryEnv, opts: SubfolderOptions = {}): { found: Found[]; problems: InventoryProblem[] } {
  const problems: InventoryProblem[] = [];
  try {
    return { found: subfolderItems(root, env, problems, { setting: instructionFilesSetting(env).value, ...opts }), problems };
  } catch (err) {
    return { found: [], problems: [...problems, { location: root, message: `the walk below the repo failed: ${(err as Error).message}` }] };
  }
}
