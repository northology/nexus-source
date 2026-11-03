import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NexusError } from '../errors.ts';
import { readAnswers, readGate } from '../gates.ts';
import { dirtyPaths, git, gitTry, revParse } from '../git.ts';
import { currentHarness, type Harness } from '../harness.ts';
import { buildPath } from '../paths.ts';
import { readSnapshot } from '../snapshot.ts';
import { checkVault } from '../vault/check.ts';
import { applyGenerate, planGenerate, RULES_DIR } from '../vault/generate.ts';
import { applyUpgrade, planUpgrade } from '../vault/upgrade.ts';
import { archiveDocuments } from './archive.ts';
import { chosenDecisions, recordProblems, writeBuildRecord } from './build-record.ts';
import { BUILD_ATTRIBUTES, currentDecommissionGate, reportDraft, RULE_NOTES } from './paths.ts';
import { decommissionProblems } from './record.ts';
import { writeRecords } from './records.ts';

export interface ApplyOptions {
  standard: string;
  /** Passed to git, over this process's environment: the commit identity comes from here or git's config. */
  env?: Record<string, string | undefined>;
  /** Whose rule files generate writes and the commit takes; unset is the one this package was built for. */
  harness?: Harness;
}
export interface Applied { commit: string; /** The commit that put the build folder, gate answers included, into history first; null when it already was. */ record: string | null; /** The build's record in the vault: its final report. */ buildRecord: string; /** The build folder, when something held it open after the commit and it was left for `git clean -fd`. */ left?: string; archived: string[]; decisions: number; issues: number; generated: string[]; upgraded: string[] }

/**
 * What the answered gate and the agent's writing still lack, one sentence each: the gate's rows are exactly the build's
 * accepted guardrails, each accepted row has its rule note, and the final report is drafted, with the decisions of
 * note and (in a repo that lists them) the components it touched. A build with no accepted guardrail has an approve
 * gate instead, on the report alone.
 */
export function gateProblems(root: string, build: string): string[] {
  const out: string[] = [];
  const snap = readSnapshot(root, build, { progress: false });
  const gate = currentDecommissionGate(snap.gates.map((g) => g.name), build);
  const request = readGate(root, build, gate);
  const rows = (request.items ?? []).map((i) => i.name).sort();
  const accepted = snap.guardrails.filter((g) => g.state === 'accepted').map((g) => g.entry.name).sort();
  if (request.type === 'approve' && accepted.length) {
    out.push(`the build has accepted guardrails (${accepted.join(', ')}): its decommission gate is a mark-list with a row for each`);
  } else if (request.type !== 'approve' && rows.join('\n') !== accepted.join('\n')) {
    out.push(`${gate}'s rows (${rows.join(', ') || 'none'}) aren't the build's accepted guardrails (${accepted.join(', ') || 'none'}): the user decides on every one`);
  }
  const marks = readAnswers(root, build, gate).marks ?? {};
  for (const row of rows) {
    if (Object.hasOwn(marks, row) && marks[row] === 'accepted' && !existsSync(join(root, RULE_NOTES, `${row}.md`))) {
      out.push(`${row} was accepted, but ${RULE_NOTES}/${row}.md doesn't exist: write its rule note`);
    }
  }
  if (!existsSync(buildPath(root, build, ...reportDraft(build).split('/')))) {
    out.push(`the build has no final report: write .build/${build}/${reportDraft(build)}`);
  }
  out.push(...recordProblems(root, build));
  return out;
}

const stopped = (lines: string[]): NexusError => new NexusError(['decommission apply stopped before changing anything:', ...lines.map((l) => `- ${l}`)].join('\n'));

/**
 * Decommissions a finished build on the current branch. First the build folder is committed as it stands (the record
 * commit), so the gate's answers and the whole record stay in git history. Then one commit takes its documents into
 * the archive, its decisions and open issues into the repo's logs, the vault upgrade, the generated rule files and
 * hubs, and the removal of .build/<build>/. A failure leaves the build folder and commits no change to the vault;
 * what it wrote stays in the working tree to fix and run again.
 */
export function applyDecommission(root: string, build: string, opts: ApplyOptions): Applied {
  const at = resolve(root);
  const harness = opts.harness ?? currentHarness();
  const problems = decommissionProblems(at, build, 'apply', harness);
  if (!problems.length) problems.push(...gateProblems(at, build));
  if (problems.length) throw stopped(problems);
  // Literal pathspecs: a note named "notes [draft].md" stages that file, never a glob's matches.
  const env = { ...(opts.env ?? {}), GIT_LITERAL_PATHSPECS: '1' };
  const buildDir = `.build/${build}`;
  let doing = 'archiving the documents';
  let staged = false;
  let done: Applied;
  let record: string | null = null;
  // Nothing in .build/ but this build and its .gitattributes: the decommission removes the folder too.
  const lastBuild = readdirSync(join(at, '.build')).every((name) => name === build || name === '.gitattributes');
  const dirty = dirtyPaths(at, []);
  if (dirty.some((p) => p.startsWith(`${buildDir}/`) || p === BUILD_ATTRIBUTES)) {
    const paths = [buildDir, ...(dirty.includes(BUILD_ATTRIBUTES) ? [BUILD_ATTRIBUTES] : [])];
    git(at, ['add', '-A', '--', ...paths], { env });
    git(at, ['commit', '-q', '-m', `Record ${build} before decommission`, '--', ...paths], { env });
    record = revParse(at, 'HEAD');
  }
  try {
    const archived = archiveDocuments(at, build);
    doing = "writing the build's record";
    const buildRecord = writeBuildRecord(at, build, archived);
    doing = 'writing the decision and issue logs';
    const records = writeRecords(at, build, chosenDecisions(at, build));
    doing = 'upgrading the vault';
    const up = planUpgrade(at, opts.standard);
    if (up.problems.length) throw new NexusError(up.problems.join('; '));
    applyUpgrade(at, up);
    doing = 'generating rule files and hubs';
    const gen = planGenerate(at, harness);
    applyGenerate(at, gen);
    doing = 'checking the vault';
    const blocks = checkVault(at).findings.filter((f) => f.level === 'block');
    if (blocks.length) throw new NexusError(blocks.map((f) => `${f.file}${f.line === undefined ? '' : `:${f.line}`}: ${f.message} (${f.rule})`).join('; '));
    doing = 'committing';
    staged = true;
    // Claude Code's rule folder as before; elsewhere exactly the rule paths generate touched (Antigravity's nexus- files,
    // Codex's AGENTS.md), so a user's own rule files in a shared folder stay out of the commit.
    const rules = harness === 'claude-code'
      ? (existsSync(join(at, RULES_DIR)) ? [RULES_DIR] : [])
      : [...gen.writes, ...gen.removes].filter((p) => !p.startsWith('docs/'));
    git(at, ['add', '-A', '--', 'docs', ...rules], { env });
    // Out of the index only: the folder itself goes once the commit exists.
    git(at, ['rm', '-r', '-q', '-f', '--cached', '--', buildDir], { env });
    // The last build takes .build/.gitattributes with it, so no empty .build/ is left behind.
    if (lastBuild) git(at, ['rm', '-q', '-f', '--cached', '--ignore-unmatch', '--', BUILD_ATTRIBUTES], { env });
    git(at, ['commit', '-q', '-m', `Decommission ${build}`], { env });
    done = { commit: revParse(at, 'HEAD') ?? '', record, buildRecord, archived, ...records, generated: [...gen.writes, ...gen.removes], upgraded: [...up.adds.map((a) => a.path), ...(up.contract ? ['docs/_meta/contract.md'] : [])] };
  } catch (e) {
    if (staged) gitTry(at, ['reset', '-q'], { env });
    throw new NexusError(`decommission apply stopped while ${doing} (${(e as Error).message}). The decommission wasn't committed and ${buildDir}/ is in place: fix it and run apply again, or discard the changes under docs/ with git.`);
  }
  // The commit holds the removal; a folder something still holds open is left for the next `git clean`.
  try {
    rmSync(join(at, buildDir), { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  } catch {
    return { ...done, left: buildDir };
  }
  // The commit also removed .build/.gitattributes: the folder it leaves goes too, if nothing else has appeared in it.
  if (lastBuild) {
    try {
      rmSync(join(at, BUILD_ATTRIBUTES), { force: true });
      if (readdirSync(join(at, '.build')).length === 0) rmSync(join(at, '.build'), { recursive: true, force: true });
    } catch {
      // left for the next `git clean`
    }
  }
  return done;
}
