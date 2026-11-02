import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyDecommission } from '../core/decommission/apply.ts';
import { chosenDecisions } from '../core/decommission/build-record.ts';
import { revParse } from '../core/git.ts';
import { readLog } from '../core/logs.ts';
import { main, type CliIO } from '../scripts/cli.ts';
import { BUILD, decideGate, draftReport, finishedBuild, prepareTemplate, readyToApply } from './decommission-helpers.ts';
import { NOW } from './helpers.ts';
import { STANDARD } from './vault-helpers.ts';

// Removing the build folder after the commit fails while `held` is set: a folder something still holds open on Windows.
const held = vi.hoisted(() => ({ on: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    rmSync: (path: Parameters<typeof fs.rmSync>[0], opts?: Parameters<typeof fs.rmSync>[1]) => {
      if (held.on && String(path).replace(/\\/g, '/').endsWith(`.build/${BUILD}`)) throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${String(path)}'`), { code: 'EBUSY' });
      fs.rmSync(path, opts);
    },
  };
});

beforeAll(() => {
  prepareTemplate();
});

describe('a decommission row named like a decision', () => {
  it.each(['accepted', 'declined', 'research'] as const)('leaves the decision as it was when marked %s', (mark) => {
    const { root } = finishedBuild();
    draftReport(root);
    const before = readLog(root, BUILD, 'decisions').entries.find((e) => e.name === 'relay-choice');
    decideGate(root, BUILD, { 'relay-choice': mark });
    const decisions = readLog(root, BUILD, 'decisions').entries;
    expect(decisions.find((e) => e.name === 'relay-choice')).toEqual(before);
    expect(readLog(root, BUILD, 'questions').entries.some((e) => e.name === 'relay-choice')).toBe(false);
    expect(chosenDecisions(root, BUILD).map((e) => e.name)).toContain('relay-choice');
    // The gate's answers are its record; the decisions log keeps one line for the gate itself.
    expect(decisions.find((e) => e.name === `decommission-${BUILD}`)?.text).toMatch(new RegExp(`${mark}: relay-choice`));
  });
});

describe('a build folder held open after the decommission commit', () => {
  it('reports the commit and the folder left behind, instead of failing', () => {
    const { root, env } = readyToApply({ 'explicit-commits': 'accepted', 'no-network': 'declined' });
    held.on = true;
    try {
      const a = applyDecommission(root, BUILD, { standard: STANDARD, env });
      expect(a.commit).toBe(revParse(root, 'HEAD'));
      expect(a.left).toBe(`.build/${BUILD}`);
    } finally {
      held.on = false;
    }
  });
  it('says so on the command line, naming the commit', async () => {
    const { root, env } = readyToApply({ 'explicit-commits': 'accepted', 'no-network': 'declined' });
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env };
    held.on = true;
    try {
      expect(await main(['decommission', 'apply', BUILD], io)).toBe(0);
    } finally {
      held.on = false;
    }
    const head = revParse(root, 'HEAD')?.slice(0, 7) ?? '';
    expect(out.join('\n')).toContain(head);
    expect(out.join('\n')).toMatch(new RegExp(`\\.build/${BUILD}/ is still held open`));
    expect(out.join('\n')).toContain(`git clean -fd .build/${BUILD}/`);
    expect(err).toEqual([]);
  });
});
