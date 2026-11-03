import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { applyDecommission } from '../core/decommission/apply.ts';
import { DECISIONS_LOG, ISSUES_LOG, buildRecordPath } from '../core/decommission/paths.ts';
import { git, revParse } from '../core/git.ts';
import { readFrontmatter } from '../core/vault/frontmatter.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { BUILD, decideGate, decideReport, draftReport, finishedBuild, plainReport, prepareTemplate, put, readyToApply, ROWS, ruleNote, snapshot } from './decommission-helpers.ts';
import { STANDARD } from './vault-helpers.ts';
import { NOW } from './helpers.ts';

beforeAll(() => {
  prepareTemplate();
  prepareTemplate(true);
});
afterEach(() => vi.unstubAllEnvs());

const ARCHIVE = `docs/superpowers/archive/${BUILD}`;
const BOTH = { 'explicit-commits': 'accepted', 'no-network': 'declined' } as const;
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf8');
const json = (root: string, rel: string): { entries: Record<string, unknown>[] } => JSON.parse(read(root, rel)) as { entries: Record<string, unknown>[] };
const apply = (root: string, env: Record<string, string>) => applyDecommission(root, BUILD, { standard: STANDARD, env });

describe('applyDecommission and the .build folder', () => {
  it('removes .build/ when only .gitattributes is left', () => {
    const { root, env } = readyToApply(BOTH);
    expect(git(root, ['ls-files', '.build/.gitattributes'])).toBe('.build/.gitattributes');
    apply(root, env);
    expect(existsSync(join(root, '.build'))).toBe(false);
    expect(git(root, ['show', '--name-status', '--format=', 'HEAD'])).toContain('D\t.build/.gitattributes');
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });
  it('keeps .build/ while anything else is in it', () => {
    const { root, env } = readyToApply(BOTH);
    // A file of the user's: a second build folder would count as a build still running, and stop the apply.
    put(root, { '.build/README.md': '# Builds\n' });
    git(root, ['add', '.build/README.md'], { env });
    git(root, ['commit', '-q', '-m', 'a note on builds'], { env });
    apply(root, env);
    expect(existsSync(join(root, '.build', '.gitattributes'))).toBe(true);
    expect(existsSync(join(root, '.build', 'README.md'))).toBe(true);
    expect(git(root, ['ls-files', '.build/.gitattributes'])).toBe('.build/.gitattributes');
  });
});

describe('applyDecommission under Codex and Antigravity', () => {
  const codexBlock = readFileSync(join(STANDARD, 'codex-block.md'), 'utf8');
  it("commits Antigravity's generated rule files with the record, and nothing under .claude/", () => {
    const { root, env } = readyToApply(BOTH);
    applyDecommission(root, BUILD, { standard: STANDARD, env, harness: 'antigravity' });
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect(git(root, ['show', 'HEAD:.agents/rules/nexus-explicit-commits.md'])).toContain('Rule explicit-commits');
    expect(existsSync(join(root, '.claude', 'rules', 'nexus'))).toBe(false);
  });
  it("commits Codex's rules section in AGENTS.md with the record", () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { 'AGENTS.md': `# Mine\n\n${codexBlock}` });
    git(root, ['add', 'AGENTS.md'], { env });
    git(root, ['commit', '-q', '-m', 'agents'], { env });
    applyDecommission(root, BUILD, { standard: STANDARD, env, harness: 'codex' });
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect(git(root, ['show', 'HEAD:AGENTS.md'])).toContain('Rule explicit-commits');
    expect(git(root, ['show', 'HEAD:AGENTS.md'])).toMatch(/^# Mine\n/);
  });
  it("under Codex refuses an AGENTS.md with uncommitted edits, so the user's own changes aren't swept into the commit", () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { 'AGENTS.md': `# Mine\n\n${codexBlock}` });
    expect(() => applyDecommission(root, BUILD, { standard: STANDARD, env, harness: 'codex' })).toThrow(/AGENTS\.md/);
  });
});

describe('applyDecommission', () => {
  it('commits the build folder as it stands, then lands the record, the archive and the rules in one commit on the current branch', () => {
    const { root, env } = readyToApply(BOTH);
    const before = revParse(root, 'HEAD');
    const a = apply(root, env);

    expect(git(root, ['log', '-1', '--format=%s'])).toBe(`Decommission ${BUILD}`);
    // The record commit: the gate's answers and the draft report are in history before the folder goes.
    expect(git(root, ['log', '-1', '--format=%s', 'HEAD^'])).toBe(`Record ${BUILD} before decommission`);
    expect(a.record).toBe(revParse(root, 'HEAD^'));
    expect(git(root, ['show', `HEAD^:.build/${BUILD}/gates/decommission-${BUILD}.answers.json`])).toContain('"explicit-commits": "accepted"');
    expect(git(root, ['diff', '--name-only', 'HEAD^^', 'HEAD^']).split('\n').every((p) => p.startsWith(`.build/${BUILD}/`))).toBe(true);
    expect(git(root, ['rev-parse', 'HEAD^^'])).toBe(before);
    expect(a.commit).toBe(revParse(root, 'HEAD'));
    expect(git(root, ['branch', '--show-current'])).toBe('main');
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect(existsSync(join(root, '.build', BUILD))).toBe(false);
    // Nothing else about the repo's branches changes.
    expect(revParse(root, `refs/heads/build/${BUILD}`)).not.toBeNull();
    expect(revParse(root, `refs/heads/build/${BUILD}-decommission`)).toBeNull();

    expect(read(root, '.claude/rules/nexus/explicit-commits.md')).toContain('Rule explicit-commits');
    expect(existsSync(join(root, 'docs/governance/rules/no-network.md'))).toBe(false);
    expect(read(root, 'docs/_meta/contract.md')).toMatch(/^contract: 3$/m);
    expect(a.upgraded).toContain('docs/_meta/classes/report.md');
  });

  it('archives each spec, plan, report and audit by phase with its class and build, and the files beside them', () => {
    const { root, env } = readyToApply(BOTH);
    const a = apply(root, env);
    const props = (rel: string) => readFrontmatter(read(root, rel)).data;
    expect(props(`${ARCHIVE}/phase-one/proof-board-design.md`)).toMatchObject({ class: 'spec', build: BUILD, component: 'shared' });
    // A document's own properties stay.
    expect(props(`${ARCHIVE}/phase-one/proof-board-plan.md`)).toMatchObject({ class: 'plan', build: BUILD, title: 'Plan' });
    expect(props(`${ARCHIVE}/phase-one/review.md`)).toMatchObject({ class: 'report', build: BUILD });
    expect(props(`${ARCHIVE}/audit.md`)).toMatchObject({ class: 'report', build: BUILD });
    expect(read(root, `${ARCHIVE}/phase-one/columns.png`)).toBe('png');
    expect(read(root, `${ARCHIVE}/phase-one/proof-board-design.md`)).toContain('# Proof board design\n\nA board.');
    // The final report isn't archived: it is the build's record.
    expect(existsSync(join(root, `${ARCHIVE}/${BUILD} final report.md`))).toBe(false);
    expect(a.archived.some((p) => p.endsWith('final report.md'))).toBe(false);
    expect(existsSync(join(root, `${ARCHIVE}/${BUILD}.canvas`))).toBe(false);
  });

  it('writes only the decisions of note the draft lists, and the open issues, into the two logs, each entry carrying its build', () => {
    const { root, env } = readyToApply(BOTH);
    const a = apply(root, env);
    // The ruling wasn't picked, the finish approvals never go, and the gate's own marks aren't decisions.
    expect(json(root, DECISIONS_LOG).entries).toEqual([
      expect.objectContaining({ build: BUILD, name: 'relay-choice', phase: 'phase-one', status: 'accepted', text: 'The relay pushes calls instead of polling.' }),
    ]);
    expect(json(root, ISSUES_LOG).entries).toEqual([expect.objectContaining({ build: BUILD, name: 'slow-replay', status: 'open' })]);
    expect(a).toMatchObject({ decisions: 1, issues: 1 });
    // No decision or issue becomes a note, and a question stays with the build.
    expect(existsSync(join(root, 'docs/governance/decisions'))).toBe(false);
    expect(existsSync(join(root, 'docs/governance/issues'))).toBe(false);
  });

  it("keeps other builds' entries in the logs and replaces its own", () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { [DECISIONS_LOG]: JSON.stringify({ entries: [{ build: 'older', name: 'kept', text: 'Kept.', status: 'accepted' }, { build: BUILD, name: 'stale', text: 'Stale.', status: 'accepted' }] }) });
    apply(root, env);
    expect(json(root, DECISIONS_LOG).entries.map((e) => `${String(e['build'])}/${String(e['name'])}`)).toEqual(['older/kept', `${BUILD}/relay-choice`]);
  });

  it('with no accepted guardrail, still asks: the user approves the final report, and the approval is on the record', () => {
    const { root, env } = finishedBuild({ gateless: true });
    draftReport(root);
    expect(() => apply(root, env)).toThrow(`decommission-${BUILD} isn't open yet`);
    decideReport(root, BUILD, 'approve');
    apply(root, env);
    expect(git(root, ['log', '-1', '--format=%s'])).toBe(`Decommission ${BUILD}`);
    expect(existsSync(join(root, '.build', BUILD))).toBe(false);
    expect(existsSync(join(root, 'docs/governance/rules'))).toBe(false);
    expect(read(root, buildRecordPath(BUILD))).toMatch(new RegExp(`decommission-${BUILD} approved \\d{4}-\\d{2}-\\d{2}`));
    expect(json(root, DECISIONS_LOG).entries.map((e) => e['name'])).toEqual(['relay-choice']);
  });

  it('a sent-back report is revised and asked again in the next round, and only the latest round counts', () => {
    const { root, env } = finishedBuild({ gateless: true });
    draftReport(root);
    decideReport(root, BUILD, 'send-back');
    expect(() => apply(root, env)).toThrow(`decommission-${BUILD} was sent back: revise the final report as its note says, then open decommission-${BUILD}-2`);
    decideReport(root, BUILD, 'approve', '-2');
    apply(root, env);
    expect(git(root, ['log', '-1', '--format=%s'])).toBe(`Decommission ${BUILD}`);
  });

  it('refuses an approve gate when the build has accepted guardrails: each is a row the user marks', () => {
    const { root, env } = finishedBuild();
    draftReport(root);
    decideReport(root, BUILD, 'approve');
    expect(() => apply(root, env)).toThrow('the build has accepted guardrails (explicit-commits, no-network): its decommission gate is a mark-list with a row for each');
  });

  it("keeps the step-4 change to an earlier build's entry, uncommitted, and commits it with the decommission", () => {
    const { root, env } = readyToApply(BOTH);
    const closed = { build: 'older', name: 'slow-poll', text: 'Polling is slow.', status: 'closed', closedBy: BUILD };
    put(root, { [ISSUES_LOG]: JSON.stringify({ entries: [closed] }) });
    apply(root, env);
    expect(json(root, ISSUES_LOG).entries[0]).toEqual(closed);
    expect(git(root, ['show', `HEAD:${ISSUES_LOG}`])).toContain(`"closedBy": "${BUILD}"`);
  });

  it("writes the final report as the build's record: its properties, the approvals and links to the archive", () => {
    const { root, env } = readyToApply(BOTH);
    const a = apply(root, env);
    expect(a.buildRecord).toBe(buildRecordPath(BUILD));
    expect(buildRecordPath(BUILD)).toBe(`docs/governance/builds/${BUILD}.md`);
    const text = read(root, buildRecordPath(BUILD));
    const fm = readFrontmatter(text);
    expect(fm.data).toEqual({ class: 'build-record', component: 'shared', build: BUILD, 'nex-category': 'build-record' });
    const body = fm.body.join('\n');
    expect(body).toContain(`# ${BUILD} final report`);
    expect(body).toMatch(/## Approvals\n\nfinish-phase-one approved \d{4}-\d{2}-\d{2} · finish-phase-two approved \d{4}-\d{2}-\d{2}\n/);
    expect(body).toContain('## Archive');
    expect(body).toContain(`- [[superpowers/archive/${BUILD}/phase-one/proof-board-design]]`);
    expect(body).toContain(`- [[superpowers/archive/${BUILD}/phase-one/columns.png]]`);
    expect(body).toContain(`- [[superpowers/archive/${BUILD}/audit]]`);
  });

  it('gives the record the components the draft names, in a repo that lists components', () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { 'docs/_meta/components.md': '---\ncomponents: [relay, board]\n---\n# Components\n' });
    put(root, { 'docs/dev/systems/relay.md': read(root, 'docs/dev/systems/relay.md').replace('class: system', 'class: system\ncomponent: relay') });
    git(root, ['commit', '-q', '-am', 'List components'], { env });
    put(root, { 'docs/governance/rules/explicit-commits.md': ruleNote('Rule explicit-commits').replace('class: rule', 'class: rule\ncomponent: shared') });
    draftReport(root, BUILD, plainReport(BUILD, { components: ['relay'], decisions: [] }));
    const a = apply(root, env);
    expect(readFrontmatter(read(root, buildRecordPath(BUILD))).data).toMatchObject({ components: ['relay'] });
    expect(a.decisions).toBe(0);
  });

  it("says where the build's record landed, through the CLI", async () => {
    const { root, env } = readyToApply(BOTH);
    const out: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: () => undefined, now: () => NOW, readStdin: async () => '', env };
    expect(await main(['decommission', 'apply', BUILD], io)).toBe(0);
    expect(out[0]).toMatch(new RegExp(`^Decommissioned "${BUILD}" in one commit .*; the record is docs/governance/builds/${BUILD}\\.md; \\.build/${BUILD}/ removed\\.$`));
  });

  it('takes an uncommitted .build/.gitattributes into the record commit', () => {
    const { root, env } = readyToApply(BOTH);
    git(root, ['rm', '-q', '--cached', '.build/.gitattributes']);
    git(root, ['commit', '-q', '-m', 'Untrack the attributes'], { env });
    apply(root, env);
    expect(git(root, ['show', '--name-only', '--format=', 'HEAD^']).split('\n')).toContain('.build/.gitattributes');
    expect(git(root, ['status', '--porcelain'])).toBe('');
  });

  it('makes no record commit when the build folder is already committed', () => {
    const { root, env } = readyToApply({ 'explicit-commits': 'declined', 'no-network': 'declined' });
    git(root, ['add', '-A', '--', `.build/${BUILD}`]);
    git(root, ['commit', '-q', '-m', 'By hand'], { env });
    const before = revParse(root, 'HEAD');
    expect(apply(root, env).record).toBeNull();
    expect(git(root, ['rev-parse', 'HEAD^'])).toBe(before);
  });

  it('needs no note for a row marked research or declined', () => {
    const { root, env } = readyToApply({ 'explicit-commits': 'research', 'no-network': 'declined' });
    apply(root, env);
    expect(existsSync(join(root, '.claude/rules/nexus/explicit-commits.md'))).toBe(false);
  });

  it('works in a checkout whose path has a space', () => {
    const { root, env } = readyToApply(BOTH, { spaced: true });
    expect(apply(root, env).commit).toBe(revParse(root, 'HEAD'));
  });
});

describe('applyDecommission refuses, committing nothing and keeping the build folder', () => {
  /** `recorded`: the refusal comes after the record commit, which stands and touches only the build folder. */
  const refused = (root: string, env: Record<string, string>, message: RegExp, recorded = false): void => {
    const before = snapshot(root);
    expect(() => apply(root, env)).toThrow(message);
    const after = snapshot(root);
    expect({ ...after, head: null }).toEqual({ ...before, head: null });
    if (!recorded) expect(after['head']).toBe(before['head']);
    else expect(git(root, ['log', '-1', '--format=%s'])).toBe(`Record ${BUILD} before decommission`);
  };

  it("when the gate's rows aren't exactly the build's accepted guardrails", () => {
    const { root, env } = finishedBuild();
    draftReport(root);
    decideGate(root, BUILD, { 'explicit-commits': 'declined' });
    refused(root, env, /rows \(explicit-commits\) aren't the build's accepted guardrails \(explicit-commits, no-network\)/);
  });

  it('when an accepted row has no rule note', () => {
    const { root, env } = readyToApply(BOTH);
    rmSync(join(root, 'docs/governance/rules/explicit-commits.md'));
    refused(root, env, /explicit-commits was accepted, but docs\/governance\/rules\/explicit-commits\.md doesn't exist/);
  });

  it('when the final report was never drafted', () => {
    const { root, env } = readyToApply(BOTH);
    rmSync(join(root, '.build', BUILD, 'documents', 'reports', `${BUILD} final report.md`));
    refused(root, env, /no final report/);
  });

  it('when the gate is not applied yet', () => {
    const { root, env } = finishedBuild();
    draftReport(root);
    refused(root, env, /decommission-proof-board isn't open yet/);
  });

  it('when the vault check blocks, naming the finding, so it can be fixed and run again', () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { 'docs/governance/rules/explicit-commits.md': '---\nclass: rule\nstatus: active\n---\n# No tier\n' });
    refused(root, env, /The decommission wasn't committed and \.build\/proof-board\/ is in place/, true);
    put(root, { 'docs/governance/rules/explicit-commits.md': ruleNote('Rule explicit-commits') });
    expect(apply(root, env).commit).toBe(revParse(root, 'HEAD'));
    expect(ROWS).toHaveLength(2);
  });

  it('when the draft lists no decisions of note, or names one that is not a decision of the build', () => {
    const { root, env } = readyToApply(BOTH);
    draftReport(root, BUILD, plainReport(BUILD, { title: 'Final' }));
    refused(root, env, /list the build's decisions of note in the draft's frontmatter/);
    draftReport(root, BUILD, plainReport(BUILD, { decisions: ['relay-choice', 'finish-phase-one', 'nowhere'] }));
    refused(root, env, /decisions names finish-phase-one, nowhere, which aren't accepted decisions of the build/);
  });

  it('when the repo lists components and the draft names none, or one that is not listed', () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { 'docs/_meta/components.md': '---\ncomponents: [relay]\n---\n# Components\n' });
    put(root, { 'docs/dev/systems/relay.md': read(root, 'docs/dev/systems/relay.md').replace('class: system', 'class: system\ncomponent: relay') });
    git(root, ['commit', '-q', '-am', 'List components'], { env });
    put(root, { 'docs/governance/rules/explicit-commits.md': ruleNote('Rule explicit-commits').replace('class: rule', 'class: rule\ncomponent: shared') });
    refused(root, env, /name the components the build touched in the draft's frontmatter: components: \[relay\]/);
    draftReport(root, BUILD, plainReport(BUILD, { components: ['relay', 'metrics'], decisions: [] }));
    refused(root, env, /components names metrics, which isn't listed/);
  });

  it('when two documents would archive to the same path', () => {
    const { root, env } = readyToApply(BOTH);
    put(root, { [`.build/${BUILD}/documents/reports/audit.md`]: '# Another audit\n' });
    refused(root, env, /documents\/reports\/audit\.md and documents\/audits\/audit\.md would both archive to/, true);
  });
});
