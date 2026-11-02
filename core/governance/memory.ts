import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { cachedText } from '../text-cache.ts';
import { readFrontmatter } from '../vault/frontmatter.ts';
import { attempt, fileFacts, foldersAbove, linkProblem, memoryKey } from './env.ts';
import { titleOf } from './instructions.ts';
import { readSettingsObject } from './settings.ts';
import type { Found, InventoryEnv, InventoryProblem } from './types.ts';

/**
 * autoMemoryDirectory, from any settings scope in Claude Code's precedence order: managed, local, project, user.
 * The first valid value (absolute or ~/) wins; anything else is skipped.
 */
function relocated(root: string, env: InventoryEnv): string | null {
  const scopes: [string, string][] = [
    [join(env.managedDir, 'managed-settings.json'), env.managedDir],
    [join(root, '.claude', 'settings.local.json'), root],
    [join(root, '.claude', 'settings.json'), root],
    [join(env.configDir, 'settings.json'), env.configDir],
  ];
  for (const [file, base] of scopes) {
    const v = readSettingsObject(file, base)?.['autoMemoryDirectory'];
    if (typeof v !== 'string' || v.trim() === '') continue;
    if (v.startsWith('~/')) return join(env.home, v.slice(2));
    if (isAbsolute(v)) return resolve(v);
  }
  return null;
}

/**
 * `base`: the trusted folder the memory folder sits in, where its link walk starts; null for a folder a setting names,
 * whose text is judged first (a network or device path is named, never touched).
 */
function collect(dir: string, base: string | null, extra: Partial<Found>, found: Found[], problems: InventoryProblem[]): void {
  const refused = linkProblem(dir, base);
  if (refused !== null) {
    problems.push({ location: dir, message: refused.problem });
    return;
  }
  if (!existsSync(dir)) return;
  const entries = attempt(dir, problems, () => readdirSync(dir, { withFileTypes: true }));
  if (entries === null) return;
  const files = entries.filter((e) => !e.isDirectory() && e.name.toLowerCase().endsWith('.md')).map((e) => e.name);
  // MEMORY.md first: it's the index that loads at the start of every session.
  files.sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b)));
  for (const name of files) {
    const file = join(dir, name);
    const facts = fileFacts(file, dir);
    if (facts === null) continue;
    if ('problem' in facts) {
      problems.push({ location: file, message: facts.problem });
      continue;
    }
    const text = attempt(file, problems, () => cachedText(file));
    if (text === null) continue;
    const named = readFrontmatter(text).data?.['name'];
    const index = name === 'MEMORY.md';
    found.push({
      kind: 'memory',
      title: index ? 'MEMORY.md' : typeof named === 'string' && named.trim() !== '' ? named.trim() : titleOf(text, file),
      file,
      scope: index ? 'always' : 'on-demand',
      ...extra,
    });
  }
}

/** A git file's text (.git in a worktree, commondir), when its links pass the check from `base`; else null. */
function gitText(file: string, base: string | null): string | null {
  if (linkProblem(file, base) !== null) return null;
  try {
    return cachedText(file);
  } catch {
    return null;
  }
}

/**
 * The folder Claude Code keys a repo's memory by. Its docs: "The <project> path is derived from the git repository, so
 * all worktrees and subdirectories within the same repo share one auto memory directory." So the nearest folder at or
 * above root holding .git; when that .git is a file (a worktree), its `gitdir:` and that folder's `commondir` lead to the
 * shared .git, whose folder is the main checkout. Only those two small files are read (no git process); a gitdir that
 * names a network or device path is never touched. With no .git found (or a worktree that can't be followed), root.
 */
export function memoryProject(root: string, env: InventoryEnv): string {
  for (const dir of [resolve(root), ...foldersAbove(root, env.ceiling, env.platform)]) {
    const dotGit = join(dir, '.git');
    if (linkProblem(dotGit, dir) !== null) return resolve(root);
    let isFile: boolean;
    try {
      const st = statSync(dotGit, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) return dir;
      isFile = st.isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    const named = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(gitText(dotGit, dir) ?? '')?.[1];
    if (named === undefined) return dir;
    const gitdir = resolve(dir, named);
    const common = gitText(join(gitdir, 'commondir'), isAbsolute(named) ? null : dir)?.trim();
    if (!common) return dir;
    const shared = resolve(gitdir, common);
    return basename(shared).toLowerCase() === '.git' ? dirname(shared) : dir;
  }
  return resolve(root);
}

/** Claude Code's auto memory for the repo root (or its autoMemoryDirectory) and for each folder above. */
export function memoryItems(root: string, env: InventoryEnv, problems: InventoryProblem[]): Found[] {
  const found: Found[] = [];
  const moved = relocated(root, env);
  if (moved !== null) collect(moved, null, {}, found, problems);
  else collect(join(env.configDir, 'projects', env.projectDirName ?? memoryKey(memoryProject(root, env)), 'memory'), env.configDir, {}, found, problems);
  for (const dir of foldersAbove(root, env.ceiling, env.platform)) collect(join(env.configDir, 'projects', memoryKey(dir), 'memory'), env.configDir, { launchedFrom: dir }, found, problems);
  return found;
}
