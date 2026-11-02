import { vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createBuild } from '../core/build.ts';
import { decommissionGateName, reportDraft } from '../core/decommission/paths.ts';
import { applyAnswers, openGate, submitAnswers } from '../core/gates.ts';
import { git, revParse } from '../core/git.ts';
import { proposeGuardrail } from '../core/guardrails.ts';
import { REGISTRY_ENTRIES } from '../core/init/standard.ts';
import { addEntry } from '../core/logs.ts';
import { startPhase } from '../core/phases.ts';
import { applyGenerate, planGenerate } from '../core/vault/generate.ts';
import { commitAll, gitRepo } from './git-helpers.ts';
import { finishPhase, LATER, NOW, tempDir, treeHash } from './helpers.ts';
import { note, STANDARD } from './vault-helpers.ts';

export const BUILD = 'proof-board';
/** The build's accepted guardrails, which are the decommission gate's rows. */
export const ROWS = ['explicit-commits', 'no-network'];
export type Marks = Record<string, 'accepted' | 'research' | 'declined'>;

export interface Finished { root: string; env: Record<string, string>; build: string }

export function put(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** docs/_meta/ as phase-3's init wrote it: contract 1 and no report class, so a decommission has to upgrade it. */
function contractOneVault(root: string): void {
  for (const e of REGISTRY_ENTRIES) cpSync(join(STANDARD, e), join(root, 'docs', '_meta', e), { recursive: true });
  rmSync(join(root, 'docs', '_meta', 'classes', 'report.md'), { force: true });
  const contract = join(root, 'docs', '_meta', 'contract.md');
  writeFileSync(contract, readFileSync(contract, 'utf8').replace(/^contract: \d+$/m, 'contract: 1'));
}

/** One finished phase: its work, its finish gate approved, close-out, then a fast-forward of main. */
function finishAndMerge(root: string, env: Record<string, string>, phase: string, now?: string, later?: string): void {
  commitAll(root, `Work for ${phase}`, env);
  finishPhase(root, BUILD, phase, now, later);
  commitAll(root, `Finish ${phase}`, env);
  git(root, ['fetch', '-q', '.', 'HEAD:main']);
}

/**
 * A repo whose build "proof-board" is finished: two phases, both merged into main by fast-forward, the last in
 * close-out with its finish gate approved, and main checked out. It stubs the sandbox git env into process.env, so
 * every consumer must `afterEach(() => vi.unstubAllEnvs())`. `spaced` copies the repo to a folder whose path has a
 * space, as a checkout under "My Repos" would. `gateless` is the same build with every guardrail declined, so its
 * decommission has nothing to ask.
 */
export function finishedBuild(opts: { spaced?: boolean; gateless?: boolean } = {}): Finished {
  const template = prepareTemplate(opts.gateless);
  for (const [k, v] of Object.entries(template.env)) vi.stubEnv(k, v);
  const root = opts.spaced ? join(tempDir('nexus-spaced-'), 'My Repos', 'relay') : tempDir('nexus-git-');
  cpSync(template.root, root, { recursive: true, preserveTimestamps: true });
  return { root, env: { ...template.env }, build: BUILD };
}

const built = new Map<boolean, Finished>();

/**
 * Builds the repo finishedBuild() copies, once per test file. Call it from a `beforeAll`, whose time limit is longer
 * than a test's, so the build doesn't land in the first test's own time; every call still gets its own repo.
 */
export function prepareTemplate(gateless = false): Finished {
  let t = built.get(gateless);
  if (!t) built.set(gateless, (t = buildTemplate(gateless)));
  return t;
}

function buildTemplate(gateless: boolean): Finished {
  const repo = gitRepo();
  for (const [k, v] of Object.entries(repo.env)) vi.stubEnv(k, v);
  const root = repo.root;
  contractOneVault(root);
  put(root, {
    'src/relay.ts': 'export const relay = 1;\n',
    'docs/dev/systems/relay.md': note({ class: 'system', source: 'src/relay.ts' }, '# Relay\n\nForwards calls.\n'),
  });
  applyGenerate(root, planGenerate(root));
  commitAll(root, 'Set up the vault', repo.env);

  git(root, ['checkout', '-q', '-b', `build/${BUILD}`]);
  createBuild(root, { name: BUILD, summary: 'A board for relay calls', branch: `build/${BUILD}`, now: NOW, phase: 'phase-one' });
  const guardrails = [
    { name: 'explicit-commits', text: 'Commits stage explicit paths only.' },
    { name: 'no-network', text: 'The board makes no network calls.' },
    { name: 'tabs-not-spaces', text: 'Indent with tabs.' },
  ];
  for (const g of guardrails) proposeGuardrail(root, BUILD, { ...g, source: 'chat', raisedBy: 'user', phase: 'phase-one' }, NOW);
  openGate(root, BUILD, { name: 'guardrails-phase-one', step: 'guardrails', type: 'mark-list', log: 'guardrails', title: 'Guardrails', why: 'Mark each.', items: guardrails }, NOW);
  submitAnswers(root, BUILD, 'guardrails-phase-one', { marks: gateless ? { 'explicit-commits': 'declined', 'no-network': 'declined', 'tabs-not-spaces': 'declined' } : { 'explicit-commits': 'accepted', 'no-network': 'accepted', 'tabs-not-spaces': 'declined' } }, NOW);
  applyAnswers(root, BUILD, 'guardrails-phase-one', NOW);
  addEntry(root, BUILD, 'decisions', { name: 'relay-choice', text: 'The relay pushes calls instead of polling.', status: 'accepted', source: 'scope-phase-one gate', time: NOW, phase: 'phase-one' });
  addEntry(root, BUILD, 'decisions', { name: 'ruling-inline-schema', text: 'The schema is written inline.', status: 'accepted', source: 'ruling', time: NOW, phase: 'phase-one' });
  addEntry(root, BUILD, 'decisions', { name: 'poll-faster', text: 'Poll every second.', status: 'declined', source: 'chat', time: NOW, phase: 'phase-one' });
  addEntry(root, BUILD, 'issues', { name: 'slow-replay', text: 'Replays take a minute on a cold start.', status: 'open', source: 'review · Task 3', time: NOW, phase: 'phase-one' });
  addEntry(root, BUILD, 'issues', { name: 'wrong-colour', text: 'The board header was the wrong colour.', status: 'addressed', source: 'review · Task 2', time: NOW, phase: 'phase-one' });
  put(root, {
    'src/relay.ts': 'export const relay = 2;\n',
    [`.build/${BUILD}/documents/specs/phase-one/proof-board-design.md`]: '# Proof board design\n\nA board.\n',
    [`.build/${BUILD}/documents/plans/phase-one/proof-board-plan.md`]: note({ title: 'Plan' }, '# Proof board plan\n\n1. Build it.\n'),
    [`.build/${BUILD}/documents/reports/phase-one/review.md`]: '# Review\n\nClean. ![columns](columns.png)\n',
    [`.build/${BUILD}/documents/reports/phase-one/columns.png`]: 'png',
    [`.build/${BUILD}/documents/audits/audit.md`]: '# Audit\n\nSound.\n',
  });
  finishAndMerge(root, repo.env, 'phase-one');

  git(root, ['checkout', '-q', '-b', `build/${BUILD}-phase-two`]);
  startPhase(root, BUILD, 'phase-two', { branch: `build/${BUILD}-phase-two`, now: LATER });
  addEntry(root, BUILD, 'questions', { name: 'board-colours', text: 'Which colours does the board use?', status: 'exploring', source: 'brainstorm', time: LATER, phase: 'phase-two' });
  put(root, { 'src/board.ts': 'export const board = true;\n' });
  finishAndMerge(root, repo.env, 'phase-two', '2026-10-02T16:00:00-06:00', '2026-10-02T17:00:00-06:00');
  git(root, ['checkout', '-q', 'main']);

  return { root, env: repo.env, build: BUILD };
}

/** A draft as Claude writes it: the decisions of note it picked, then the report. The template's repo lists no components. */
export function plainReport(build = BUILD, props: Record<string, unknown> = { decisions: ['relay-choice'] }): string {
  return note(props, `# ${build} final report\n\n## Outcome\n\n- phase-one delivered the board.\n`);
}

export function ruleNote(text: string, build = BUILD): string {
  return note({ class: 'rule', status: 'active', tier: 'always', build }, `# ${text}\n\n**Why:** it held for the whole build.\n`);
}

/** Drafts the final report in the build, as Claude does before the gate. */
export function draftReport(root: string, build = BUILD, text = plainReport(build)): void {
  put(root, { [`.build/${build}/${reportDraft(build)}`]: text });
}

/** Opens the decommission gate on these rows with the draft report attached, then answers and applies it. */
export function decideGate(root: string, build: string, marks: Marks, rows = Object.keys(marks)): void {
  const gate = decommissionGateName(build);
  openGate(root, build, { name: gate, step: 'decommission', type: 'mark-list', title: `Decommission ${build}`, why: 'Mark what becomes a repo rule.', document: reportDraft(build), items: rows.map((name) => ({ name, text: `Rule: ${name}` })) }, LATER);
  submitAnswers(root, build, gate, { marks }, LATER);
  applyAnswers(root, build, gate, LATER);
}

/** For a build with no accepted guardrail: the gate approves (or sends back) the final report, in round `round`. */
export function decideReport(root: string, build: string, decision: 'approve' | 'send-back', round = ''): void {
  const gate = `${decommissionGateName(build)}${round}`;
  openGate(root, build, { name: gate, step: 'decommission', type: 'approve', title: `Decommission ${build}`, why: 'Approve what the report moves.', document: reportDraft(build) }, LATER);
  submitAnswers(root, build, gate, { decision }, LATER);
  applyAnswers(root, build, gate, LATER);
}

/** A finished build with its report drafted, the gate decided with these marks, and a rule note for each accepted row. */
export function readyToApply(marks: Marks, opts: { spaced?: boolean } = {}): Finished {
  const f = finishedBuild(opts);
  draftReport(f.root, f.build);
  decideGate(f.root, f.build, marks);
  for (const [row, mark] of Object.entries(marks)) {
    if (mark === 'accepted') put(f.root, { [`docs/governance/rules/${row}.md`]: ruleNote(`Rule ${row}`, f.build) });
  }
  return f;
}

/** What a refused apply must leave alone: HEAD, the branch, the index and the build folder. */
export function snapshot(root: string, build = BUILD): Record<string, string | null> {
  return {
    head: revParse(root, 'HEAD'),
    branch: git(root, ['branch', '--show-current']),
    cached: git(root, ['diff', '--cached', '--name-only']),
    build: existsSync(join(root, '.build', build)) ? treeHash(join(root, '.build', build)) : null,
  };
}
