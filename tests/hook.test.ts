import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHook } from '../hooks/hook.ts';
import { addEntry } from '../core/logs.ts';
import { submitAnswers, gatePath, openGate } from '../core/gates.ts';
import { createBuild, setStage } from '../core/build.ts';
import { readReviewIndex, reviewPath, reviewsDir, writeReviewIndex } from '../core/review-files.ts';
import { writeJson } from '../core/store.ts';
import { ARTIFACTS, exampleRepo, finishPhase, tempDir, readJsonFile, LATER, NOW } from './helpers.ts';

const CLI = '/plugins/nexus/bin/nexus.mjs';

describe('hook', () => {
  it('says nothing outside a build checkout, quickly', () => {
    const started = performance.now();
    expect(runHook({ cwd: tempDir() }, { cli: CLI })).toBe('');
    expect(performance.now() - started).toBeLessThan(200);
  });
  it('says nothing without a usable cwd', () => {
    expect(runHook({}, { cli: CLI })).toBe('');
    expect(runHook({ cwd: 42 }, { cli: CLI })).toBe('');
  });
  it('names an active build whose build.json is unreadable, at stage unknown', () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', 'relay-rebuild', 'build.json'), '{ broken');
    const out = JSON.parse(runHook({ cwd: root }, { cli: CLI }));
    expect(out.hookSpecificOutput.additionalContext).toContain('nexus: build relay-rebuild · phase relay-rebuild · stage unknown');
  });
  it('gives one line per active build', () => {
    const root = exampleRepo();
    createBuild(root, { name: 'second-build', branch: 'build/second', now: NOW });
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text.split('\n').map((l) => l.split(' · ')[0])).toEqual(['nexus: build relay-rebuild', 'nexus: build second-build']);
  });
  it('with every answer applied, gives only the reminder', () => {
    const out = JSON.parse(runHook({ cwd: exampleRepo() }, { cli: CLI }));
    expect(out.hookSpecificOutput.additionalContext).toBe(
      'nexus: build relay-rebuild · phase replay · stage plan · 0 guardrails accepted · specs → .build/relay-rebuild/documents/specs/replay · plans → .build/relay-rebuild/documents/plans/replay · rules → nexus guardrail propose · show options → .build/relay-rebuild/concepts/<topic>/ + concept-pick gate; live refinements → log changes --topic',
    );
  });
  it('points at the specs folder while planning', () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'planning');
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).toContain('specs → .build/relay-rebuild/documents/specs/replay');
  });
  it('points at both folders in the plan stage, where the spec is written after the scope gate and then the plan', () => {
    const text: string = JSON.parse(runHook({ cwd: exampleRepo() }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).toContain('specs → .build/relay-rebuild/documents/specs/replay · plans → .build/relay-rebuild/documents/plans/replay');
  });
  it('says nothing once every build is finished through its approved finish gate', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(runHook({ cwd: root }, { cli: CLI })).toBe('');
  });
  it('still reminds when a stage is set to close-out without an approved finish answer', () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'close-out');
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).toMatch(/^nexus: build relay-rebuild · phase replay · stage close-out/);
  });
  it('adds the ledger import while building, and counts accepted guardrails', () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'build');
    openGate(root, 'relay-rebuild', { name: 'build-guardrails', type: 'mark-list', log: 'guardrails', title: 'x', why: 'y', items: [{ name: 'no-new-external-calls', text: 'No new external network calls without a gate' }] }, NOW);
    submitAnswers(root, 'relay-rebuild', 'build-guardrails', { marks: { 'no-new-external-calls': 'accepted' } }, NOW);
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    const lines = text.split('\n');
    expect(lines[0]).toBe('nexus: the user has submitted gate answers in the cockpit.');
    expect(lines.at(-1)).toBe(
      "nexus: build relay-rebuild · phase replay · stage build · 1 guardrail accepted · plans → .build/relay-rebuild/documents/plans/replay · rules → nexus guardrail propose · show options → .build/relay-rebuild/concepts/<topic>/ + concept-pick gate; live refinements → log changes --topic · ledger → nexus ledger import before deleting the run's workspace · finish → /nexus:plan step 5",
    );
  });
  it("drops the ledger nudge once the phase's ledger is imported", () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'build');
    addEntry(root, 'relay-rebuild', 'decisions', { name: 'ruling-keep-cap', text: 'Keep the cap', status: 'accepted', source: 'ruling · Task 3', time: NOW, phase: 'replay' });
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).not.toContain('ledger →');
    expect(text).toBe(
      'nexus: build relay-rebuild · phase replay · stage build · 0 guardrails accepted · plans → .build/relay-rebuild/documents/plans/replay · rules → nexus guardrail propose · show options → .build/relay-rebuild/concepts/<topic>/ + concept-pick gate; live refinements → log changes --topic · finish → /nexus:plan step 5',
    );
  });
  it('drops the ledger nudge for an entry from this phase whose source is exactly review', () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'build');
    addEntry(root, 'relay-rebuild', 'issues', { name: 'tidy-retry-log', text: 'Tidy the retry log', status: 'open', source: 'review', time: NOW, phase: 'replay' });
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).not.toContain('ledger →');
  });
  it("drops the ledger nudge once the phase's plan keeps an imported run, even one with no rulings or minors", () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'build');
    const record = { imported: NOW, ledger: '.superpowers/sdd/replay-plan/progress.md', tasks: { 't-0123abcd': { state: 'done', commits: 'a..b', note: null, parked: 0, fixRounds: [] } }, final: { rulings: 0, minors: 0 } };
    const plan = { id: 'p-0123abcd', phase: 'replay', gate: 'plan-replay', document: 'documents/plans/replay/replay-plan.md', title: 'Replay plan', indexed: NOW, tasks: [{ id: 't-0123abcd', number: 1, title: 'Queue', steps: 0 }], record };
    writeJson(join(root, '.build', 'relay-rebuild', 'plan.json'), { plans: [plan] });
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).not.toContain('ledger →');
  });
  it('keeps the ledger nudge when the imported entry is from another phase', () => {
    const root = exampleRepo();
    setStage(root, 'relay-rebuild', 'build');
    addEntry(root, 'relay-rebuild', 'decisions', { name: 'ruling-keep-cap', text: 'Keep the cap', status: 'accepted', source: 'ruling · plan', time: NOW, phase: 'earlier' });
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).toContain('ledger → nexus ledger import');
  });
  it('reports new answers from a nested folder, with the command to apply them', () => {
    const root = exampleRepo();
    submitAnswers(root, 'relay-rebuild', 'look', { choice: 'quiet-board', note: 'Calmer' }, NOW);
    const nested = join(root, 'src', 'app');
    mkdirSync(nested, { recursive: true });
    const out = JSON.parse(runHook({ cwd: nested }, { cli: CLI }));
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    const text: string = out.hookSpecificOutput.additionalContext;
    expect(text).toContain('relay-rebuild / look');
    expect(text).toContain('picked "Quiet board"; note: "Calmer"');
    expect(text).toContain(`node "${CLI}" gate apply look --build relay-rebuild`);
  });
  it('tells Claude to make a permitted change before applying, since applying closes the permit', () => {
    const root = exampleRepo();
    openGate(root, 'relay-rebuild', { name: 'claude-rule', type: 'approve', title: 't', why: 'w', permit: { target: 'CLAUDE.md', change: 'Add the replay rule' } }, NOW);
    submitAnswers(root, 'relay-rebuild', 'claude-rule', { decision: 'approve' }, NOW);
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI, now: new Date('2026-10-02T20:10:00Z') })).hookSpecificOutput.additionalContext;
    expect(text).toContain(
      `- relay-rebuild / claude-rule (submitted ${NOW}): approved permit for CLAUDE.md ("Add the replay rule"): make the change now, then apply with: node "${CLI}" gate apply claude-rule --build relay-rebuild`,
    );
    expect(text).not.toContain('Apply with');
  });
  it('says an expired permit has expired instead of asking for the change', () => {
    const root = exampleRepo();
    openGate(root, 'relay-rebuild', { name: 'claude-rule', type: 'approve', title: 't', why: 'w', permit: { target: 'CLAUDE.md', change: 'Add the replay rule' } }, NOW);
    submitAnswers(root, 'relay-rebuild', 'claude-rule', { decision: 'approve' }, NOW);
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI, now: new Date('2026-10-02T20:45:00Z') })).hookSpecificOutput.additionalContext;
    expect(text).toContain(
      `approved permit for CLAUDE.md ("Add the replay rule"): the permit expired at 2026-10-02T20:30:00.000Z; apply the gate with: node "${CLI}" gate apply claude-rule --build relay-rebuild, and open a new permit gate if the change is still needed`,
    );
    expect(text).not.toContain('make the change now');
  });
  it('reports an unreadable answers file', () => {
    const root = exampleRepo();
    writeFileSync(gatePath(root, 'relay-rebuild', 'look', true), '{ broken');
    const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
    expect(text).toMatch(/Could not read relay-rebuild\/gates\/look.answers.json/);
  });
  describe('reviews', () => {
    /** A review written as nexus writes one: the request and index entry, the answers when answered, `read` when applied. */
    function review(root: string, name: string, state: { answered?: boolean; read?: string | null } = {}): void {
      mkdirSync(reviewsDir(root), { recursive: true });
      writeJson(reviewPath(root, name), {
        name, type: 'review', title: 'Tidy', why: 'Mark each one.', opened: NOW,
        items: [{ name: 'old-rule', text: 'Old rule', item: '3f9a1c2e7b10', target: '.claude/rules/old.md' }],
      });
      if (state.answered) {
        writeJson(reviewPath(root, name, true), {
          gate: name, submitted: LATER, marks: { 'old-rule': 'declined' }, texts: { 'old-rule': 'Old rule' }, targets: { 'old-rule': ['.claude/rules/old.md'] },
        });
      }
      writeReviewIndex(root, { ...readReviewIndex(root), [name]: { opened: NOW, read: state.read ?? null } });
    }
    const line = (name: string): string =>
      `- review ${name} (submitted ${LATER}): read .nexus/reviews/${name}.answers.json, make the changes its Adjust and Remove rows ask for, then apply with: node "${CLI}" review apply ${name}`;
    const HEAD = 'nexus: the user has answered a review in the cockpit.';

    it('announces an answered review that is not applied yet, with no build, from a nested folder', () => {
      const root = tempDir();
      review(root, 'tidy-up', { answered: true });
      const nested = join(root, 'src', 'app');
      mkdirSync(nested, { recursive: true });
      const out = JSON.parse(runHook({ cwd: nested }, { cli: CLI }));
      expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
      expect(out.hookSpecificOutput.additionalContext).toBe([HEAD, line('tidy-up')].join('\n'));
    });
    it('says nothing about a review that was answered and applied', () => {
      const root = tempDir();
      review(root, 'tidy-up', { answered: true, read: '2026-10-02T15:00:00-06:00' });
      expect(runHook({ cwd: root }, { cli: CLI })).toBe('');
    });
    it('says nothing about a review that is open and not answered', () => {
      const root = tempDir();
      review(root, 'tidy-up');
      expect(runHook({ cwd: root }, { cli: CLI })).toBe('');
    });
    it('names only the reviews waiting, among several', () => {
      const root = tempDir();
      review(root, 'applied', { answered: true, read: '2026-10-02T15:00:00-06:00' });
      review(root, 'open');
      review(root, 'waiting', { answered: true });
      const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
      expect(text).toBe([HEAD, line('waiting')].join('\n'));
    });
    it('with a build active, lists the gate answer, then the review answer, then the reminder', () => {
      const root = exampleRepo();
      submitAnswers(root, 'relay-rebuild', 'look', { choice: 'quiet-board', note: 'Calmer' }, NOW);
      review(root, 'tidy-up', { answered: true });
      const lines = (JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext as string).split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe('nexus: the user has submitted gate answers in the cockpit.');
      expect(lines[1]).toContain(`node "${CLI}" gate apply look --build relay-rebuild`);
      expect(lines.slice(2, 4)).toEqual([HEAD, line('tidy-up')]);
      expect(lines[4]).toMatch(/^nexus: build relay-rebuild · phase replay · stage plan/);
    });
    it('skips a review whose answers cannot be read, without throwing, and still names the others', () => {
      const root = tempDir();
      review(root, 'broken', { answered: true });
      writeFileSync(reviewPath(root, 'broken', true), '{ broken');
      expect(runHook({ cwd: root }, { cli: CLI })).toBe('');
      review(root, 'tidy-up', { answered: true });
      expect(JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext).toBe([HEAD, line('tidy-up')].join('\n'));
    });
    it('says nothing when the index cannot be read, and the build reminder still shows', () => {
      const bare = tempDir();
      review(bare, 'tidy-up', { answered: true });
      writeFileSync(join(reviewsDir(bare), 'index.json'), '{ broken');
      expect(runHook({ cwd: bare }, { cli: CLI })).toBe('');
      const root = exampleRepo();
      review(root, 'tidy-up', { answered: true });
      writeFileSync(join(reviewsDir(root), 'index.json'), '[]');
      const text: string = JSON.parse(runHook({ cwd: root }, { cli: CLI })).hookSpecificOutput.additionalContext;
      expect(text).toMatch(/^nexus: build relay-rebuild · /);
      expect(text).not.toContain('review');
    });
    it('says nothing in a repo with an empty reviews folder and no build', () => {
      const root = tempDir();
      mkdirSync(reviewsDir(root), { recursive: true });
      expect(runHook({ cwd: root }, { cli: CLI })).toBe('');
    });
  });
  it('is registered in exec form so Windows needs no shell', () => {
    const config = readJsonFile(join(ARTIFACTS, 'hooks', 'hooks.json')) as {
      hooks: { UserPromptSubmit: { hooks: { type: string; command: string; args: string[]; timeout: number }[] }[] };
    };
    const hook = config.hooks.UserPromptSubmit[0]!.hooks[0]!;
    expect(hook).toMatchObject({ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs', 'hook'] });
    expect(hook.timeout).toBeLessThanOrEqual(10);
  });
});
