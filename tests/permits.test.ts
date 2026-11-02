import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readBuild, setStage } from '../core/build.ts';
import { applyAnswers, gatePath, openGate, submitAnswers } from '../core/gates.ts';
import { memoryKey } from '../core/governance/env.ts';
import { governanceInventory } from '../core/governance/inventory.ts';
import { activeBuilds, changeStage, finishApproved } from '../core/lifecycle.ts';
import { openPermits } from '../core/permits.ts';
import { startPhase } from '../core/phases.ts';
import { applyReview, openReview, submitReviewAnswers, reviewPath } from '../core/reviews.ts';
import { exampleRepo, finishPhase, tempDir, NOW, LATER } from './helpers.ts';
import { isolatedEnv, put } from './governance-helpers.ts';

const B = 'relay-rebuild';
const SUBMITTED = new Date(NOW);
const minutesAfter = (m: number) => new Date(SUBMITTED.getTime() + m * 60_000);
const permitGate = { name: 'claude-rule', type: 'approve' as const, title: 'Add the replay rule', why: 'You asked in chat.', permit: { target: 'CLAUDE.md', change: 'Add the replay rule' } };
const finishGate = (phase: string) => ({ name: `finish-${phase}`, step: 'finish' as const, type: 'approve' as const, title: `Finish ${phase}`, why: 'Merged.' });

describe('permits', () => {
  it('open only after the cockpit approves, and only for their target', () => {
    const root = exampleRepo();
    openGate(root, B, permitGate, NOW);
    expect(openPermits(root, minutesAfter(1))).toEqual([]);
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    expect(openPermits(root, minutesAfter(1))).toEqual([
      { build: B, gate: 'claude-rule', target: 'CLAUDE.md', change: 'Add the replay rule', until: '2026-10-02T20:30:00.000Z' },
    ]);
  });
  it('close after 30 minutes', () => {
    const root = exampleRepo();
    openGate(root, B, permitGate, NOW);
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    expect(openPermits(root, minutesAfter(29))).toHaveLength(1);
    expect(openPermits(root, minutesAfter(30))).toEqual([]);
  });
  it('close when the gate is applied', () => {
    const root = exampleRepo();
    openGate(root, B, permitGate, NOW);
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    applyAnswers(root, B, 'claude-rule', LATER);
    expect(openPermits(root, minutesAfter(1))).toEqual([]);
  });
  it('never open on a send-back', () => {
    const root = exampleRepo();
    openGate(root, B, permitGate, NOW);
    submitAnswers(root, B, 'claude-rule', { decision: 'send-back' }, NOW);
    expect(openPermits(root, minutesAfter(1))).toEqual([]);
  });
  it('belong only on approve gates', () => {
    const root = exampleRepo();
    const markList = { name: 'odd-gate', type: 'mark-list' as const, title: 'x', why: 'y', items: [{ name: 'some-row', text: 'x' }], permit: permitGate.permit };
    expect(() => openGate(root, B, markList, NOW)).toThrow(/invalid/);
  });
  it("keep the target the user approved when the request file is edited afterwards", () => {
    const root = exampleRepo();
    openGate(root, B, permitGate, NOW);
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    const file = gatePath(root, B, 'claude-rule');
    const request = JSON.parse(readFileSync(file, 'utf8'));
    request.permit.target = '.claude/settings.json';
    writeFileSync(file, JSON.stringify(request));
    expect(openPermits(root, minutesAfter(1)).map((p) => p.target)).toEqual(['CLAUDE.md']);
  });
  it.each([
    ['in the future', '2026-10-02T20:10:00Z'],
    ['not a real time', '2026-13-45T99:99Z'],
  ])('never open from an answer submitted %s', (_label, submitted) => {
    const root = exampleRepo();
    openGate(root, B, permitGate, NOW);
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    const file = gatePath(root, B, 'claude-rule', true);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), submitted }));
    expect(openPermits(root, minutesAfter(1))).toEqual([]);
  });
  it('are never stamped from a body-supplied permit on a gate without one', () => {
    const root = exampleRepo();
    openGate(root, B, finishGate('replay'), NOW);
    const answers = submitAnswers(root, B, 'finish-replay', { decision: 'approve', permit: { target: 'CLAUDE.md', change: 'sneaky' } }, NOW);
    expect(answers.permit).toBeUndefined();
    expect(JSON.parse(readFileSync(gatePath(root, B, 'finish-replay', true), 'utf8'))).not.toHaveProperty('permit');
    expect(openPermits(root, minutesAfter(1))).toEqual([]);
  });
});

describe('the finish gate', () => {
  it("is the current phase's, and required before close-out", () => {
    const root = exampleRepo();
    expect(() => changeStage(root, B, 'close-out', LATER)).toThrow(/finish-replay/);
    openGate(root, B, finishGate('replay'), NOW);
    expect(finishApproved(root, B)).toBe(false);
    submitAnswers(root, B, 'finish-replay', { decision: 'send-back' }, NOW);
    expect(() => changeStage(root, B, 'close-out', LATER)).toThrow(/finish-replay/);
  });
  it('lets the stage move once approved, and records the phase as finished', () => {
    const root = exampleRepo();
    openGate(root, B, finishGate('replay'), NOW);
    submitAnswers(root, B, 'finish-replay', { decision: 'approve' }, NOW);
    expect(changeStage(root, B, 'close-out', LATER).stage).toBe('close-out');
    expect(readBuild(root, B).phases?.[0]?.finished).toBe(LATER);
  });
  it("an earlier phase's finish gate doesn't finish the next phase", () => {
    const root = exampleRepo();
    openGate(root, B, finishGate('replay'), NOW);
    submitAnswers(root, B, 'finish-replay', { decision: 'approve' }, NOW);
    changeStage(root, B, 'close-out', LATER);
    startPhase(root, B, 'dashboard', { branch: 'b', now: LATER });
    expect(finishApproved(root, B)).toBe(false);
    expect(() => changeStage(root, B, 'close-out', LATER)).toThrow(/finish-dashboard/);
  });
  it('leaves other stage changes free', () => {
    expect(changeStage(exampleRepo(), B, 'build', LATER).stage).toBe('build');
  });
});

describe('active builds', () => {
  it('are every build not finished through its approved finish gate', () => {
    const root = exampleRepo();
    expect(activeBuilds(root)).toEqual([B]);
    finishPhase(root);
    expect(activeBuilds(root)).toEqual([]);
  });
  it('include a build whose stage was set to close-out without an approved finish answer', () => {
    const root = exampleRepo();
    setStage(root, B, 'close-out');
    expect(activeBuilds(root)).toEqual([B]);
    openGate(root, B, finishGate('replay'), NOW);
    submitAnswers(root, B, 'finish-replay', { decision: 'send-back' }, NOW);
    expect(activeBuilds(root)).toEqual([B]);
  });
  it("include a closed-out build whose finish answer names another gate, or whose phase isn't a plain name", () => {
    const root = exampleRepo();
    finishPhase(root);
    const answers = gatePath(root, B, 'finish-replay', true);
    const stamped = JSON.parse(readFileSync(answers, 'utf8'));
    writeFileSync(answers, JSON.stringify({ ...stamped, gate: 'finish-other' }));
    expect(activeBuilds(root)).toEqual([B]);
    writeFileSync(answers, JSON.stringify(stamped));
    expect(activeBuilds(root)).toEqual([]);
    const file = join(root, '.build', B, 'build.json');
    const build = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...build, phase: '../../x' }));
    expect(activeBuilds(root)).toEqual([B]);
  });
  it('include a build whose build.json is unreadable', () => {
    const root = tempDir();
    mkdirSync(join(root, '.build', 'broken-build'), { recursive: true });
    writeFileSync(join(root, '.build', 'broken-build', 'build.json'), '{ nope');
    expect(activeBuilds(root)).toEqual(['broken-build']);
  });
  it('skips an impossible submitted time instead of throwing', () => {
    const root = exampleRepo();
    openGate(root, 'relay-rebuild', { name: 'claude-rule', type: 'approve', title: 't', why: 'w', permit: { target: 'CLAUDE.md', change: 'x' } }, NOW);
    writeFileSync(gatePath(root, 'relay-rebuild', 'claude-rule', true), JSON.stringify({ gate: 'claude-rule', submitted: '2026-13-01T00:00:00Z', decision: 'approve', permit: { target: 'CLAUDE.md', change: 'x' } }));
    expect(() => openPermits(root, new Date('2026-10-02T20:05:00Z'))).not.toThrow();
    expect(openPermits(root, new Date('2026-10-02T20:05:00Z'))).toEqual([]);
  });
});

describe('review permits', () => {
  /** The example build (active) with a memory file, a rule file and a review of both plus CLAUDE.md, answered at NOW. */
  function reviewed(marks: Record<string, 'accepted' | 'research' | 'declined'>) {
    const root = exampleRepo();
    const env = { ...isolatedEnv(tempDir('nexus-review-env-')), ceiling: dirname(root) };
    put(root, { 'CLAUDE.md': '# Repo\n', '.claude/rules/old.md': '# Old\n' });
    const key = memoryKey(root);
    put(join(env.configDir, 'projects', key, 'memory'), { 'MEMORY.md': '- [Tidy](tidy.md)\n', 'tidy.md': 'Keep it tidy.\n' });
    const memory = `~/.claude/projects/${key}/memory`;
    const id = (location: string) => governanceInventory(root, env).items.find((i) => i.location === location)?.id ?? '';
    openReview(root, {
      name: 'tidy-up', type: 'review', title: 'Tidy', why: 'Mark each one.',
      items: [
        { name: 'repo-claude', text: 'CLAUDE.md', item: id('CLAUDE.md'), target: 'CLAUDE.md' },
        { name: 'tidy-file', text: 'Tidy memory', item: id(`${memory}/tidy.md`), target: `${memory}/tidy.md` },
        { name: 'old-rule', text: 'Old rule', item: id('.claude/rules/old.md'), target: '.claude/rules/old.md' },
      ],
    }, NOW, env);
    submitReviewAnswers(root, 'tidy-up', { marks, notes: { 'tidy-file': 'Shorter' } }, NOW, env);
    return { root, env, memory };
  }
  const reviewPermits = (root: string, at: Date) => openPermits(root, at).filter((p) => p.gate.startsWith('review:'));

  it('open each Adjust or Remove row\'s file, and a memory file\'s index, for 30 minutes', () => {
    const { root, memory } = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'research', 'old-rule': 'declined' });
    const until = '2026-10-02T20:30:00.000Z';
    expect(reviewPermits(root, minutesAfter(1))).toEqual([
      { build: '', gate: 'review:tidy-up', target: `${memory}/tidy.md`, change: 'Adjust: Shorter (review "tidy-up", row tidy-file)', until },
      { build: '', gate: 'review:tidy-up', target: `${memory}/MEMORY.md`, change: 'Adjust: Shorter (review "tidy-up", row tidy-file)', until },
      { build: '', gate: 'review:tidy-up', target: '.claude/rules/old.md', change: 'Remove (review "tidy-up", row old-rule)', until },
    ]);
    expect(reviewPermits(root, minutesAfter(30))).toEqual([]);
  });
  it('open nothing for Keep, and close once the review is applied', () => {
    const { root } = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'accepted', 'old-rule': 'declined' });
    expect(reviewPermits(root, minutesAfter(1)).map((p) => p.target)).toEqual(['.claude/rules/old.md']);
    applyReview(root, 'tidy-up', NOW);
    expect(reviewPermits(root, minutesAfter(1))).toEqual([]);
  });
  it('come from the answers file alone: a request changed afterwards widens nothing', () => {
    const { root } = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'accepted', 'old-rule': 'declined' });
    const file = reviewPath(root, 'tidy-up');
    const request = JSON.parse(readFileSync(file, 'utf8')) as { items: { target: string }[] };
    for (const row of request.items) row.target = 'CLAUDE.md';
    writeFileSync(file, JSON.stringify(request));
    expect(reviewPermits(root, minutesAfter(1)).map((p) => p.target)).toEqual(['.claude/rules/old.md']);
  });
  it('grant nothing for an answers time still to come, or an unreadable answers file', () => {
    const { root } = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'research', 'old-rule': 'declined' });
    expect(reviewPermits(root, minutesAfter(-1))).toEqual([]);
    writeFileSync(reviewPath(root, 'tidy-up', true), '{ nope');
    expect(reviewPermits(root, minutesAfter(1))).toEqual([]);
  });
  it('grant nothing once the index entry is gone, the index itself is gone, or its read time is not a time', () => {
    const index = (root: string) => join(dirname(reviewPath(root, 'tidy-up')), 'index.json');
    const applied = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'research', 'old-rule': 'declined' });
    applyReview(applied.root, 'tidy-up', NOW);
    rmSync(index(applied.root));
    expect(reviewPermits(applied.root, minutesAfter(1))).toEqual([]);
    const unindexed = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'research', 'old-rule': 'declined' });
    writeFileSync(index(unindexed.root), '{}');
    expect(reviewPermits(unindexed.root, minutesAfter(1))).toEqual([]);
    const garbled = reviewed({ 'repo-claude': 'accepted', 'tidy-file': 'research', 'old-rule': 'declined' });
    writeFileSync(index(garbled.root), JSON.stringify({ 'tidy-up': { opened: NOW, read: 'not a time' } }));
    expect(reviewPermits(garbled.root, minutesAfter(1))).toEqual([]);
  });
});
