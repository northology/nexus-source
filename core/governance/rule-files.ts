import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { cachedText } from '../text-cache.ts';
import { readFrontmatter } from '../vault/frontmatter.ts';
import { readMarker } from '../vault/generated.ts';
import { attempt, fileFacts, fold, foldersAbove, isInside, linkProblem } from './env.ts';
import { titleOf } from './instructions.ts';
import type { Found, InventoryEnv, InventoryProblem } from './types.ts';

/** A rule file's paths: frontmatter, as a list or a comma-separated string. */
export function pathsOf(data: Record<string, unknown> | null): string[] {
  const p = data?.['paths'];
  if (Array.isArray(p)) return p.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  if (typeof p === 'string') return p.split(',').map((v) => v.trim()).filter((v) => v !== '');
  return [];
}

/**
 * Every .md under `dir`, in name order. A folder that can't be listed is a problem for that folder alone; a linked
 * folder is followed when its real path stays inside `within`, and refused (named) when it leads out. Links are checked
 * before anything follows them (linkProblem): `dir`'s own, walked from `guard` (the trusted folder it sits in), and each
 * entry's. `list` is injectable so a read failure can be tested without an unreadable folder.
 */
export function mdFiles(dir: string, within: string, problems: InventoryProblem[], list: typeof readdirSync = readdirSync, ancestors: Set<string> = new Set(), guard: string = within): string[] {
  const refused = linkProblem(dir, guard);
  if (refused !== null) {
    problems.push({ location: dir, message: refused.problem });
    return [];
  }
  if (!existsSync(dir)) return [];
  const real = attempt(dir, problems, () => realpathSync(dir));
  if (real === null || ancestors.has(fold(real))) return [];
  ancestors.add(fold(real));
  const entries = attempt(dir, problems, () => list(dir, { withFileTypes: true }));
  if (entries === null) {
    ancestors.delete(fold(real));
    return [];
  }
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      const refusedLink = linkProblem(p, dir);
      if (refusedLink !== null) {
        problems.push({ location: p, message: refusedLink.problem });
        continue;
      }
      const target = attempt(p, problems, () => {
        const r = realpathSync(p);
        return statSync(r).isDirectory() ? r : null;
      });
      if (target !== null) {
        const base = attempt(within, problems, () => realpathSync(within));
        if (base === null) continue;
        if (!isInside(base, target)) {
          problems.push({ location: p, message: 'a link leads out of its folder; not read' });
          continue;
        }
        if (ancestors.has(fold(target))) {
          problems.push({ location: p, message: 'a link loops back into its own folder; not followed' });
          continue;
        }
        isDir = true;
      }
    }
    if (isDir) out.push(...mdFiles(p, within, problems, list, ancestors, dir));
    else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  ancestors.delete(fold(real));
  return out;
}

/** `base`: the trusted folder rulesDir sits in (the repo, the config folder, a folder above), where its link walk starts. */
function collect(rulesDir: string, base: string, extra: Partial<Found>, found: Found[], problems: InventoryProblem[]): void {
  const nexusDir = fold(join(rulesDir, 'nexus')) + sep;
  for (const file of mdFiles(rulesDir, rulesDir, problems, readdirSync, new Set(), base)) {
    const facts = fileFacts(file, rulesDir);
    if (facts === null) continue;
    if ('problem' in facts) {
      problems.push({ location: file, message: facts.problem });
      continue;
    }
    const text = attempt(file, problems, () => cachedText(file));
    if (text === null) continue;
    const paths = pathsOf(readFrontmatter(text).data);
    const scope = paths.length > 0 ? ('path-scoped' as const) : ('always' as const);
    const marker = fold(file).startsWith(nexusDir) ? readMarker(text) : null;
    found.push({
      kind: marker ? 'generated' : 'rule-file',
      title: titleOf(text, file),
      file,
      scope,
      ...(paths.length > 0 ? { paths } : {}),
      ...(marker ? { source: marker.source } : {}),
      ...extra,
    });
  }
}

/** Rule files: the repo's .claude/rules/ (generated ones included), the user's, then each folder above's. */
export function ruleFileItems(root: string, env: InventoryEnv, problems: InventoryProblem[]): Found[] {
  const found: Found[] = [];
  collect(join(root, '.claude', 'rules'), root, {}, found, problems);
  collect(join(env.configDir, 'rules'), env.configDir, {}, found, problems);
  for (const dir of foldersAbove(root, env.ceiling, env.platform)) collect(join(dir, '.claude', 'rules'), dir, { launchedFrom: dir }, found, problems);
  return found;
}
