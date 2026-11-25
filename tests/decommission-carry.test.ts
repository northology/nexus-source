import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { applyDecommission } from '../core/decommission/apply.ts';
import { CARRY_LIMIT } from '../core/decommission/carry.ts';
import { buildRecordPath } from '../core/decommission/paths.ts';
import { git } from '../core/git.ts';
import { readFrontmatter } from '../core/vault/frontmatter.ts';
import { withMarker } from '../core/vault/generated.ts';
import { BUILD, prepareTemplate, put, readyToApply, ruleNote } from './decommission-helpers.ts';
import { STANDARD } from './vault-helpers.ts';

beforeAll(() => {
  prepareTemplate();
});
afterEach(() => vi.unstubAllEnvs());

const CARRIED = `docs/superpowers/archive/${BUILD}/_carried`;
const BOTH = { 'explicit-commits': 'accepted', 'no-network': 'declined' } as const;
const PLAN = `.build/${BUILD}/documents/plans/phase-one/proof-board-plan.md`;
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf8');
const apply = (root: string, env: Record<string, string>) => applyDecommission(root, BUILD, { standard: STANDARD, env });

/** A finished build whose repo ignores its scratch folders, with a handoff in .scratch/ and two run workspaces. */
function withScratch() {
  const f = readyToApply(BOTH);
  put(f.root, { '.gitignore': '.scratch/\n.superpowers/\ndist/\n*.env\n' });
  git(f.root, ['add', '.gitignore'], { env: f.env });
  git(f.root, ['commit', '-q', '-m', 'ignore scratch'], { env: f.env });
  put(f.root, {
    [`.build/${BUILD}/notes/phase-one-handoff.md`]: '# Phase one handoff\n',
    '.scratch/phase-two-handoff.md': '# Handoff to phase two\n\nStart from the relay.\n',
    '.scratch/notes/session.txt': 'what the last session found\n',
    '.superpowers/sdd/.gitignore': '*\n',
    '.superpowers/sdd/2026-11-01-proof-board-plan/progress.md': `# SDD ledger — plan: ${PLAN}\n\nTask 1: complete (commits aaaa111..bbbb222)\n`,
    '.superpowers/sdd/2026-11-01-proof-board-plan/review-1.diff': 'diff --git a/x b/x\n',
    '.superpowers/sdd/2026-11-01-other-plan/progress.md': '# SDD ledger — plan: .build/elsewhere/documents/plans/p/other.md\n',
  });
  return f;
}

describe("decommission carries the build's notes, the scratch handoffs and its run workspaces into the archive", () => {
  it('lands them in the Decommission commit, links them from the record, and removes the sources', () => {
    const { root, env } = withScratch();
    const a = apply(root, env);
    expect(a.carried).toEqual([
      `${CARRIED}/notes/phase-one-handoff.md`,
      `${CARRIED}/scratch/notes/session.txt`,
      `${CARRIED}/scratch/phase-two-handoff.md`,
      `${CARRIED}/superpowers/2026-11-01-proof-board-plan/progress.md`,
      `${CARRIED}/superpowers/2026-11-01-proof-board-plan/review-1.diff`,
    ]);
    expect(a.skipped).toEqual([]);
    const committed = git(root, ['show', '--name-only', '--format=', 'HEAD']).split('\n');
    for (const p of a.carried) expect(committed).toContain(p);
    expect(git(root, ['status', '--porcelain'])).toBe('');
    // A carried note is a report of the build; its text stays as written.
    const note = read(root, `${CARRIED}/scratch/phase-two-handoff.md`);
    expect(readFrontmatter(note).data).toMatchObject({ class: 'report', build: BUILD, component: 'shared' });
    expect(note).toContain('# Handoff to phase two\n\nStart from the relay.\n');
    expect(read(root, `${CARRIED}/superpowers/2026-11-01-proof-board-plan/review-1.diff`)).toBe('diff --git a/x b/x\n');
    expect(read(root, buildRecordPath(BUILD))).toContain(`## Carried\n\n- [[superpowers/archive/${BUILD}/_carried/notes/phase-one-handoff]]\n- [[superpowers/archive/${BUILD}/_carried/scratch/notes/session.txt]]`);
    // The sources go once the commit exists; another build's workspace and the folder's own ignore file stay.
    expect(existsSync(join(root, '.scratch/phase-two-handoff.md'))).toBe(false);
    expect(existsSync(join(root, '.scratch/notes'))).toBe(false);
    expect(existsSync(join(root, '.superpowers/sdd/2026-11-01-proof-board-plan'))).toBe(false);
    expect(existsSync(join(root, '.superpowers/sdd/2026-11-01-other-plan/progress.md'))).toBe(true);
    expect(existsSync(join(root, '.superpowers/sdd/.gitignore'))).toBe(true);
  });

  it("keeps a note's own frontmatter in its text, and carries a JavaScript query note as plain text", () => {
    const { root, env } = withScratch();
    put(root, {
      '.scratch/tagged.md': '---\ntags: [unregistered]\nowner: me\n---\n# Tagged\n',
      '.scratch/query.md': '# Query\n\n```dataviewjs\ndv.list([1])\n```\n',
    });
    const a = apply(root, env);
    const tagged = read(root, `${CARRIED}/scratch/tagged.md`);
    expect(readFrontmatter(tagged).data).toEqual({ class: 'report', component: 'shared', build: BUILD });
    expect(tagged).toContain('```yaml\ntags: [unregistered]\nowner: me\n```\n# Tagged\n');
    expect(a.carried).toContain(`${CARRIED}/scratch/query.md.txt`);
    expect(read(root, `${CARRIED}/scratch/query.md.txt`)).toBe('# Query\n\n```dataviewjs\ndv.list([1])\n```\n');
  });

  it('carries as plain text a note the vault would block: one in an assets folder, or a copy of a generated file', () => {
    const { root, env } = withScratch();
    const generated = withMarker('# Hub\n\n- a line\n', 'docs/_meta/components.md');
    put(root, { '.scratch/assets/shot-notes.md': '# Shots\n', '.scratch/old-rule.md': generated });
    const a = apply(root, env);
    expect(a.carried).toEqual(expect.arrayContaining([`${CARRIED}/scratch/assets/shot-notes.md.txt`, `${CARRIED}/scratch/old-rule.md.txt`]));
    expect(read(root, `${CARRIED}/scratch/old-rule.md.txt`)).toBe(generated);
  });

  it('leaves a file git would still ignore, or one over the size limit, where it is and names it', () => {
    const { root, env } = withScratch();
    put(root, {
      '.scratch/dist/bundle.js': 'built\n',
      '.scratch/keys.env': 'TOKEN=x\n',
      '.scratch/big.log': 'x'.repeat(CARRY_LIMIT + 1),
    });
    const a = apply(root, env);
    expect(a.skipped).toEqual([
      { path: '.scratch/big.log', why: 'over 5 MB' },
      { path: '.scratch/dist/bundle.js', why: 'git ignores it' },
      { path: '.scratch/keys.env', why: 'git ignores it' },
    ]);
    expect(read(root, '.scratch/keys.env')).toBe('TOKEN=x\n');
    expect(existsSync(join(root, '.scratch/dist/bundle.js'))).toBe(true);
    expect(git(root, ['ls-files', 'docs']).split('\n').some((p) => p.includes('keys.env') || p.includes('bundle.js'))).toBe(false);
  });

  it('keeps every source when the apply stops, and carries them on the next run', () => {
    const { root, env } = withScratch();
    put(root, { 'docs/governance/rules/explicit-commits.md': '---\nclass: rule\nstatus: active\n---\n# No tier\n' });
    expect(() => apply(root, env)).toThrow(/The decommission wasn't committed/);
    expect(read(root, '.scratch/phase-two-handoff.md')).toContain('# Handoff to phase two');
    expect(existsSync(join(root, '.superpowers/sdd/2026-11-01-proof-board-plan/review-1.diff'))).toBe(true);
    put(root, { 'docs/governance/rules/explicit-commits.md': ruleNote('Rule explicit-commits') });
    expect(apply(root, env).carried).toHaveLength(5);
    expect(existsSync(join(root, '.scratch/phase-two-handoff.md'))).toBe(false);
  });

  it('carries nothing, and changes nothing, when there is no scratch folder or workspace', () => {
    const { root, env } = readyToApply(BOTH);
    rmSync(join(root, '.scratch'), { recursive: true, force: true });
    const a = apply(root, env);
    expect(a.carried).toEqual([]);
    expect(read(root, buildRecordPath(BUILD))).not.toContain('## Carried');
  });
});
