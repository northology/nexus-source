import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setStage } from '../core/build.ts';
import { changeStage } from '../core/lifecycle.ts';
import { applyAnswers, openGate, submitAnswers } from '../core/gates.ts';
import { runGuard } from '../hooks/guard.ts';
import { ARTIFACTS, EXAMPLES, exampleRepo, finishPhase, readJsonFile, tempDir, NOW, LATER } from './helpers.ts';

const B = 'relay-rebuild';
const HOME = tempDir('nexus-home-');
const WIN = process.platform === 'win32';
const AT = new Date('2026-10-02T20:10:00Z');

function guard(cwd: string, tool: string, toolInput: unknown, now = AT): string {
  return runGuard({ cwd, tool_name: tool, tool_input: toolInput }, { home: HOME, win: WIN, now });
}
function decision(out: string): Record<string, string> {
  return out ? (JSON.parse(out) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput : {};
}
const denied = (out: string) => decision(out)['permissionDecision'] === 'deny';

describe('the wall during a build', () => {
  const root = exampleRepo();
  it.each<[string, string, Record<string, unknown>]>([
    ['Write to CLAUDE.md', 'Write', { file_path: 'CLAUDE.md' }],
    ['Edit of a nested CLAUDE.md', 'Edit', { file_path: join(root, 'packages', 'app', 'CLAUDE.md') }],
    ['MultiEdit of settings', 'MultiEdit', { file_path: join(root, '.claude', 'settings.local.json') }],
    ['NotebookEdit under rules', 'NotebookEdit', { notebook_path: join(root, '.claude', 'rules', 'x.ipynb') }],
    ['memory', 'Write', { file_path: join(HOME, '.claude', 'projects', 'some-project', 'memory', 'MEMORY.md') }],
    ['Bash redirect', 'Bash', { command: 'echo x >> CLAUDE.md' }],
    ['PowerShell Set-Content', 'PowerShell', { command: "Set-Content -Path AGENTS.md -Value 'x'" }],
    ['the repo config', 'Write', { file_path: join(root, '.nexus', 'config.json') }],
  ])('blocks %s', (_label, tool, input) => {
    const out = guard(root, tool, input);
    expect(decision(out)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(decision(out)['permissionDecisionReason']).toMatch(/nexus guardrail propose/);
  });
  it('blocks writes to the docs vault registry, and not to vault notes or the shipped standard', () => {
    expect(denied(guard(root, 'Write', { file_path: join(root, 'docs', '_meta', 'classes', 'decision.md') }))).toBe(true);
    expect(denied(guard(root, 'Bash', { command: 'echo x > docs/_meta/tags.md' }))).toBe(true);
    expect(denied(guard(root, 'Write', { file_path: join(root, 'docs', 'governance', 'decisions', 'x.md') }))).toBe(false);
    expect(denied(guard(root, 'Write', { file_path: join(root, 'standard', 'classes', 'decision.md') }))).toBe(false);
  });
  it.each<[string, string, Record<string, unknown>]>([
    ['the decision log', 'Write', { file_path: join(root, 'docs', 'governance', 'decisions.json') }],
    ['the issues log', 'Bash', { command: 'echo x > docs/governance/issues.json' }],
  ])("blocks %s: the repo's permanent record is written at decommission", (_label, tool, input) => {
    expect(decision(guard(root, tool, input))['permissionDecisionReason']).toMatch(/written at decommission.*nexus log add/);
  });
  it("blocks a build record: it is the build's final report, drafted in the build", () => {
    const out = guard(root, 'Write', { file_path: join(root, 'docs', 'governance', 'builds', 'relay-rebuild.md') });
    expect(decision(out)['permissionDecisionReason']).toMatch(/written at decommission.*documents\/reports\/relay-rebuild final report\.md/);
  });
  it('leaves the rest of docs/governance/ open: change entries and rule notes', () => {
    expect(guard(root, 'Write', { file_path: join(root, 'docs', 'governance', 'change', '2026-10-relay.md') })).toBe('');
    expect(guard(root, 'Write', { file_path: join(root, 'docs', 'governance', 'rules', 'x.md') })).toBe('');
  });
  it('blocks writes to gate answers, which only the cockpit writes', () => {
    const out = guard(root, 'Write', { file_path: join(root, '.build', B, 'gates', 'look.answers.json') });
    expect(decision(out)['permissionDecisionReason']).toMatch(/Only the cockpit writes gate answers/);
  });
  it.each<[string, string, Record<string, unknown>]>([
    ['an Edit', 'Edit', { file_path: join(root, '.build', B, 'build.json') }],
    ['a Write', 'Write', { file_path: '.build/relay-rebuild/build.json' }],
    ['a Bash redirect', 'Bash', { command: `echo '{}' > .build/${B}/build.json` }],
  ])('blocks %s of build.json: build state changes only through the CLI', (_label, tool, input) => {
    expect(decision(guard(root, tool, input))['permissionDecisionReason']).toMatch(/nexus stage.*nexus phase/);
  });
  it('blocks writes to plan.json, which only nexus commands write', () => {
    const out = guard(root, 'Write', { file_path: join(root, '.build', B, 'plan.json') });
    expect(denied(out)).toBe(true);
    expect(decision(out)['permissionDecisionReason']).toMatch(/only through nexus commands/);
    expect(decision(out)['permissionDecisionReason']).toContain('`nexus gate apply`, `nexus plan index`, `nexus ledger import`');
  });
  it('sends Superpowers output to the build', () => {
    const out = guard(root, 'Write', { file_path: join(root, 'docs', 'superpowers', 'specs', 'x.md') });
    expect(decision(out)['permissionDecisionReason']).toMatch(/documents\/specs/);
  });
  it.each<[string, string, Record<string, unknown>]>([
    ['ordinary source', 'Write', { file_path: join(root, 'src', 'app.ts') }],
    ['a gate request', 'Write', { file_path: join(root, '.build', B, 'gates', 'look.json') }],
    ['reading a rule into another file', 'Bash', { command: 'cat CLAUDE.md > notes.txt' }],
    ['a tool that does not write', 'Read', { file_path: 'CLAUDE.md' }],
  ])('allows %s', (_label, tool, input) => {
    expect(guard(root, tool, input)).toBe('');
  });
});

describe('path forms', () => {
  it.runIf(WIN)('refuses CLAUDE.md through drive-relative, cygdrive, mnt and own-host share forms', () => {
    const root = exampleRepo();
    const drive = root.slice(0, 1).toLowerCase();
    const rest = root.slice(2).replace(/\\/g, '/');
    for (const p of [`${drive.toUpperCase()}:CLAUDE.md`, `/cygdrive/${drive}${rest}/CLAUDE.md`, `/mnt/${drive}${rest}/CLAUDE.md`, `\\\\localhost\\${drive}$${rest.replace(/\//g, '\\')}\\CLAUDE.md`]) {
      expect(denied(guard(root, 'Write', { file_path: p })), p).toBe(true);
    }
  });
  it.runIf(WIN)('refuses a write through GLOBALROOT during a build, and says how to name it', () => {
    const root = exampleRepo();
    const out = guard(root, 'Write', { file_path: '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\x.txt' });
    expect(decision(out)['permissionDecisionReason']).toMatch(/can't tell which file .* is\. Name the file by its drive path\./);
  });
  it.runIf(WIN)('allows a write through GLOBALROOT when no build is active', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(guard(root, 'Write', { file_path: '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\x.txt' })).toBe('');
  });
});

describe("paths the guard can't see", () => {
  it('refuses an unknown folder when the visible part names a protected file, and says to name it', () => {
    const root = exampleRepo();
    expect(decision(guard(root, 'Bash', { command: 'rm "$D/CLAUDE.md"' }))['permissionDecisionReason']).toMatch(/can't tell which file …\/CLAUDE\.md is, and it could be a protected file during build "relay-rebuild"\. Name the path directly\./);
    expect(denied(guard(root, 'Bash', { command: 'for d in a b; do echo x > $d/.claude/rules/x.md; done' }))).toBe(true);
    expect(denied(guard(root, 'Bash', { command: 'cp x "$(pwd)/.claude/settings.json"' }))).toBe(true);
  });
  it('allows writes through variables whose visible part looks ordinary', () => {
    const root = exampleRepo();
    for (const command of ['rm $file', 'echo hi > $OUT/log.txt', 'out=$(mktemp); echo x > "$out"', 'for f in *.ts; do sed -i s/a/b/ "$f"; done', 'cp x "$dest"', 'ls | xargs -I{} rm {}']) {
      expect(guard(root, 'Bash', { command }), command).toBe('');
    }
    expect(guard(root, 'PowerShell', { command: 'Set-Content (Join-Path $a b) x' })).toBe('');
  });
  it('allows a write under a variable set in the environment', () => {
    const root = exampleRepo();
    const env = { NEXUS_TEST_DIR: join(root, 'scratch') };
    expect(runGuard({ cwd: root, tool_name: 'Bash', tool_input: { command: 'echo x > $NEXUS_TEST_DIR/out.txt' } }, { home: HOME, win: WIN, now: AT, env })).toBe('');
  });
  it('reads an environment variable that points at a protected file', () => {
    const root = exampleRepo();
    const env = { NEXUS_TEST_DIR: root };
    expect(denied(runGuard({ cwd: root, tool_name: 'Bash', tool_input: { command: 'echo x > $NEXUS_TEST_DIR/CLAUDE.md' } }, { home: HOME, win: WIN, now: AT, env }))).toBe(true);
  });
  it('allows unknown targets when no build is active', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(guard(root, 'Bash', { command: 'rm $file' })).toBe('');
  });
});

describe('opened concept pages', () => {
  const root = exampleRepo();
  const page = join(root, '.build', B, 'concepts', 'quiet-board.html');
  const REASON = 'concepts/quiet-board.html is in round "Pick a direction for the status page" already. Write the next round\'s pages as new files.';
  it.each<[string, string, Record<string, unknown>]>([
    ['Write', 'Write', { file_path: page }],
    ['Edit by a relative path', 'Edit', { file_path: '.build/relay-rebuild/concepts/quiet-board.html' }],
    ['Bash redirect', 'Bash', { command: 'echo x > .build/relay-rebuild/concepts/quiet-board.html' }],
  ])('refuses %s', (_l, tool, input) => {
    const out = guard(root, tool, input);
    expect(denied(out)).toBe(true);
    expect(decision(out)['permissionDecisionReason']).toBe(REASON);
  });
  it('refuses removing the folder, naming an opened page', () => {
    const out = guard(root, 'Bash', { command: 'rm -r .build/relay-rebuild/concepts' });
    expect(denied(out)).toBe(true);
    expect(decision(out)['permissionDecisionReason']).toMatch(/^concepts\/(quiet-board|dense-table)\.html is in round "Pick a direction for the status page" already\./);
  });
  it.runIf(WIN)('refuses a backslash, upper-case spelling of the page path', () => {
    const out = guard(root, 'Write', { file_path: page.replace(/\//g, '\\').toUpperCase() });
    expect(decision(out)['permissionDecisionReason']).toBe(REASON);
  });
  it("allows the next round's pages and unrelated files in the folder", () => {
    expect(guard(root, 'Write', { file_path: join(root, '.build', B, 'concepts', 'status-look', 'new.html') })).toBe('');
    expect(guard(root, 'Bash', { command: 'echo x > .build/relay-rebuild/concepts/scratch.html' })).toBe('');
  });
  it('refuses in the planning stage too', () => {
    const r = exampleRepo();
    setStage(r, B, 'planning');
    expect(decision(guard(r, 'Write', { file_path: join(r, '.build', B, 'concepts', 'quiet-board.html') }))['permissionDecisionReason']).toBe(REASON);
  });
  it('allows once the wall is down', () => {
    const r = exampleRepo();
    finishPhase(r);
    expect(guard(r, 'Write', { file_path: join(r, '.build', B, 'concepts', 'quiet-board.html') })).toBe('');
  });
});

describe('a session started above the repo', () => {
  it("still walls that repo's files, found from the file", () => {
    const root = exampleRepo();
    expect(denied(guard(tempDir(), 'Write', { file_path: join(root, 'CLAUDE.md') }))).toBe(true);
    expect(guard(tempDir(), 'Write', { file_path: join(root, 'src', 'app.ts') })).toBe('');
  });
});

describe('deletes and moves', () => {
  const root = exampleRepo();
  it.each<[string, string, string]>([
    ['rm -rf .claude', 'Bash', 'rm -rf .claude'],
    ['rm -rf .claude/rules', 'Bash', 'rm -rf .claude/rules'],
    ['mv CLAUDE.md old.md', 'Bash', 'mv CLAUDE.md old.md'],
    ['Remove-Item .claude -Recurse', 'PowerShell', 'Remove-Item .claude -Recurse'],
    ['Rename-Item .claude', 'PowerShell', 'Rename-Item .claude -NewName old-claude'],
    ['rm -rf .build', 'Bash', 'rm -rf .build'],
    ['rm -rf of a build folder', 'Bash', `rm -rf .build/${B}`],
    ['mv of a build folder', 'Bash', `mv .build/${B} .build/old-build`],
    ['rm of build.json', 'Bash', `rm .build/${B}/build.json`],
  ])('blocks %s', (_label, tool, command) => {
    expect(denied(guard(root, tool, { command }))).toBe(true);
  });
  it('names what a removed folder holds', () => {
    expect(decision(guard(root, 'Bash', { command: 'rm -rf .claude' }))['permissionDecisionReason']).toMatch(/\.claude.*protected/);
  });
  it.each([
    'rm -rf node_modules',
    'mv a.md b.md',
    'cp -r .claude backup',
    `rm -rf .build/${B}/files/scratch`,
  ])('allows %s', (command) => {
    expect(guard(root, 'Bash', { command })).toBe('');
  });
});

describe('answering gates from the shell', () => {
  const post = `curl -X POST -H "x-nexus-token: abc" -d '{}' http://127.0.0.1:4400/api/builds/${B}/gates/look/answers`;
  it('is refused while a build is active', () => {
    expect(decision(guard(exampleRepo(), 'Bash', { command: post }))['permissionDecisionReason']).toMatch(/Only the user answers gates/);
    expect(denied(guard(exampleRepo(), 'PowerShell', { command: `Invoke-WebRequest -Uri http://localhost:4400/api/builds/${B}/gates/look/answers -Method Post` }))).toBe(true);
  });
  it('is left alone outside a build, and other requests pass', () => {
    expect(guard(tempDir(), 'Bash', { command: post })).toBe('');
    expect(guard(exampleRepo(), 'Bash', { command: 'curl -s http://127.0.0.1:4400/api/builds' })).toBe('');
  });
});

describe('when the wall is down', () => {
  it('outside a build', () => {
    const cwd = tempDir();
    expect(guard(cwd, 'Write', { file_path: join(cwd, 'CLAUDE.md') })).toBe('');
  });
  it('once every build is finished through its approved finish gate', () => {
    const root = exampleRepo();
    finishPhase(root);
    expect(guard(root, 'Write', { file_path: 'CLAUDE.md' })).toBe('');
  });
  it('once a sent-back finish gate is reopened and approved', () => {
    const root = exampleRepo();
    const finish = (name: string) => ({ name, phase: 'replay', step: 'finish' as const, type: 'approve' as const, title: 'Finish replay', why: 'w' });
    openGate(root, B, finish('finish-replay'), NOW);
    submitAnswers(root, B, 'finish-replay', { decision: 'send-back' }, NOW);
    applyAnswers(root, B, 'finish-replay', LATER);
    expect(denied(guard(root, 'Write', { file_path: 'CLAUDE.md' }))).toBe(true);
    openGate(root, B, finish('finish-replay-2'), LATER);
    submitAnswers(root, B, 'finish-replay-2', { decision: 'approve' }, LATER);
    changeStage(root, B, 'close-out', LATER);
    applyAnswers(root, B, 'finish-replay-2', LATER);
    expect(guard(root, 'Write', { file_path: 'CLAUDE.md' })).toBe('');
  });
  it('stays up when a stage is set to close-out without an approved finish answer', () => {
    const root = exampleRepo();
    setStage(root, B, 'close-out');
    expect(denied(guard(root, 'Write', { file_path: 'CLAUDE.md' }))).toBe(true);
  });
  it('stays up when a build.json is unreadable', () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', B, 'build.json'), '{ nope');
    expect(denied(guard(root, 'Write', { file_path: 'CLAUDE.md' }))).toBe(true);
  });
});

describe('repo config targets', () => {
  it('add to the defaults', () => {
    const root = exampleRepo();
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus', 'config.json'), JSON.stringify({ protect: ['.remember/**'] }));
    expect(denied(guard(root, 'Write', { file_path: join(root, '.remember', 'now.md') }))).toBe(true);
    expect(denied(guard(root, 'Write', { file_path: 'CLAUDE.md' }))).toBe(true);
  });
});

describe('permits', () => {
  const permitted = () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'claude-rule', type: 'approve', title: 'Add the replay rule', why: 'Asked in chat.', permit: { target: 'CLAUDE.md', change: 'Add the replay rule' } }, NOW);
    return root;
  };
  it('a request alone grants nothing', () => {
    expect(denied(guard(permitted(), 'Write', { file_path: 'CLAUDE.md' }))).toBe(true);
  });
  it('an approved answer opens only its target, for 30 minutes, until applied', () => {
    const root = permitted();
    submitAnswers(root, B, 'claude-rule', { decision: 'approve' }, NOW);
    expect(guard(root, 'Write', { file_path: join(root, 'CLAUDE.md') })).toBe('');
    expect(guard(root, 'Edit', { file_path: 'CLAUDE.md' })).toBe('');
    expect(denied(guard(root, 'Write', { file_path: join(root, 'sub', 'CLAUDE.md') }))).toBe(true);
    expect(denied(guard(root, 'Write', { file_path: join(root, '.claude', 'settings.json') }))).toBe(true);
    expect(denied(guard(root, 'Write', { file_path: 'CLAUDE.md' }, new Date('2026-10-02T20:31:00Z')))).toBe(true);
    applyAnswers(root, B, 'claude-rule', LATER);
    expect(denied(guard(root, 'Write', { file_path: 'CLAUDE.md' }))).toBe(true);
  });
  it('never open build.json', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'build-file', type: 'approve', title: 'x', why: 'y', permit: { target: '.build/relay-rebuild/build.json', change: 'x' } }, NOW);
    submitAnswers(root, B, 'build-file', { decision: 'approve' }, NOW);
    expect(denied(guard(root, 'Write', { file_path: join(root, '.build', B, 'build.json') }))).toBe(true);
  });
  it("never open the repo's permanent record", () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'log-file', type: 'approve', title: 'x', why: 'y', permit: { target: 'docs/governance/issues.json', change: 'x' } }, NOW);
    submitAnswers(root, B, 'log-file', { decision: 'approve' }, NOW);
    expect(denied(guard(root, 'Write', { file_path: join(root, 'docs', 'governance', 'issues.json') }))).toBe(true);
  });
  it('never open answers files', () => {
    const root = exampleRepo();
    openGate(root, B, { name: 'answer-rule', type: 'approve', title: 'x', why: 'y', permit: { target: '.build/relay-rebuild/gates/look.answers.json', change: 'x' } }, NOW);
    submitAnswers(root, B, 'answer-rule', { decision: 'approve' }, NOW);
    expect(denied(guard(root, 'Write', { file_path: join(root, '.build', B, 'gates', 'look.answers.json') }))).toBe(true);
  });
});

describe('failure', () => {
  const flaky = (path: string) => {
    let first = true;
    return {
      get file_path() {
        if (first) {
          first = false;
          throw new Error('boom');
        }
        return path;
      },
    };
  };
  it('fails closed for a write that may touch a protected file, open for anything else', () => {
    const root = exampleRepo();
    expect(decision(guard(root, 'Write', flaky('CLAUDE.md')))['permissionDecisionReason']).toMatch(/guard failed \(boom\)/);
    expect(decision(guard(root, 'Write', flaky(join(root, '.build', 'relay-rebuild', 'plan.json'))))['permissionDecisionReason']).toMatch(/guard failed \(boom\)/);
    expect(guard(root, 'Write', flaky('src/app.ts'))).toBe('');
  });
  it("fails closed for the repo config's own protected targets too", () => {
    const root = exampleRepo();
    mkdirSync(join(root, '.nexus'));
    writeFileSync(join(root, '.nexus', 'config.json'), JSON.stringify({ protect: ['.Remember/**', '~/notes/rules.md', '**/secret-rules.md'] }));
    expect(decision(guard(root, 'Write', flaky(join(root, '.remember', 'now.md'))))['permissionDecisionReason']).toMatch(/guard failed \(boom\)/);
    expect(denied(guard(root, 'Write', flaky(join(HOME, 'notes', 'rules.md'))))).toBe(true);
    expect(denied(guard(root, 'Write', flaky(join(root, 'a', 'secret-rules.md'))))).toBe(true);
    expect(guard(root, 'Write', flaky('src/app.ts'))).toBe('');
  });
});

describe('registration', () => {
  it('runs on every writing tool, in exec form', () => {
    const config = readJsonFile(join(ARTIFACTS, 'hooks', 'hooks.json')) as {
      hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string; args: string[]; timeout: number }[] }[] };
    };
    const entry = config.hooks.PreToolUse[0];
    expect(entry?.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell');
    expect(entry?.hooks[0]).toMatchObject({ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/guard.mjs'] });
    expect(entry?.hooks[0]?.timeout).toBeLessThanOrEqual(10);
  });
});

describe('two repos at once', () => {
  it("walls another repo's files when the session's own repo has no active build", () => {
    const quiet = exampleRepo();
    finishPhase(quiet);
    const live = exampleRepo();
    expect(denied(guard(quiet, 'Write', { file_path: join(live, 'CLAUDE.md') }))).toBe(true);
  });
  it("walls another repo's answers files, anchored to that repo", () => {
    const here = exampleRepo();
    const other = exampleRepo();
    const out = guard(here, 'Write', { file_path: join(other, '.build', B, 'gates', 'x.answers.json') });
    expect(decision(out)['permissionDecisionReason']).toMatch(/Only the cockpit writes gate answers/);
  });
  it("walls another repo's docs/superpowers", () => {
    const here = exampleRepo();
    const other = exampleRepo();
    expect(denied(guard(here, 'Write', { file_path: join(other, 'docs', 'superpowers', 'x.md') }))).toBe(true);
  });
  it("a permit approved in the file's repo opens its target even from another active repo", () => {
    const here = exampleRepo();
    const other = exampleRepo();
    openGate(other, B, { name: 'claude-rule', type: 'approve', title: 't', why: 'w', permit: { target: 'CLAUDE.md', change: 'c' } }, NOW);
    submitAnswers(other, B, 'claude-rule', { decision: 'approve' }, NOW);
    expect(guard(here, 'Write', { file_path: join(other, 'CLAUDE.md') })).toBe('');
    expect(denied(guard(here, 'Write', { file_path: join(here, 'CLAUDE.md') }))).toBe(true);
  });
});

describe('deleting a folder that holds an active build', () => {
  function nested(): { parent: string; repo: string } {
    const parent = tempDir();
    const repo = join(parent, 'repo');
    mkdirSync(repo);
    cpSync(EXAMPLES, repo, { recursive: true });
    return { parent, repo };
  }
  it.each<[string, string, string]>([
    ['rm -rf of the repo', 'Bash', 'rm -rf repo'],
    ['Remove-Item of the repo', 'PowerShell', 'Remove-Item -Recurse -Force repo'],
    ['a move of the repo', 'Bash', 'mv repo ../elsewhere'],
  ])('refuses %s from outside it', (_label, tool, command) => {
    const { parent } = nested();
    expect(decision(guard(parent, tool, { command }))['permissionDecisionReason']).toBe(
      'Deleting or moving repo would remove the active build "relay-rebuild". Finish the build first.',
    );
  });
  it('refuses deleting the folder one level above the repo', () => {
    const { parent } = nested();
    const above = join(parent, '..');
    expect(denied(guard(above, 'Bash', { command: `rm -rf "${parent}"` }))).toBe(true);
  });
  it('allows it once the build is finished', () => {
    const { parent, repo } = nested();
    finishPhase(repo);
    expect(guard(parent, 'Bash', { command: 'rm -rf repo' })).toBe('');
  });
});

describe('renames and fetches', () => {
  const root = exampleRepo();
  it('refuses renaming a draft into CLAUDE.md', () => {
    expect(decision(guard(root, 'PowerShell', { command: 'Rename-Item draft.md CLAUDE.md' }))['permissionDecisionReason']).toMatch(/nexus guardrail propose/);
    expect(denied(guard(root, 'PowerShell', { command: 'ren draft.md CLAUDE.md' }))).toBe(true);
  });
  it('allows git fetch next to a grep for the token word', () => {
    expect(guard(root, 'Bash', { command: 'git fetch && grep nexus-token notes.txt' })).toBe('');
  });
});

describe("the wall during a build: other harnesses' rule files", () => {
  const root = exampleRepo();
  it.each<[string, string]>([
    ['GEMINI.md at the root', join(root, 'GEMINI.md')],
    ['a nested GEMINI.md', join(root, 'packages', 'app', 'GEMINI.md')],
    ['an Antigravity rule', join(root, '.agents', 'rules', 'x.md')],
    ['Antigravity workspace hooks', join(root, '.agents', 'hooks.json')],
    ['.agents/AGENTS.md', join(root, '.agents', 'AGENTS.md')],
    ['.agents/GEMINI.md', join(root, '.agents', 'GEMINI.md')],
    ['a project Codex config', join(root, '.codex', 'config.toml')],
    // Codex loads a folder's AGENTS.override.md in place of its AGENTS.md (research note, D8).
    ['a repo AGENTS.override.md', join(root, 'AGENTS.override.md')],
    ['a nested AGENTS.override.md', join(root, 'packages', 'app', 'AGENTS.override.md')],
    ['the global Codex AGENTS.md', join(HOME, '.codex', 'AGENTS.md')],
    ['the global Codex override', join(HOME, '.codex', 'AGENTS.override.md')],
    ['the global Codex config', join(HOME, '.codex', 'config.toml')],
    ['the global Antigravity AGENTS.md', join(HOME, '.gemini', 'AGENTS.md')],
    ['the global GEMINI.md', join(HOME, '.gemini', 'GEMINI.md')],
    ['a global Antigravity rule', join(HOME, '.gemini', 'config', 'rules', 'x.md')],
  ])('blocks %s', (_label, file) => {
    expect(denied(guard(root, 'Write', { file_path: file }))).toBe(true);
  });
  it('leaves .agents/skills alone', () => {
    expect(guard(root, 'Write', { file_path: join(root, '.agents', 'skills', 'x', 'SKILL.md') })).toBe('');
  });
});
