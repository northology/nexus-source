import { describe, it, expect } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { main, readStream, serveLines, USAGE, type CliIO } from '../scripts/cli.ts';
import { submitAnswers } from '../core/gates.ts';
import { tempDir, exampleRepo, finishPhase, treeHash, NOW } from './helpers.ts';

function io(cwd: string, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = {
    cwd,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    now: () => NOW,
    readStdin: async () => stdin,
    env: {},
  };
  return { value, out, err };
}

describe('nexus command', () => {
  it.each([
    [['log', 'status', 'questions', 'q', 'answered', '--topic', 'look'], /--topic is only used by `nexus log add`/],
    [['stage', 'build', '--commit', 'abc'], /--commit is only used by `nexus log add`/],
    [['gate', 'apply', 'look', '--note', 'x'], /--note is only used by `nexus log add` and `nexus guardrail propose`/],
  ])('refuses a flag the command does not use: %s', async (args, message) => {
    const s = io(exampleRepo());
    expect(await main(args, s.value)).toBe(1);
    expect(s.err.join(' ')).toMatch(message);
  });
  it.each([
    [['decommission', 'apply', 'relay-rebuild', '--check'], /--check is only used by/],
    [['stage', 'close-out', '--check'], /--check is only used by/],
    [['gate', 'open', 'request.json', '--check'], /--check is only used by/],
    [['log', 'add', 'issues', 'x', '--text', 't', '--status', 'open', '--source', 's', '--phase', 'phase-2'], /--phase is only used by `nexus new` and `nexus plan`/],
    [['check', '--quote', 'x'], /--quote is only used by/],
    [['builds', '--text', 'x'], /--text is only used by/],
    [['decommission', 'check', 'relay-rebuild', '--build', 'other'], /--build is only used by commands that act on the checkout's build/],
  ])('refuses every flag its usage line does not name, acting on nothing: %s', async (args, message) => {
    const root = exampleRepo();
    const before = treeHash(root);
    const s = io(root);
    expect(await main(args, s.value)).toBe(1);
    expect(s.err.join(' ')).toMatch(message);
    expect(treeHash(root)).toBe(before);
  });
  it('still takes the flags where they are used', async () => {
    const s = io(exampleRepo());
    expect(await main(['log', 'add', 'issues', 'flag-check', '--text', 't', '--status', 'open', '--source', 's', '--note', 'n', '--commit', 'abc1234'], s.value)).toBe(0);
  });
  it('doctor guard reports a guard bundle that is not built beside it', async () => {
    const s = io(tempDir());
    expect(await main(['doctor', 'guard'], s.value)).toBe(1);
    expect(s.err.join(' ')).toMatch(/FAIL  The guard bundle didn't load/);
    expect(s.out[0]).toMatch(/^Harness: Claude Code\. /);
  });
  it('refuses close-out without the phase finish gate', async () => {
    const root = exampleRepo();
    const t = io(root);
    expect(await main(['stage', 'close-out'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/approves the "finish-replay" gate/);
  });
  it('tags a log entry with a concept topic of the build, and refuses an unknown one', async () => {
    const root = exampleRepo();
    const add = (topic: string) => ['log', 'add', 'changes', 'tweak-legend', '--text', 'Wider legend', '--status', 'applied', '--source', 'live 14:02', '--topic', topic];
    expect(await main(add('look'), io(root).value)).toBe(0);
    const entries = (JSON.parse(readFileSync(join(root, '.build', 'relay-rebuild', 'logs', 'changes.json'), 'utf8')) as { entries: { name: string; topic?: string }[] }).entries;
    expect(entries.find((e) => e.name === 'tweak-legend')?.topic).toBe('look');
    const bad = io(root);
    expect(await main(add('nothing-here'), bad.value)).toBe(1);
    expect(bad.err[0]).toBe('nexus: No concept topic "nothing-here" in this build. Topics: look.');
    expect(USAGE).toContain('[--topic <t>]');
  });
  it('says a build with no concept-pick gate has no topics', async () => {
    const root = tempDir();
    await main(['new', 'relay-rebuild', '--branch', 'b'], io(root).value);
    const t = io(root);
    expect(await main(['log', 'add', 'changes', 'x', '--text', 't', '--status', 'applied', '--source', 's', '--topic', 'x'], t.value)).toBe(1);
    expect(t.err[0]).toBe('nexus: This build has no concept topics yet.');
  });
  it('prints usage with no arguments', async () => {
    const t = io(tempDir());
    expect(await main([], t.value)).toBe(2);
    expect(t.out.join('\n')).toMatch(/Usage/);
  });
  it('starts a build', async () => {
    const root = tempDir();
    const t = io(root);
    expect(await main(['new', 'relay-rebuild', '--summary', 'Retry and replay', '--branch', 'build/relay'], t.value)).toBe(0);
    expect(existsSync(join(root, '.build', 'relay-rebuild', 'build.json'))).toBe(true);
    expect(t.out[0]).toMatch(/Started build "relay-rebuild"/);
  });
  it('explains errors without a stack trace', async () => {
    const root = tempDir();
    await main(['new', 'relay-rebuild', '--branch', 'b'], io(root).value);
    const t = io(root);
    expect(await main(['new', 'relay-rebuild', '--branch', 'b'], t.value)).toBe(1);
    expect(t.err[0]).toBe('nexus: A build named "relay-rebuild" already exists');
  });
  it('rejects unknown options as a usage error', async () => {
    const t = io(tempDir());
    expect(await main(['new', 'relay-rebuild', '--colour', 'red'], t.value)).toBe(2);
  });
  it('says how to start when there is no build', async () => {
    const t = io(tempDir());
    expect(await main(['check'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/nexus new/);
  });
  it('asks for --build when a checkout has several', async () => {
    const root = exampleRepo();
    await main(['new', 'second-build', '--branch', 'b'], io(root).value);
    const t = io(root);
    expect(await main(['check'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/--build/);
    expect(await main(['check', '--build', 'second-build'], io(root).value)).toBe(0);
  });
  it('adds a log entry and changes its status', async () => {
    const root = exampleRepo();
    const add = ['log', 'add', 'questions', 'pause-switch', '--text', 'Per-source pause switch', '--status', 'exploring', '--source', 'chat 11:33'];
    expect(await main(add, io(root).value)).toBe(0);
    const t = io(root);
    expect(await main(['log', 'status', 'questions', 'pause-switch', 'research'], t.value)).toBe(0);
    expect(t.out[0]).toBe('"pause-switch" is now research');
  });
  it('opens a gate from a file and applies its answers', async () => {
    const root = exampleRepo();
    const file = join(root, 'pause-scope.json');
    writeFileSync(file, JSON.stringify({ name: 'pause-scope', type: 'mark-list', title: 'Confirm', why: 'Two points.', items: [{ name: 'pause-switch', text: 'Pause switch' }, { name: 'dry-run', text: 'Dry run' }] }));
    const opened = io(root);
    expect(await main(['gate', 'open', 'pause-scope.json'], opened.value)).toBe(0);
    expect(opened.out[0]).toMatch(/Opened gate "pause-scope"/);
    submitAnswers(root, 'relay-rebuild', 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'declined' } }, NOW);
    const applied = io(root);
    expect(await main(['gate', 'apply', 'pause-scope'], applied.value)).toBe(0);
    expect(applied.out[0]).toMatch(/Accepted: pause-switch/);
    expect(applied.out[0]).toMatch(/Declined: dry-run/);
  });
  it('prints row notes when it applies a gate', async () => {
    const root = exampleRepo();
    const file = join(root, 'pause-scope.json');
    writeFileSync(file, JSON.stringify({ name: 'pause-scope', type: 'mark-list', title: 'Confirm', why: 'Two points.', items: [{ name: 'pause-switch', text: 'Pause switch' }, { name: 'dry-run', text: 'Dry run' }] }));
    await main(['gate', 'open', 'pause-scope.json'], io(root).value);
    submitAnswers(root, 'relay-rebuild', 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'declined' }, notes: { 'dry-run': 'Not this phase' } }, NOW);
    const applied = io(root);
    expect(await main(['gate', 'apply', 'pause-scope'], applied.value)).toBe(0);
    expect(applied.out[0]).toContain('Row notes:\n- dry-run: Not this phase');
  });
  it('prints the questions a mark-list closes, and nothing when it closes none', async () => {
    const root = exampleRepo();
    const file = join(root, 'pause-scope.json');
    writeFileSync(file, JSON.stringify({ name: 'pause-scope', type: 'mark-list', title: 'Confirm', why: 'Two points.', items: [{ name: 'pause-switch', text: 'Pause switch' }, { name: 'dry-run', text: 'Dry run' }] }));
    await main(['gate', 'open', 'pause-scope.json'], io(root).value);
    await main(['log', 'add', 'questions', 'pause-switch', '--text', 'Pause switch?', '--status', 'exploring', '--source', 'chat'], io(root).value);
    submitAnswers(root, 'relay-rebuild', 'pause-scope', { marks: { 'pause-switch': 'accepted', 'dry-run': 'declined' } }, NOW);
    const applied = io(root);
    expect(await main(['gate', 'apply', 'pause-scope'], applied.value)).toBe(0);
    expect(applied.out[0]).toContain('Declined: dry-run\nClosed questions: pause-switch');
    expect(applied.out[0]).not.toContain('Reopened as questions:');
  });
  it('serve names the cockpit, then the origin concept pages are served from', () => {
    expect(serveLines({ url: 'http://127.0.0.1:4410/', assets: 'http://127.0.0.1:53817/' })).toEqual([
      'nexus cockpit: http://127.0.0.1:4410/',
      'nexus concept pages: http://127.0.0.1:53817/',
    ]);
  });
  it('prints a combine or none-of-these and what to do next when it applies a concept round', async () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', 'relay-rebuild', 'concepts', 'split-view.html'), '<p>split</p>');
    const gate = (name: string) => JSON.stringify({ name, type: 'concept-pick', topic: 'status-look', title: 'Pick', why: 'Pick.', options: [
      { name: 'quiet-board', label: 'Quiet board', page: 'concepts/quiet-board.html' },
      { name: 'split-view', label: 'Split view', page: 'concepts/split-view.html' },
    ] });
    for (const name of ['look-2', 'look-3']) {
      writeFileSync(join(root, `${name}.json`), gate(name));
      await main(['gate', 'open', `${name}.json`], io(root).value);
    }
    submitAnswers(root, 'relay-rebuild', 'look-2', { choices: ['quiet-board', 'split-view'] }, NOW);
    submitAnswers(root, 'relay-rebuild', 'look-3', { none: true, note: 'too cold' }, NOW);
    const combined = io(root);
    expect(await main(['gate', 'apply', 'look-2'], combined.value)).toBe(0);
    expect(combined.out[0]).toContain('Combine: quiet-board, split-view');
    expect(combined.out[0]).toContain('\nNext: Open the next round on topic "status-look" with new pages in concepts/status-look/, merging Quiet board and Split view.');
    const none = io(root);
    expect(await main(['gate', 'apply', 'look-3'], none.value)).toBe(0);
    expect(none.out[0]).toContain('None of these.');
    expect(none.out[0]).toContain("Note from the user: too cold\nNext: Open the next round on topic \"status-look\" with new pages in concepts/status-look/, using the user's note.");
  });
  it('check lists every problem and fails', async () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', 'relay-rebuild', 'logs', 'issues.json'), '{ broken');
    const t = io(root);
    expect(await main(['check'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/^logs\/issues.json: issues.json is not valid JSON/);
  });
  it('the hook command never fails, even on garbage input', async () => {
    const t = io(tempDir(), 'not json at all');
    expect(await main(['hook'], t.value)).toBe(0);
    expect(t.out).toEqual([]);
  });
  it('the hook command exits 0 and prints nothing when reading stdin fails', async () => {
    const t = io(tempDir());
    t.value.readStdin = () => Promise.reject(new Error('stdin broke'));
    expect(await main(['hook'], t.value)).toBe(0);
    expect(t.out).toEqual([]);
    expect(t.err).toEqual([]);
  });
  it('readStream collects a stream, and rejects when the stream errors instead of crashing', async () => {
    const ok = new PassThrough();
    const read = readStream(ok);
    ok.write('{"cwd":');
    ok.end('"x"}');
    expect(await read).toBe('{"cwd":"x"}');
    const broken = new PassThrough();
    const failed = readStream(broken);
    broken.destroy(new Error('stdin broke'));
    await expect(failed).rejects.toThrow('stdin broke');
  });
  it('the hook command exits 0 when the stdin stream itself errors', async () => {
    const t = io(tempDir());
    const broken = new PassThrough();
    t.value.readStdin = () => readStream(broken);
    const run = main(['hook'], t.value);
    broken.destroy(new Error('stdin broke'));
    expect(await run).toBe(0);
    expect(t.out).toEqual([]);
  });
  it('the hook names the command with forward slashes so the skill permission matches', async () => {
    const root = exampleRepo();
    submitAnswers(root, 'relay-rebuild', 'look', { choice: 'quiet-board' }, NOW);
    const out: string[] = [];
    const value: CliIO = { cwd: root, out: (l) => out.push(l), err: () => {}, now: () => NOW, readStdin: async () => JSON.stringify({ cwd: root }), env: { CLAUDE_PLUGIN_ROOT: 'C:\\plugins\\nexus\\' } };
    expect(await main(['hook'], value)).toBe(0);
    const context = JSON.parse(out[0] ?? '{}').hookSpecificOutput.additionalContext as string;
    expect(context).toContain('node "C:/plugins/nexus/bin/nexus.mjs" gate apply look --build relay-rebuild');
  });
  it('lists the builds in a checkout and whether each still holds the wall', async () => {
    const root = exampleRepo();
    const t = io(root);
    expect(await main(['builds'], t.value)).toBe(0);
    expect(t.out).toEqual(['relay-rebuild  phase replay  stage plan  active  build/relay-rebuild']);
    finishPhase(root);
    const f = io(root);
    await main(['builds'], f.value);
    expect(f.out[0]).toMatch(/stage close-out\s+finished/);
  });
  it('lists an unreadable build as active, with the reason', async () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', 'relay-rebuild', 'build.json'), '{ broken');
    const t = io(root);
    expect(await main(['builds'], t.value)).toBe(0);
    expect(t.out[0]).toMatch(/^relay-rebuild\s+unreadable: .+\s+active$/);
  });
  it('lines up readable and unreadable builds in one column and keeps one row per build', async () => {
    const root = exampleRepo();
    mkdirSync(join(root, '.build', 'a-much-longer-build-name'));
    writeFileSync(join(root, '.build', 'a-much-longer-build-name', 'build.json'), '{\n"broken": ');
    const t = io(root);
    expect(await main(['builds'], t.value)).toBe(0);
    expect(t.out).toHaveLength(2);
    const readable = t.out.find((l) => l.startsWith('relay-rebuild')) ?? '';
    const broken = t.out.find((l) => l.startsWith('a-much-longer-build-name')) ?? '';
    expect(readable.indexOf('phase replay')).toBeGreaterThan(0);
    expect(broken.indexOf('unreadable:')).toBeGreaterThan(0);
    expect(readable.indexOf('phase replay')).toBe(broken.indexOf('unreadable:'));
    expect(broken).not.toContain('\n');
  });
  it('says so when there are no builds', async () => {
    const t = io(tempDir());
    expect(await main(['builds'], t.value)).toBe(0);
    expect(t.out).toEqual(['No builds in this checkout.']);
  });
  it('new --check on an existing build fails with the same message as new and writes nothing', async () => {
    const root = exampleRepo();
    const before = treeHash(root);
    const plain = io(root);
    const checked = io(root);
    expect(await main(['new', 'relay-rebuild'], plain.value)).toBe(1);
    expect(await main(['new', 'relay-rebuild', '--check'], checked.value)).toBe(1);
    expect(checked.err).toEqual(plain.err);
    expect(treeHash(root)).toBe(before);
  });
  it('new --check validates without writing', async () => {
    const root = tempDir();
    mkdirSync(join(root, '.git'));
    const ok = io(root);
    expect(await main(['new', 'animation-test', '--phase', 'phase-one', '--check'], ok.value)).toBe(0);
    expect(ok.out).toEqual(['ok: would start build "animation-test" with phase "phase-one"']);
    expect(existsSync(join(root, '.build'))).toBe(false);
    const bad = io(root);
    expect(await main(['new', 'animation-test', '--phase', 'p1', '--check'], bad.value)).toBe(1);
    expect(bad.err[0]).toMatch(/phase name "p1" is not a readable name/);
  });
  it('phase start --check validates without writing', async () => {
    const root = exampleRepo();
    const refused = io(root);
    expect(await main(['phase', 'start', 'dashboard', '--check'], refused.value)).toBe(1);
    expect(refused.err[0]).toMatch(/still active/);
    finishPhase(root);
    const before = treeHash(root);
    const ok = io(root);
    expect(await main(['phase', 'start', 'dashboard', '--check'], ok.value)).toBe(0);
    expect(ok.out).toEqual(['ok: would start phase "dashboard" of build "relay-rebuild"']);
    expect(treeHash(root)).toBe(before);
  });
  it('phase status prints the phase, its steps and what to do next, and writes nothing', async () => {
    const root = exampleRepo();
    const before = treeHash(root);
    const t = io(root);
    expect(await main(['phase', 'status'], t.value)).toBe(0);
    const lines = t.out[0]!.split('\n');
    expect(lines[0]).toBe('relay-rebuild · phase replay · stage plan · branch build/relay-rebuild');
    expect(lines).toHaveLength(7);
    // The example's open gates carry no step, but an open gate still blocks the phase.
    expect(lines[6]).toBe('Next: look, spec-review are waiting in the cockpit. Tell the user, and stop until they answer.');
    expect(treeHash(root)).toBe(before);
  });
  it('an unknown phase action names both forms', async () => {
    const t = io(exampleRepo());
    expect(await main(['phase', 'resume'], t.value)).toBe(1);
    expect(t.err[0]).toMatch(/phase start <name>.*phase status/);
  });
});
