import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { readBuild } from '../build.ts';
import { NexusError } from '../errors.ts';
import { currentHarness, skillCommand, type Harness } from '../harness.ts';
import { dirtyPaths, fileAddedCommit, git, gitTry, insideGit, revParse } from '../git.ts';
import { activeBuilds, finishApproved } from '../lifecycle.ts';
import { currentPhase } from '../phases.ts';
import { readAnswers, readGate } from '../gates.ts';
import { AGENTS_FILE, isGeneratedRule, ruleTarget } from '../vault/generate.ts';
import { isVault, readRegistry } from '../vault/registry.ts';
import { CONTRACT_VERSION } from '../vault/types.ts';
import type { Build } from '../types.ts';
import { BUILD_ATTRIBUTES, currentDecommissionGate, isDecommissionGate } from './paths.ts';

export interface BuildCommits { base: string; final: string }
export type DecommissionStage = 'check' | 'apply';

/**
 * The commits the build spans, which build.json doesn't store: the base is the parent of the commit that added
 * build.json, and the final commit is the one checked out. Throws, naming what is missing.
 */
export function buildCommits(root: string, build: string): BuildCommits {
  const added = fileAddedCommit(root, `.build/${build}/build.json`);
  if (!added) throw new NexusError(`.build/${build}/build.json was never committed, so the build's first commit can't be found`);
  const base = revParse(root, `${added}^`);
  if (!base) throw new NexusError(`the commit that started build "${build}" (${added.slice(0, 7)}) has no parent, so there is nothing to compare the build with`);
  const final = revParse(root, 'HEAD');
  if (!final) throw new NexusError("this checkout has no commit, so the build's last commit can't be found");
  return { base, final };
}

/** The lines `nexus decommission check` prints: what the build changed is the difference between the two. */
export function commitLines(c: BuildCommits): string[] {
  return [`  base   ${c.base}`, `  final  ${c.final}`];
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let r = resolve(p);
    try { r = realpathSync.native(r); } catch { /* compare as given */ }
    r = r.split(sep).join('/').replace(/[/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/** Every decommission asks the user: its latest round is open, answered, applied and, for an approve gate, approved. */
function gateState(root: string, build: string, b: Build, gate: string): string[] {
  if (!b.gates[gate]) return [`${gate} isn't open yet: open it with the final report attached (${skillCommand('decommission')} step 3), and the user answers it in the cockpit`];
  if (!b.gates[gate].read) return [`${gate} isn't applied yet: the user answers it in the cockpit, then run \`nexus gate apply ${gate}\``];
  if (readGate(root, build, gate).type !== 'approve' || readAnswers(root, build, gate).decision === 'approve') return [];
  const round = /^-(\d+)$/.exec(gate.slice(`decommission-${build}`.length))?.[1];
  return [`${gate} was sent back: revise the final report as its note says, then open decommission-${build}-${round ? Number(round) + 1 : 2}`];
}

/**
 * Why a build can't be decommissioned yet, one sentence each; empty when it can. At check the tree is clean outside
 * the build folder. At apply the gate's latest round is applied (every decommission asks), and the only other changes
 * are the notes the agent wrote for it, in docs/ and the generated rules folder. At both, the build folder holds no file
 * git ignores, and git doesn't ignore the folder the generated rule files go in.
 */
/** `harness` decides where the generated rules land (unset: the one this package was built for). */
export function decommissionProblems(root: string, build: string, stage: DecommissionStage, harness: Harness = currentHarness()): string[] {
  let b: Build;
  try {
    b = readBuild(root, build);
  } catch (e) {
    return [(e as Error).message];
  }
  const problems: string[] = [];
  if (b.stage !== 'close-out' || !finishApproved(root, build)) {
    problems.push(`build "${build}" isn't finished: its last phase (${currentPhase(b)}) must be in close-out, with its finish gate approved`);
  }
  const others = activeBuilds(root).filter((n) => n !== build);
  if (others.length) problems.push(`another build is still active here (${others.join(', ')}): decommission a build once no other is running`);
  const gate = currentDecommissionGate(Object.keys(b.gates), build);
  const unapplied = Object.entries(b.gates).filter(([n, g]) => !isDecommissionGate(n, build) && g.read === null).map(([n]) => n);
  if (unapplied.length) problems.push(`gates not applied yet: ${unapplied.join(', ')} (run \`nexus gate apply\` once the user answers each)`);
  if (stage === 'apply') problems.push(...gateState(root, build, b, gate));
  const docs = join(root, 'docs');
  if (!isVault(docs)) problems.push('this repo has no docs/ vault (docs/_meta/classes/): set one up with `nexus init`');
  else {
    const { contract } = readRegistry(docs).registry;
    if (contract === null) problems.push("the vault's docs/_meta/contract.md is missing or unreadable: it names the contract the vault follows, and decommission needs one this nexus supports");
    else if (contract > CONTRACT_VERSION) problems.push(`the vault follows contract ${contract}; this nexus supports ${CONTRACT_VERSION}. Update nexus.`);
  }
  if (!insideGit(root)) return [...problems, "this folder isn't a git repository; decommission lands its changes as one commit"];
  const top = gitTry(root, ['rev-parse', '--show-toplevel']);
  if (top.ok && !samePath(top.out, root)) return [...problems, `this folder isn't the repository root; decommission runs from ${top.out}`];
  // Where generate writes this harness's rules. Codex's go into AGENTS.md, which must be clean so only nexus's change lands.
  const target = ruleTarget(harness);
  const rules = target === null ? null : target.prefix ? `${target.dir}/${target.prefix}*.md` : `${target.dir}/`;
  const mine = [`.build/${build}/`, BUILD_ATTRIBUTES, ...(stage === 'apply' ? ['docs/'] : [])];
  const dirty = dirtyPaths(root, mine).filter((p) => !(stage === 'apply' && isGeneratedRule(harness, p))).sort();
  if (dirty.length) {
    problems.push(stage === 'check'
      ? `uncommitted changes outside .build/${build}/: ${dirty.join(', ')} (commit or move them first)`
      : rules === null
        ? `uncommitted changes outside docs/ and .build/${build}/: ${dirty.join(', ')} (commit or move them first: the decommission commit takes only those, and ${AGENTS_FILE}'s nexus rules section)`
        : `uncommitted changes outside docs/, ${rules} and .build/${build}/: ${dirty.join(', ')} (commit or move them first: the decommission commit takes only those three)`);
  }
  // The build folder goes in full at apply, and git status never shows an ignored file: nothing would bring one back.
  const ignored = git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', `.build/${build}`], { env: { GIT_LITERAL_PATHSPECS: '1' } })
    .split('\0').filter(Boolean).sort();
  if (ignored.length) {
    problems.push(`git ignores these files in the build folder, so decommission would delete them for good: ${ignored.join(', ')}; move them out of the build folder, or stop ignoring them`);
  }
  // git add refuses a new file under an ignored folder, and apply adds the generated rule files there.
  const written = target === null ? AGENTS_FILE : `${target.dir}/`;
  if (gitTry(root, ['check-ignore', '-q', '--', written]).ok) {
    problems.push(`git ignores ${written}, where decommission writes the generated rule files; stop ignoring it first`);
  }
  try {
    buildCommits(root, build);
  } catch (e) {
    problems.push((e as Error).message);
  }
  return problems;
}
