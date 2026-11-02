import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitTry, insideGit } from '../git.ts';
import { noteClass, type Note } from './rules.ts';
import { finding, type Finding, type Registry } from './types.ts';

export type CommitTime = (root: string, path: string) => number | null;

/** The last commit time of a path, in seconds; null when it has none or git can't say (a path outside the repo). */
export const gitCommitTime: CommitTime = (root, path) => {
  const r = gitTry(root, ['log', '-1', '--format=%ct', '--', path]);
  return r.ok && r.out ? Number(r.out) : null;
};

/** Thing notes whose source (a path in the repo) was committed after the note was. Read-only git. */
export function staleFindings(root: string, notes: Note[], reg: Registry, time: CommitTime = gitCommitTime): { findings: Finding[]; notice: string | null } {
  if (!insideGit(root)) return { findings: [], notice: '--stale needs a git repository; no stale checks ran' };
  const out: Finding[] = [];
  for (const n of notes) {
    const source = n.fm.data?.['source'];
    if (!noteClass(n, reg)?.thing || typeof source !== 'string' || !existsSync(join(root, source))) continue;
    const code = time(root, source);
    const written = time(root, n.file);
    if (code !== null && written !== null && code > written) {
      out.push(finding('stale-source', 'warn', n.file, `${source} changed after this note was last committed; check the note still matches`, n.fm.keyLines.get('source')));
    }
  }
  return { findings: out, notice: null };
}
