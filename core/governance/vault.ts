import { readdirSync, type readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cachedRead } from '../text-cache.ts';
import { readFrontmatter } from '../vault/frontmatter.ts';
import { isVault, META } from '../vault/registry.ts';
import { attempt, fileFacts, linkProblem } from './env.ts';
import { titleOf } from './instructions.ts';
import { mdFiles, pathsOf } from './rule-files.ts';
import type { Found, InventoryProblem, ItemKind } from './types.ts';

const KINDS: { folder: string; kind: ItemKind; statuses: string[] }[] = [
  { folder: 'decisions', kind: 'decision', statuses: ['accepted'] },
  { folder: 'rules', kind: 'rule', statuses: ['active'] },
  { folder: 'issues', kind: 'issue', statuses: ['open', 'deferred'] },
];

/** Live decisions, active rules and open or deferred issues. The archive is not standing and isn't listed. An unreadable note is a problem, not a throw. */
export function vaultItems(root: string, problems: InventoryProblem[] = [], read: typeof readFileSync = cachedRead): { vault: boolean; found: Found[] } {
  const docs = join(root, 'docs');
  // docs/ (or its _meta/) as a network or device link is named, not followed.
  const refused = linkProblem(join(docs, META, 'classes'), root);
  if (refused !== null) {
    problems.push({ location: docs, message: refused.problem });
    return { vault: false, found: [] };
  }
  if (!isVault(docs)) return { vault: false, found: [] };
  const found: Found[] = [];
  for (const k of KINDS) {
    const folder = join(docs, 'governance', k.folder);
    for (const file of mdFiles(folder, folder, problems, readdirSync, new Set(), root)) {
      const facts = fileFacts(file, folder);
      if (facts !== null && 'problem' in facts) {
        problems.push({ location: file, message: facts.problem });
        continue;
      }
      const text = attempt(file, problems, () => read(file, 'utf8'));
      if (text === null) continue;
      const fm = readFrontmatter(text).data;
      const status = fm?.['status'];
      if (typeof status !== 'string' || !k.statuses.includes(status)) continue;
      const paths = k.kind === 'rule' && fm?.['tier'] === 'scoped' ? pathsOf(fm) : [];
      const scope = k.kind !== 'rule' ? 'on-demand' : paths.length > 0 ? 'path-scoped' : 'always';
      found.push({ kind: k.kind, title: titleOf(text, file), file, scope, ...(paths.length > 0 ? { paths } : {}) });
    }
  }
  return { vault: true, found };
}
