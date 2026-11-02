import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openGate, type GateInput, submitAnswers, applyAnswers, summarize, unreadAnswers, gatePath, readGate } from '../core/gates.ts';
import { readBuild } from '../core/build.ts';
import { activeBuilds, changeStage } from '../core/lifecycle.ts';
import { readLog } from '../core/logs.ts';
import { openPermits } from '../core/permits.ts';
import { runGuard } from '../hooks/guard.ts';
import { exampleRepo, NOW, LATER, readJsonFile, finishPhase } from './helpers.ts';

const B = 'relay-rebuild';
const pauseGate = {
  name: 'pause-scope',
  type: 'mark-list' as const,
  title: 'Confirm the pause work',
  why: 'Two points from the afternoon chat.',
  items: [
    { name: 'pause-switch', text: 'Per-source pause switch', source: 'chat 14:10' },
    { name: 'dry-run', text: 'Dry-run mode for replays', source: 'chat 14:12' },
  ],
};

describe('openGate', () => {
  it('writes the request and records it in build.json', () => {
    const root = exampleRepo();
    const req = openGate(root, B, pauseGate, NOW);
    expect(req.opened).toBe(NOW);
    expect(readGate(root, B, 'pause-scope').items).toHaveLength(2);
    expect(readBuild(root, B).gates['pause-scope']).toEqual({ opened: NOW, read: null });
  });
  it('refuses to reopen a gate that was already answered, so a permit cannot be reopened', () => {
    const root = exampleRepo();
    const permit = { name: 'claude-rule', type: 'approve' as const, title: 't', why: 'w', permit: { target: 'CLAUDE.md', change: 'Add the replay rule' } };
    openGate(root, 'relay-rebuild', permit, NOW);
    submitAnswers(root, 'relay-rebuild', 'claude-rule', { decision: 'approve' }, NOW);
    applyAnswers(root, 'relay-rebuild', 'claude-rule', NOW);
    rmSync(gatePath(root, 'relay-rebuild', 'claude-rule'));
    expect(() => openGate(root, 'relay-rebuild', permit, NOW)).toThrow('Gate "claude-rule" was already answered. Open a new gate with a new name.');
    expect(openPermits(root, new Date('2026-10-02T20:05:00Z'))).toEqual([]);
  });
  it('refuses to reopen a gate', () => {
    const root = exampleRepo();
    openGate(root, B, pauseGate, NOW);
    expect(() => openGate(root, B, pauseGate, NOW)).toThrow(/already open/);
  });
  it('refuses repeated row names', () => {
    const items = [pauseGate.items[0]!, pauseGate.items[0]!];
    expect(() => openGate(exampleRepo(), B, { ...pauseGate, items }, NOW)).toThrow(/repeated: pause-switch/);
  });
  it('refuses a concept page that does not exist', () => {
    const gate = {
      name: 'second-look',
      type: 'concept-pick' as const,
      title: 'Pick',
      why: 'Pick one.',
      options: [
        { name: 'quiet-board', label: 'Quiet', page: 'concepts/quiet-board.html' },
        { name: 'ghost-page', label: 'Ghost', page: 'concepts/ghost-page.html' },
      ],
    };
    expect(() => openGate(exampleRepo(), B, gate, NOW)).toThrow(/concepts\/ghost-page.html does not exist/);
  });
  it('refuses an invalid request with the schema reason', () => {
    expect(() => openGate(exampleRepo(), B, { ...pauseGate, type: 'vote' as never }, NOW)).toThrow(/Gate request is invalid/);
  });
});

describe('submitAnswers', () => {
  it('writes answers with server time and gate name', () => {
    const root = exampleRepo();
    const a = submitAnswers(root, B, 'look', { choice: 'quiet-board', submitted: '1999-01-01T00:00:00Z' }, NOW);
    expect(a).toEqual({ choice: 'quiet-board', gate: 'look', submitted: NOW });
    expect(readJsonFile(gatePath(root, B, 'look', true))).toEqual(a);
  });
  it('refuses a second submission', () => {
    const root = exampleRepo();
    submitAnswers(root, B, 'look', { choice: 'quiet-board' }, NOW);
    expect(() => submitAnswers(root, B, 'look', { choice: 'dense-table' }, LATER)).toThrow(/already been answered/);
  });
  it('refuses unmarked rows, naming them', () => {
    const root = exampleRepo();
    openGate(root, B, pauseGate, NOW);
    expect(() => submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted' } }, NOW)).toThrow(/missing: dry-run/);
    expect(existsSync(gatePath(root, B, 'pause-scope', true))).toBe(false);
  });
  it('refuses marks for rows that are not in the gate', () => {
    const root = exampleRepo();
    openGate(root, B, pauseGate, NOW);
    const marks = { 'pause-switch': 'accepted', 'dry-run': 'declined', 'extra-row': 'accepted' };
    expect(() => submitAnswers(root, B, 'pause-scope', { marks }, NOW)).toThrow(/not in the gate: extra-row/);
  });
  it('refuses a choice that is not an option', () => {
    expect(() => submitAnswers(exampleRepo(), B, 'look', { choice: 'third-way' }, NOW)).toThrow(/not one of the options/);
  });
  it('refuses "none of these" without a note and a combine of one', () => {
    const root = exampleRepo();
    expect(() => submitAnswers(root, B, 'look', { none: true, note: '  ' }, NOW)).toThrow(/needs a note/);
    expect(() => submitAnswers(root, B, 'look', { choices: ['quiet-board'] }, NOW)).toThrow(/choices must NOT have fewer than 2 items/);
    expect(existsSync(gatePath(root, B, 'look', true))).toBe(false);
  });
  it('records a pick with its fields in the original order', () => {
    const root = exampleRepo();
    // A phase on the request is copied to the decision, so the example's look gate gets one: the key order is then
    // checked with every optional field present.
    writeFileSync(gatePath(root, B, 'look'), JSON.stringify({ ...(readJsonFile(gatePath(root, B, 'look')) as object), phase: 'replay' }));
    submitAnswers(root, B, 'look', { choice: 'quiet-board', note: 'calm' }, NOW);
    applyAnswers(root, B, 'look', LATER);
    const entry = readLog(root, B, 'decisions').entries.find((e) => e.name === 'look');
    expect(Object.keys(entry ?? {})).toEqual(['name', 'text', 'status', 'source', 'time', 'note', 'phase']);
  });
  it('accepts a combine and writes it', () => {
    const root = exampleRepo();
    const a = submitAnswers(root, B, 'look', { choices: ['quiet-board', 'dense-table'], note: 'merge' }, NOW);
    expect(a).toEqual({ choices: ['quiet-board', 'dense-table'], note: 'merge', gate: 'look', submitted: NOW });
    expect(readJsonFile(gatePath(root, B, 'look', true))).toEqual(a);
  });
  it('reports a gate that does not exist', () => {
    expect(() => submitAnswers(exampleRepo(), B, 'no-such-gate', { decision: 'approve' }, NOW)).toThrow(/No gate "no-such-gate"/);
  });
  it('refuses a body that is not an object', () => {
    expect(() => submitAnswers(exampleRepo(), B, 'look', ['quiet-board'], NOW)).toThrow(/must be a JSON object/);
  });
});

describe('applyAnswers', () => {
  it('moves marked rows into the right logs and marks the gate read', () => {
    const root = exampleRepo();
    openGate(root, B, pauseGate, NOW);
    // pause-switch starts life as an open question
    writeFileSync(
      join(root, '.build', B, 'logs', 'questions.json'),
      JSON.stringify({ entries: [{ name: 'pause-switch', text: 'Per-source pause switch', status: 'exploring', source: 'chat 14:10', time: NOW }] }),
    );
    submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'research' } }, NOW);
    const s = applyAnswers(root, B, 'pause-scope', LATER);
    expect(s).toMatchObject({ accepted: ['pause-switch'], research: ['dry-run'], declined: [] });
    expect(readLog(root, B, 'decisions').entries.find((e) => e.name === 'pause-switch')?.status).toBe('accepted');
    expect(readLog(root, B, 'questions').entries.map((e) => e.name)).toEqual(['dry-run']);
    expect(readBuild(root, B).gates['pause-scope']?.read).toBe(LATER);
  });
  it('names the open questions a mark-list closes and the decisions it reopens as questions', () => {
    const root = exampleRepo();
    openGate(root, B, pauseGate, NOW);
    writeFileSync(
      join(root, '.build', B, 'logs', 'questions.json'),
      JSON.stringify({ entries: [{ name: 'pause-switch', text: 'Per-source pause switch', status: 'exploring', source: 'chat 14:10', time: NOW }] }),
    );
    writeFileSync(
      join(root, '.build', B, 'logs', 'decisions.json'),
      JSON.stringify({ entries: [{ name: 'dry-run', text: 'Dry run', status: 'accepted', source: 'chat 14:12', time: NOW }] }),
    );
    submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'research' } }, NOW);
    const s = applyAnswers(root, B, 'pause-scope', LATER);
    expect(s.closed).toEqual(['pause-switch']);
    expect(s.reopened).toEqual(['dry-run']);
  });
  it('closes and reopens nothing when no row matches an entry in the other log', () => {
    const root = exampleRepo();
    openGate(root, B, pauseGate, NOW);
    submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'research' } }, NOW);
    const s = applyAnswers(root, B, 'pause-scope', LATER);
    expect(s.closed).toEqual([]);
    expect(s.reopened).toEqual([]);
  });
  it('records a concept pick and an approval as decisions', () => {
    const root = exampleRepo();
    submitAnswers(root, B, 'look', { choice: 'dense-table', note: 'Easier to scan' }, NOW);
    submitAnswers(root, B, 'spec-review', { decision: 'send-back', note: 'Tighten retry rules' }, NOW);
    const picked = applyAnswers(root, B, 'look', LATER);
    expect(picked.choice).toBe('dense-table');
    expect(picked.next).toBe('Topic "look" is settled.');
    expect(applyAnswers(root, B, 'spec-review', LATER).decision).toBe('send-back');
    const decisions = readLog(root, B, 'decisions').entries;
    expect(decisions.find((e) => e.name === 'look')).toMatchObject({ text: 'Pick a direction for the status page: Dense table', status: 'accepted', note: 'Easier to scan' });
    expect(decisions.find((e) => e.name === 'spec-review')).toMatchObject({ status: 'declined', note: 'Tighten retry rules' });
  });
  it('explains when there are no answers yet', () => {
    expect(() => applyAnswers(exampleRepo(), B, 'look', LATER)).toThrow(/no answers yet/);
  });
  describe('concept rounds', () => {
    const round = (extra: Record<string, unknown> = { topic: 'status-look' }) => {
      const root = exampleRepo();
      writeFileSync(join(root, '.build', B, 'concepts', 'split-view.html'), '<p>split</p>');
      openGate(root, B, {
        name: 'look-2',
        type: 'concept-pick',
        title: 'Pick a direction for the status page',
        why: 'Second round.',
        ...extra,
        options: [
          { name: 'quiet-board', label: 'Quiet board', page: 'concepts/quiet-board.html' },
          { name: 'dense-table', label: 'Dense table', page: 'concepts/dense-table.html' },
          { name: 'split-view', label: 'Split view', page: 'concepts/split-view.html' },
        ],
      }, NOW);
      return root;
    };
    const entry = (root: string) => readLog(root, B, 'decisions').entries.find((e) => e.name === 'look-2');
    it('records a combine and says what to open next', () => {
      const root = round();
      submitAnswers(root, B, 'look-2', { choices: ['quiet-board', 'split-view'], note: 'merge them' }, NOW);
      const s = applyAnswers(root, B, 'look-2', LATER);
      expect(entry(root)).toMatchObject({ text: 'Pick a direction for the status page: combine Quiet board + Split view', status: 'accepted', note: 'merge them' });
      expect(s.choices).toEqual(['quiet-board', 'split-view']);
      expect(s.next).toBe('Open the next round on topic "status-look" with new pages in concepts/status-look/, merging Quiet board and Split view.');
    });
    it('records none of these as declined', () => {
      const root = round();
      submitAnswers(root, B, 'look-2', { none: true, note: 'too cold' }, NOW);
      const s = applyAnswers(root, B, 'look-2', LATER);
      expect(entry(root)).toMatchObject({ text: 'Pick a direction for the status page: none of these', status: 'declined', note: 'too cold' });
      expect(s.none).toBe(true);
      expect(s.next).toBe("Open the next round on topic \"status-look\" with new pages in concepts/status-look/, using the user's note.");
    });
    it('settles the topic on a single pick', () => {
      const root = round();
      submitAnswers(root, B, 'look-2', { choice: 'dense-table' }, NOW);
      const s = applyAnswers(root, B, 'look-2', LATER);
      expect(s.choice).toBe('dense-table');
      expect(s.next).toBe('Topic "status-look" is settled.');
    });
    it('uses the gate name when there is no topic', () => {
      const root = round({});
      submitAnswers(root, B, 'look-2', { choice: 'dense-table' }, NOW);
      expect(applyAnswers(root, B, 'look-2', LATER).next).toBe('Topic "look-2" is settled.');
    });
    it('words a combine and none of these in the waiting summary', () => {
      const request = readGate(round(), B, 'look-2');
      expect(summarize(request, { gate: 'g', submitted: NOW, choices: ['quiet-board', 'split-view'], note: 'merge' })).toBe('combine "Quiet board" + "Split view"; note: "merge"');
      expect(summarize(request, { gate: 'g', submitted: NOW, none: true, note: 'cold' })).toBe('none of these; note: "cold"');
    });
  });
});

describe('unreadAnswers', () => {
  it('is empty when every answer has been applied', () => {
    expect(unreadAnswers(exampleRepo())).toEqual({ waiting: [], problems: [] });
  });
  it('lists new answers until they are applied', () => {
    const root = exampleRepo();
    submitAnswers(root, B, 'look', { choice: 'quiet-board' }, NOW);
    expect(unreadAnswers(root).waiting).toEqual([{ build: B, gate: 'look', submitted: NOW, summary: 'picked "Quiet board"' }]);
    applyAnswers(root, B, 'look', LATER);
    expect(unreadAnswers(root).waiting).toEqual([]);
  });
  it('carries the stamped permit of an approved permit gate, and only then', () => {
    const root = exampleRepo();
    const permit = { target: 'CLAUDE.md', change: 'Add the replay rule' };
    openGate(root, B, { name: 'claude-rule', type: 'approve', title: 't', why: 'w', permit }, NOW);
    openGate(root, B, { name: 'agents-rule', type: 'approve', title: 't', why: 'w', permit: { target: 'AGENTS.md', change: 'x' } }, NOW);
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    submitAnswers(root, B, 'agents-rule', { decision: 'send-back' }, NOW);
    expect(unreadAnswers(root).waiting).toEqual([
      { build: B, gate: 'agents-rule', submitted: NOW, summary: 'sent back' },
      { build: B, gate: 'claude-rule', submitted: NOW, summary: 'approved permit for CLAUDE.md ("Add the replay rule")', permit },
    ]);
  });
  it('never reports answers older than the last read', () => {
    const root = exampleRepo();
    // scope.answers.json was submitted 11:55 and read 11:58 in the example
    expect(unreadAnswers(root).waiting.map((w) => w.gate)).not.toContain('scope');
  });
  it('reports an unreadable answers file instead of skipping it', () => {
    const root = exampleRepo();
    writeFileSync(gatePath(root, B, 'look', true), '{ broken');
    const { problems } = unreadAnswers(root);
    expect(problems).toEqual([{ file: `${B}/gates/look.answers.json`, message: expect.any(String) }]);
  });
});

describe('gate steps', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['finish on a mark-list', { name: 'finish-replay', phase: 'replay', step: 'finish', type: 'mark-list', items: [{ name: 'done', text: 'Done' }] }, 'a finish gate is an approve gate named finish-replay'],
    ['finish under another name', { name: 'wrap-up', phase: 'replay', step: 'finish', type: 'approve' }, 'a finish gate is an approve gate named finish-replay'],
    ['a reopened finish gate numbered 1', { name: 'finish-replay-1', phase: 'replay', step: 'finish', type: 'approve' }, 'a finish gate is an approve gate named finish-replay'],
    ['a reopened finish gate with a leading zero', { name: 'finish-replay-02', phase: 'replay', step: 'finish', type: 'approve' }, 'a finish gate is an approve gate named finish-replay'],
    ["another phase's reopened finish gate", { name: 'finish-other-2', phase: 'replay', step: 'finish', type: 'approve' }, 'a finish gate is an approve gate named finish-replay'],
    ['guardrails without the log', { name: 'guardrails-replay', step: 'guardrails', type: 'mark-list', items: [{ name: 'done', text: 'Done' }] }, 'a guardrails gate carries "log": "guardrails"'],
    ['scope on an approve gate', { name: 'scope-replay', step: 'scope', type: 'approve' }, 'a scope gate is a mark-list'],
    ['spec without a document', { name: 'spec-replay', step: 'spec', type: 'approve' }, 'a spec gate is an approve gate with a document'],
    ['scope on a concept-pick', { name: 'scope-replay', step: 'scope', type: 'concept-pick', options: [{ name: 'quiet-board', label: 'Quiet', page: 'concepts/quiet-board.html' }, { name: 'loud-board', label: 'Loud', page: 'concepts/loud-board.html' }] }, 'a scope gate is a mark-list'],
    ['spec on a mark-list', { name: 'spec-replay', step: 'spec', type: 'mark-list', items: [{ name: 'done', text: 'Done' }], document: 'documents/specs/relay-rebuild-spec.md' }, 'a spec gate is an approve gate with a document'],
    ['finish with no phase, under another name', { name: 'wrap-up', step: 'finish', type: 'approve' }, 'a finish gate is an approve gate named finish-<phase>'],
    ['plan on a mark-list', { name: 'plan-replay', step: 'plan', type: 'mark-list', items: [{ name: 'done', text: 'Done' }] }, 'a plan gate is an approve gate with a document'],
    ['decommission on an approve gate without a document', { name: 'decommission-relay-rebuild', step: 'decommission', type: 'approve' }, 'a decommission gate is a mark-list or an approve gate, with a document'],
    ['decommission without a document', { name: 'decommission-relay-rebuild', step: 'decommission', type: 'mark-list', items: [{ name: 'done', text: 'Done' }] }, 'a decommission gate is a mark-list or an approve gate, with a document'],
  ])('refuses %s', (_label, fields, message) => {
    const root = exampleRepo();
    expect(() => openGate(root, B, { title: 't', why: 'w', ...fields } as GateInput, NOW)).toThrow(`: ${message}`);
  });
  it('accepts each step on the gate it describes', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'finish-replay', phase: 'replay', step: 'finish', type: 'approve', title: 'Finish replay', why: 'w' }, NOW);
    openGate(root, B, { name: 'scope-replay', step: 'scope', type: 'mark-list', title: 't', why: 'w', items: [{ name: 'done', text: 'Done' }] }, NOW);
    openGate(root, B, { name: 'spec-replay', step: 'spec', type: 'approve', title: 't', why: 'w', document: 'documents/specs/relay-rebuild-spec.md' }, NOW);
    openGate(root, B, { name: 'guardrails-replay', step: 'guardrails', log: 'guardrails', type: 'mark-list', title: 't', why: 'w', items: [{ name: 'replay-read-only', text: 'Replay never writes to the source systems' }] }, NOW);
    expect(readGate(root, B, 'finish-replay').step).toBe('finish');
  });
  it('accepts a decommission gate that approves the final report, for a build with no rule to ask about', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'decommission-relay-rebuild', step: 'decommission', type: 'approve', title: 't', why: 'w', document: 'documents/specs/relay-rebuild-spec.md' }, NOW);
    expect(readGate(root, B, 'decommission-relay-rebuild').type).toBe('approve');
  });
  it('accepts a finish gate with no phase when its name starts with finish-', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'finish-whatever', step: 'finish', type: 'approve', title: 't', why: 'w' }, NOW);
    expect(readGate(root, B, 'finish-whatever').step).toBe('finish');
  });
  it('accepts a reopened finish gate numbered from 2', () => {
    const root = exampleRepo();
    for (const name of ['finish-replay-2', 'finish-replay-10']) {
      openGate(root, B, { name, phase: 'replay', step: 'finish', type: 'approve', title: 'Finish replay', why: 'w' }, NOW);
      expect(readGate(root, B, name).step).toBe('finish');
    }
  });
  it('refuses a step that is not a known step', () => {
    const root = exampleRepo();
    expect(() => openGate(root, B, { name: 'review-replay', step: 'review', type: 'approve', title: 't', why: 'w' } as unknown as GateInput, NOW)).toThrow(/Gate request is invalid/);
  });
});

describe('a decommission gate', () => {
  const REPORT = 'documents/reports/relay-rebuild final report.md';
  const gate = (document: string): GateInput => ({
    name: 'decommission-relay-rebuild', step: 'decommission', type: 'mark-list', title: 'Decommission relay-rebuild',
    why: 'Mark what becomes governance.', document,
    items: [{ name: 'replay-read-only', text: 'Becomes a rule, tier always: replay never writes to the source systems.' }],
  });
  /** The example build with its last phase closed: finish approved, close-out, applied. Its draft report exists. */
  function closedRepo(): string {
    const root = exampleRepo();
    finishPhase(root);
    const report = join(root, '.build', B, REPORT);
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, '# relay-rebuild final report\n');
    return root;
  }
  it('opens, is answered and applies on a closed build, which stays finished', () => {
    const root = closedRepo();
    expect(activeBuilds(root)).toEqual([]);
    openGate(root, B, gate(REPORT), LATER);
    expect(readGate(root, B, 'decommission-relay-rebuild')).toMatchObject({ step: 'decommission', type: 'mark-list', document: REPORT });
    submitAnswers(root, B, 'decommission-relay-rebuild', { marks: { 'replay-read-only': 'accepted' } }, LATER);
    expect(applyAnswers(root, B, 'decommission-relay-rebuild', LATER).accepted).toEqual(['replay-read-only']);
    expect(readBuild(root, B).stage).toBe('close-out');
    expect(activeBuilds(root)).toEqual([]);
  });
  it('takes a document only from documents/ or notes/, and only Markdown', () => {
    const root = closedRepo();
    // decommission/files/ was the staging area of 1.1.0's first design; nothing writes there now.
    const staged = join(root, '.build', B, 'decommission', 'files', 'report.md');
    mkdirSync(dirname(staged), { recursive: true });
    writeFileSync(staged, '# report\n');
    expect(() => openGate(root, B, gate('decommission/files/report.md'), LATER)).toThrow(/Gate request is invalid/);
    expect(() => openGate(root, B, gate('documents/reports/../../build.json'), LATER)).toThrow(/Gate request is invalid/);
    expect(() => openGate(root, B, gate('documents/reports/report.json'), LATER)).toThrow(/Gate request is invalid/);
  });
  it('lets any mark-list carry a document', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'read-first', type: 'mark-list', title: 't', why: 'w', document: 'documents/specs/relay-rebuild-spec.md', items: [{ name: 'done', text: 'Done' }] }, NOW);
    expect(readGate(root, B, 'read-first').document).toBe('documents/specs/relay-rebuild-spec.md');
  });
});

describe('a gate with a finish name but no finish step', () => {
  const stepless = { name: 'finish-replay', type: 'approve' as const, title: 'Anything at all', why: 'w' };
  it("can't be answered, so it never lowers the wall", () => {
    const root = exampleRepo();
    writeFileSync(gatePath(root, B, 'finish-replay'), JSON.stringify({ ...stepless, opened: NOW }));
    let error: unknown = null;
    try {
      submitAnswers(root, B, 'finish-replay', { decision: 'approve' }, NOW);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      status: 409,
      message: `Gate "finish-replay" has a finish name but isn't a finish gate, so it can't be answered. Reopen it as finish-replay-2 (or the next number) with "step": "finish".`,
    });
    expect(existsSync(gatePath(root, B, 'finish-replay', true))).toBe(false);
    expect(() => changeStage(root, B, 'close-out', LATER)).toThrow(/finish-replay/);
    expect(activeBuilds(root)).toEqual([B]);
    const out = runGuard({ cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'CLAUDE.md') } }, { home: root, win: process.platform === 'win32', now: new Date(LATER) });
    expect(out).toContain('"permissionDecision":"deny"');
  });
  it("can't be answered when reopened under a numbered finish name either", () => {
    const root = exampleRepo();
    writeFileSync(gatePath(root, B, 'finish-replay-2'), JSON.stringify({ ...stepless, name: 'finish-replay-2', opened: NOW }));
    expect(() => submitAnswers(root, B, 'finish-replay-2', { decision: 'approve' }, NOW)).toThrow(/has a finish name but isn't a finish gate/);
    expect(existsSync(gatePath(root, B, 'finish-replay-2', true))).toBe(false);
  });
  it('is refused when opened', () => {
    const root = exampleRepo();
    expect(() => openGate(root, B, stepless, NOW)).toThrow('Gate "finish-replay": a finish-replay name is only for the finish gate; set "step": "finish".');
    expect(existsSync(gatePath(root, B, 'finish-replay'))).toBe(false);
  });
  it("leaves another phase's finish name to the usual rules", () => {
    const root = exampleRepo();
    openGate(root, B, { ...stepless, name: 'finish-other' }, NOW);
    expect(submitAnswers(root, B, 'finish-other', { decision: 'approve' }, NOW).decision).toBe('approve');
    expect(activeBuilds(root)).toEqual([B]);
  });
});

describe('row notes', () => {
  const scope = { name: 'pause-scope', type: 'mark-list' as const, title: 't', why: 'w', items: [{ name: 'pause-switch', text: 'Per-source pause switch' }, { name: 'dry-run', text: 'Dry-run mode' }] };
  it('copies each row note into the log entry its row creates', () => {
    const root = exampleRepo();
    openGate(root, B, scope, NOW);
    submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'research' }, notes: { 'dry-run': 'Needs a ticket first' } }, NOW);
    const summary = applyAnswers(root, B, 'pause-scope', NOW);
    expect(summary.rowNotes).toEqual({ 'dry-run': 'Needs a ticket first' });
    expect(readLog(root, B, 'questions').entries.find((e) => e.name === 'dry-run')?.note).toBe('Needs a ticket first');
    expect(readLog(root, B, 'decisions').entries.find((e) => e.name === 'pause-switch')?.note).toBeUndefined();
  });
  it('keeps guardrail row notes in the answers file and still reports them', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'guardrails-replay', log: 'guardrails', type: 'mark-list', title: 't', why: 'w', items: [{ name: 'replay-read-only', text: 'Replay never writes to the source systems' }] }, NOW);
    const before = readLog(root, B, 'guardrails');
    submitAnswers(root, B, 'guardrails-replay', { marks: { 'replay-read-only': 'declined' }, notes: { 'replay-read-only': 'Too strict for backfills' } }, NOW);
    expect(applyAnswers(root, B, 'guardrails-replay', NOW).rowNotes).toEqual({ 'replay-read-only': 'Too strict for backfills' });
    expect(readLog(root, B, 'guardrails')).toEqual(before);
  });
  it('refuses notes for rows that are not in the gate, and notes on other gate types', () => {
    const root = exampleRepo();
    openGate(root, B, scope, NOW);
    expect(() => submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'accepted' }, notes: { 'lag-alerts': 'x' } }, NOW)).toThrow('notes for rows that are not in the gate: lag-alerts');
    expect(() => submitAnswers(root, B, 'spec-review', { decision: 'approve', notes: { 'pause-switch': 'x' } }, NOW)).toThrow('row notes are only for mark-list and review gates');
  });
  it('refuses blank row notes', () => {
    const root = exampleRepo();
    openGate(root, B, scope, NOW);
    expect(() => submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'accepted' }, notes: { 'dry-run': '   ' } }, NOW)).toThrow(/Answers are invalid/);
  });
  it('accepts a row note of 2000 characters and refuses one of 2001', () => {
    const root = exampleRepo();
    openGate(root, B, scope, NOW);
    const marks = { 'pause-switch': 'accepted' as const, 'dry-run': 'accepted' as const };
    expect(() => submitAnswers(root, B, 'pause-scope', { marks, notes: { 'dry-run': 'x'.repeat(2001) } }, NOW)).toThrow(/Answers are invalid/);
    submitAnswers(root, B, 'pause-scope', { marks, notes: { 'dry-run': 'x'.repeat(2000) } }, NOW);
    expect(applyAnswers(root, B, 'pause-scope', NOW).rowNotes?.['dry-run']).toHaveLength(2000);
  });
  it('treats empty row notes as absent, even on a gate that takes none', () => {
    const root = exampleRepo();
    submitAnswers(root, B, 'spec-review', { decision: 'approve', notes: {} }, NOW);
    expect(applyAnswers(root, B, 'spec-review', NOW).rowNotes).toBeUndefined();
  });
  it('reads a row note only from the notes themselves, so a row named like an object property carries none', () => {
    const root = exampleRepo();
    // Row names are lowercase slugs, so constructor is the one prototype key a row can carry.
    const items = [{ name: 'constructor', text: 'A row named constructor' }, { name: 'dry-run', text: 'Dry-run mode' }];
    openGate(root, B, { name: 'odd-rows', type: 'mark-list', title: 't', why: 'w', items }, NOW);
    submitAnswers(root, B, 'odd-rows', { marks: JSON.parse('{"constructor":"research","dry-run":"accepted"}'), notes: { 'dry-run': 'Only this one' } }, NOW);
    expect(applyAnswers(root, B, 'odd-rows', NOW).rowNotes).toEqual({ 'dry-run': 'Only this one' });
    expect(readLog(root, B, 'questions').entries.find((e) => e.name === 'constructor')).not.toHaveProperty('note');
  });
  it('reports row notes in row order, whatever order they were submitted in', () => {
    const root = exampleRepo();
    openGate(root, B, scope, NOW);
    submitAnswers(root, B, 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'accepted' }, notes: { 'dry-run': 'second', 'pause-switch': 'first' } }, NOW);
    expect(Object.keys(applyAnswers(root, B, 'pause-scope', NOW).rowNotes ?? {})).toEqual(['pause-switch', 'dry-run']);
  });
  it('counts row notes in the waiting summary', () => {
    expect(summarize(null, { gate: 'g', submitted: NOW, marks: { a: 'accepted', b: 'declined' }, notes: { b: 'why' }, note: 'overall' })).toBe('1 accepted, 0 research, 1 declined; 1 row note; note: "overall"');
  });
});

describe('review gates', () => {
  it('never open in a build', () => {
    const root = exampleRepo();
    expect(() => openGate(root, 'relay-rebuild', { name: 'tidy-rules', type: 'review', title: 'x', why: 'y', items: [{ name: 'repo-claude', text: 'x', item: '0123456789ab', target: 'CLAUDE.md' }] }, NOW)).toThrow(/nexus review open/);
  });
  it('carry item and target only on review rows', () => {
    const root = exampleRepo();
    expect(() => openGate(root, 'relay-rebuild', { name: 'scope-look', type: 'mark-list', title: 'x', why: 'y', items: [{ name: 'repo-claude', text: 'x', target: 'CLAUDE.md' }] }, NOW)).toThrow(/invalid/);
  });
  it('a build gate drops client-supplied targets', () => {
    const root = exampleRepo();
    openGate(root, 'relay-rebuild', { name: 'scope-look', type: 'mark-list', title: 'x', why: 'y', items: [{ name: 'quiet-board', text: 'x' }] }, NOW);
    const a = submitAnswers(root, 'relay-rebuild', 'scope-look', { marks: { 'quiet-board': 'accepted' }, targets: { 'quiet-board': ['CLAUDE.md'] } }, NOW);
    expect(a.targets).toBeUndefined();
  });
});
