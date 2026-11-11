// Serves the cockpit end-to-end fixtures, each on a fresh temp copy of the example build. Run by Playwright's
// webServer; also handy by hand (`pnpm serve:example`) to look at the cockpit with real data.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuild, setStage } from '../../core/build.ts';
import { decommissionGateName, reportDraft } from '../../core/decommission/paths.ts';
import { applyAnswers, openGate, submitAnswers } from '../../core/gates.ts';
import { memoryKey } from '../../core/governance/env.ts';
import { governanceInventory } from '../../core/governance/inventory.ts';
import { REGISTRY_ENTRIES } from '../../core/init/standard.ts';
import { addEntry } from '../../core/logs.ts';
import { startPhase } from '../../core/phases.ts';
import { openReview } from '../../core/reviews.ts';
// Every fixture's server reads an empty, temporary home (see e2e-server.ts): e2e never reads the real ~/.claude.
import { isolatedEnv, removePreviousRun, startE2eServer } from './e2e-server.ts';

const ARTIFACTS = fileURLToPath(new URL('../../', import.meta.url));
const EXAMPLES = join(ARTIFACTS, 'reference', 'examples');
const COCKPIT = join(ARTIFACTS, 'cockpit', 'dist');
const B = 'relay-rebuild';
const PORTS = { live: 4490, empty: 4491, broken: 4492, visual: 4493, watch: 4494, two: 4495, planning: 4497, gates: 4498, plan: 4499, concepts: 4489, repo: 4488, reviews: 4487, finished: 4486 };
// The servers are killed at the end of a run, so the run before this one left its temp folders: they go now.
const TEMP_LIST = join(ARTIFACTS, '.e2e', 'temp.json');
removePreviousRun(TEMP_LIST);

function plainCopy() {
  const root = mkdtempSync(join(tmpdir(), 'nexus-e2e-'));
  cpSync(EXAMPLES, root, { recursive: true });
  return root;
}

function exampleCopy() {
  const root = mkdtempSync(join(tmpdir(), 'nexus-e2e-'));
  cpSync(EXAMPLES, root, { recursive: true });
  openGate(
    root,
    B,
    {
      name: 'pause-scope',
      type: 'mark-list',
      title: 'Confirm the pause work',
      why: 'Three points from the afternoon chat. Mark each one, then submit.',
      items: [
        { name: 'pause-switch', text: 'Per-source pause switch', source: 'chat 14:10', quote: 'Being able to pause one noisy source would save us a lot of manual cleanup.' },
        { name: 'dry-run', text: 'Dry-run mode for replays', source: 'chat 14:12' },
        { name: 'lag-thresholds', text: 'Lag thresholds set per source', source: 'chat 14:15' },
      ],
    },
    '2026-10-02T20:20:00Z',
  );
  return root;
}

const roots = {
  live: exampleCopy(),
  empty: mkdtempSync(join(tmpdir(), 'nexus-e2e-empty-')),
  broken: exampleCopy(),
  visual: exampleCopy(),
  watch: exampleCopy(),
  two: exampleCopy(),
  planning: exampleCopy(),
  gates: plainCopy(),
  plan: plainCopy(),
  concepts: plainCopy(),
};
createBuild(roots.two, { name: 'second-build', summary: 'A second build in the same checkout', branch: 'build/second-build', now: '2026-10-02T20:30:00Z' });
writeFileSync(join(roots.broken, '.build', B, 'logs', 'issues.json'), '{ not json');
rmSync(join(roots.broken, '.build', B, 'documents', 'specs', 'relay-rebuild-spec.md'));

// planning: a second phase, static rules, a guardrail gate, a conflict note and a permit.
const P = roots.planning;
setStage(P, B, 'close-out');
startPhase(P, B, 'dashboard', { branch: 'build/dashboard', now: '2026-10-02T20:20:00Z' });
mkdirSync(join(P, '.nexus'), { recursive: true });
writeFileSync(join(P, '.nexus', 'config.json'), JSON.stringify({ staticRules: ['RULES.md'] }));
writeFileSync(join(P, 'RULES.md'), '# Working rules\n\n- Commit as the repo owner.\n- Never push without a go.\n');
mkdirSync(join(P, '.build', B, 'documents', 'specs', 'dashboard'), { recursive: true });
writeFileSync(join(P, '.build', B, 'documents', 'specs', 'dashboard', 'dashboard-spec.md'), '# Dashboard spec\n\nLag per source, at a glance.\n');
addEntry(P, B, 'decisions', { name: 'lag-chart', text: 'Show lag per source as a small chart', status: 'accepted', source: 'chat 14:30', time: '2026-10-02T20:31:00Z', phase: 'dashboard' });
addEntry(P, B, 'decisions', { name: 'replay-cap', text: 'Cap replays at 10,000 messages', status: 'accepted', source: 'chat 11:40', time: '2026-10-02T17:40:00Z', phase: 'replay' });
openGate(P, B, { name: 'build-guardrails', type: 'mark-list', log: 'guardrails', title: 'Confirm this phase’s guardrails', why: 'Two guardrails drafted for this phase. Mark each one.', items: [
  { name: 'no-new-external-calls', text: 'No new external network calls without a gate' },
  { name: 'replay-read-only', text: 'Replay never writes to the source systems' },
] }, '2026-10-02T20:25:00Z');
openGate(P, B, { name: 'scope-check', type: 'mark-list', title: 'Confirm the dashboard scope', why: 'One point conflicts with an accepted guardrail.', items: [
  { name: 'replay-from-dashboard', text: 'Replay a source straight from the dashboard', source: 'chat 14:40', conflicts: ['replay-read-only'] },
] }, '2026-10-02T20:26:00Z');
mkdirSync(join(P, '.build', B, 'documents', 'specs', 'replay'), { recursive: true });
writeFileSync(join(P, '.build', B, 'documents', 'specs', 'replay', 'replay-notes.md'), '# Replay notes\n\nHow replays are capped.\n');
openGate(P, B, { name: 'replay-notes-review', type: 'approve', title: 'Review the replay notes', why: 'Notes from the replay phase still need your sign-off.', document: 'documents/specs/replay/replay-notes.md' }, '2026-10-02T20:28:00Z');
openGate(P, B, { name: 'claude-rule', type: 'approve', title: 'Add the replay rule to CLAUDE.md', why: 'You asked for this in chat.', permit: { target: 'CLAUDE.md', change: 'Add "Replay never writes to the sources" under Working agreements' } }, '2026-10-02T20:27:00Z');

// gates: two phases with standard gates in each, for the tabs, the phase filter and row notes.
const G = roots.gates;
setStage(G, B, 'close-out');
startPhase(G, B, 'dashboard', { branch: 'build/relay-rebuild-dashboard', now: '2026-10-02T20:20:00Z' });
const guardrail = (name, text) => ({ name, text });
openGate(G, B, { name: 'guardrails-replay', step: 'guardrails', log: 'guardrails', phase: 'replay', type: 'mark-list', title: 'Confirm the replay guardrails', why: 'Mark each one.', items: [guardrail('no-new-external-calls', 'No new external network calls without a gate')] }, '2026-10-02T19:10:00Z');
submitAnswers(G, B, 'guardrails-replay', { marks: { 'no-new-external-calls': 'accepted' } }, '2026-10-02T19:12:00Z');
applyAnswers(G, B, 'guardrails-replay', '2026-10-02T19:13:00Z');
openGate(G, B, { name: 'scope-replay', step: 'scope', phase: 'replay', type: 'mark-list', title: 'Confirm the replay scope', why: 'One piece.', items: [{ name: 'replay-cap', text: 'Cap replays at 10,000 messages' }] }, '2026-10-02T19:20:00Z');
submitAnswers(G, B, 'scope-replay', { marks: { 'replay-cap': 'accepted' } }, '2026-10-02T19:22:00Z');
applyAnswers(G, B, 'scope-replay', '2026-10-02T19:23:00Z');
openGate(G, B, { name: 'notes-check', phase: 'dashboard', type: 'mark-list', title: 'Check the dashboard copy', why: 'Two lines of copy.', items: [{ name: 'empty-copy', text: 'Empty state says "No lag yet"' }, { name: 'error-copy', text: 'Errors name the source' }] }, '2026-10-02T20:21:00Z');
// An open plan gate in the other phase (a red count under the dashboard filter), and two row-note gates no other spec answers.
openGate(G, B, { name: 'plan-replay', step: 'plan', phase: 'replay', type: 'approve', title: 'Approve the replay plan', why: 'Order of the replay work.', document: 'documents/specs/relay-rebuild-spec.md' }, '2026-10-02T19:30:00Z');
openGate(G, B, { name: 'notes-blank', phase: 'replay', type: 'mark-list', title: 'Check the replay copy', why: 'Two lines of copy.', items: [{ name: 'blank-copy', text: 'Replay banner says "Replaying"' }, { name: 'kept-copy', text: 'Replay ends with a summary' }] }, '2026-10-02T19:31:00Z');
openGate(G, B, { name: 'notes-keys', phase: 'replay', type: 'mark-list', title: 'Check the replay keys', why: 'One line of copy.', items: [{ name: 'keys-copy', text: 'Replay has a stop button' }] }, '2026-10-02T19:32:00Z');
openGate(G, B, { name: 'guardrails-dashboard', step: 'guardrails', log: 'guardrails', phase: 'dashboard', type: 'mark-list', title: 'Confirm the dashboard guardrails', why: 'Mark each one.', items: [guardrail('replay-read-only', 'Replay never writes to the source systems')] }, '2026-10-02T20:22:00Z');
openGate(G, B, { name: 'scope-dashboard', step: 'scope', phase: 'dashboard', type: 'mark-list', title: 'Confirm the dashboard scope', why: 'Two pieces.', items: [{ name: 'lag-chart', text: 'Show lag per source as a small chart' }, { name: 'per-source-colour', text: 'One colour per source' }] }, '2026-10-02T20:40:00Z');
// An answered gate alone in its tab (spec, replay), for a tab named in the URL with no open gate.
openGate(G, B, { name: 'spec-replay', step: 'spec', phase: 'replay', type: 'approve', title: 'Approve the replay spec', why: 'Sign off the replay spec.', document: 'documents/specs/relay-rebuild-spec.md' }, '2026-10-02T19:40:00Z');
submitAnswers(G, B, 'spec-replay', { decision: 'approve' }, '2026-10-02T19:42:00Z');
applyAnswers(G, B, 'spec-replay', '2026-10-02T19:43:00Z');

// plan: an approved, indexed plan in phase replay, at stage build, with a live run ledger.
const PLAN_DOC = `# Replay Queue Implementation Plan

**Goal:** Retry failed relays and replay a source's last seven days.

### Task 1: Retry policy

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Retry up to three times**
- [ ] **Step 3: Commit**

### Task 2: Replay queue

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Keep seven days**
- [ ] **Step 3: Run the tests**
- [ ] **Step 4: Commit**

### Task 3: Lag per source

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Read lag from the relay clock**
- [ ] **Step 3: Commit**

### Task 4: Replay screen

- [ ] **Step 1: Add the screen**
- [ ] **Step 2: Add the stop button**
- [ ] **Step 3: Write the e2e test**
- [ ] **Step 4: Run it**
- [ ] **Step 5: Commit**

### Task 5: Browser checks

- [ ] **Step 1: Check each source**
- [ ] **Step 2: Write the report**
`;
const RUN_LEDGER = `# SDD ledger — plan: .build/relay-rebuild/documents/plans/replay/replay-plan.md
Task 1: complete (commits 1a2b3c4..5d6e7f8, review clean)
Task 2: fix round 1/5 (2 addressed, 0 open; commits 5d6e7f8..9a8b7c6)
Task 2: Ruling: keep seven days of replays — the scope gate set it — a config change later
Task 2: minor (deferred): the queue table could sort by source
Task 2: complete (commits 5d6e7f8..9a8b7c6, review clean)
Task 3: fix round 1/5 (1 addressed, 1 open — lag is read from the wrong clock; commits 9a8b7c6..2c3d4e5)
Task 3: fix round 2/5 (0 addressed, 1 open — lag is read from the wrong clock; commits 2c3d4e5..3d4e5f6)
`;
const L = roots.plan;
mkdirSync(join(L, '.build', B, 'documents', 'plans', 'replay'), { recursive: true });
writeFileSync(join(L, '.build', B, 'documents', 'plans', 'replay', 'replay-plan.md'), PLAN_DOC);
openGate(L, B, { name: 'plan-replay', step: 'plan', phase: 'replay', type: 'approve', title: 'Approve the replay plan', why: 'The order of the replay work.', document: 'documents/plans/replay/replay-plan.md' }, '2026-10-02T19:30:00Z');
submitAnswers(L, B, 'plan-replay', { decision: 'approve' }, '2026-10-02T19:32:00Z');
applyAnswers(L, B, 'plan-replay', '2026-10-02T19:33:00Z');
setStage(L, B, 'build');
mkdirSync(join(L, '.superpowers', 'sdd', 'replay-plan'), { recursive: true });
writeFileSync(join(L, '.superpowers', 'sdd', 'replay-plan', 'progress.md'), RUN_LEDGER);
// The plan summary shows the ledger's modified time. It's masked in screenshots, but the mask is as wide as the text,
// so the time is fixed here: a date whose day gains a digit would otherwise move the mask's edge.
const LEDGER_READ = new Date('2026-10-02T20:41:00Z');
utimesSync(join(L, '.superpowers', 'sdd', 'replay-plan', 'progress.md'), LEDGER_READ, LEDGER_READ);
// concepts: a three-round topic (none, combine, pick) in phase replay, refined there and in the later phase
// dashboard, an open one-round topic, a page no gate uses, and the example's open look round. Static pages, solid
// colour blocks and a heading, so the frames hold still.
const C = roots.concepts;
const conceptPage = (path, title, colours) => {
  const blocks = colours.map((c) => `<div style="flex:1;background:${c}"></div>`).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;font-family:sans-serif}body{display:flex;flex-direction:column}h1{margin:0;padding:32px 40px;font-size:48px}main{flex:1;display:flex;gap:16px;padding:0 40px 40px}</style></head>
<body><h1>${title}</h1><main>${blocks}</main></body></html>
`;
  const parts = path.split('/');
  mkdirSync(join(C, '.build', B, 'concepts', ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(C, '.build', B, 'concepts', ...parts), html);
};
const conceptOptions = (topic, list) =>
  list.map(([name, label, source, colours]) => {
    conceptPage(`${topic}/${name}.html`, label, colours);
    return { name, label, page: `concepts/${topic}/${name}.html`, source };
  });
const lookRound = (name, why, options, opened) =>
  openGate(C, B, { name, type: 'concept-pick', topic: 'status-look', phase: 'replay', title: 'Pick a look for the lag view', why, options }, opened);
lookRound('status-look-1', 'Three directions for the status page.', conceptOptions('status-look', [
  ['signal-wall', 'Signal wall', 'impeccable', ['#1d2b3a', '#3c5a78']],
  ['ledger', 'Ledger', 'superpowers', ['#e8e4da', '#9a9384']],
  ['night-shift', 'Night shift', 'self', ['#101418', '#2f4f4f']],
]), '2026-10-02T19:00:00Z');
submitAnswers(C, B, 'status-look-1', { none: true, note: 'Too cold for an ops screen' }, '2026-10-02T19:01:00Z');
applyAnswers(C, B, 'status-look-1', '2026-10-02T19:01:30Z');
lookRound('status-look-2', 'Three warmer directions, after your note.', conceptOptions('status-look', [
  ['calm-board', 'Calm board', 'impeccable', ['#f3efe6', '#c9b79c']],
  ['stacked-list', 'Stacked list', 'superpowers', ['#f6f6f2', '#b8c4b0', '#8aa08a']],
  ['split-detail', 'Split detail', 'self', ['#efe9e1', '#d08c60']],
]), '2026-10-02T19:02:00Z');
submitAnswers(C, B, 'status-look-2', { choices: ['calm-board', 'split-detail'], note: 'The calm board with the split detail' }, '2026-10-02T19:03:00Z');
applyAnswers(C, B, 'status-look-2', '2026-10-02T19:03:30Z');
lookRound('status-look-3', 'The calm board and the split detail, merged two ways.', conceptOptions('status-look', [
  ['board-left', 'Board left', 'impeccable', ['#f3efe6', '#d08c60', '#c9b79c']],
  ['board-top', 'Board top', 'self', ['#d08c60', '#f3efe6']],
]), '2026-10-02T19:04:00Z');
submitAnswers(C, B, 'status-look-3', { choice: 'board-top' }, '2026-10-02T19:05:00Z');
applyAnswers(C, B, 'status-look-3', '2026-10-02T19:05:30Z');
openGate(C, B, { name: 'legend-1', type: 'concept-pick', topic: 'legend', phase: 'replay', title: 'Pick the lag legend', why: 'Two ways to show lag per source.', options: conceptOptions('legend', [
  ['lag-bars', 'Lag bars', 'impeccable', ['#2f4f4f', '#7fa3a3', '#d9e4e4']],
  ['lag-dots', 'Lag dots', 'self', ['#5c5c59', '#d9d9d5']],
]) }, '2026-10-02T19:06:00Z');
// Live-mode refinements on the status-look topic: one in phase replay, where its rounds are, and one in a later
// phase, dashboard, which has no rounds of it. The current phase is dashboard.
addEntry(C, B, 'changes', { name: 'warmer-legend', text: 'Warmed the legend colours after trying a live variant', status: 'applied', source: 'live 14:02', time: '2026-10-02T20:02:00Z', phase: 'replay', topic: 'status-look' });
setStage(C, B, 'close-out');
startPhase(C, B, 'dashboard', { branch: 'build/relay-rebuild-dashboard', now: '2026-10-02T20:20:00Z' });
addEntry(C, B, 'changes', { name: 'tighter-rows', text: 'Tightened the row spacing on the dashboard', status: 'applied', source: 'live 15:10', time: '2026-10-02T21:10:00Z', phase: 'dashboard', topic: 'status-look' });
conceptPage('scratch.html', 'Scratch', ['#c2301f', '#f5f5f3']);
// A page in no round that loads a sibling font, module and data file, each setting a field on window.check. These
// load only when the page keeps an origin of its own (an opaque origin's requests fail CORS).
const CHECK = join(C, '.build', B, 'concepts', 'assets-check');
mkdirSync(CHECK, { recursive: true });
const woff2 = readdirSync(join(COCKPIT, 'assets')).find((f) => f.endsWith('.woff2'));
if (!woff2) throw new Error('No .woff2 in cockpit/dist/assets; build the cockpit first (pnpm cockpit)');
copyFileSync(join(COCKPIT, 'assets', woff2), join(CHECK, 'check.woff2'));
writeFileSync(join(CHECK, 'mod.js'), "export const value = 'module loaded';\n");
writeFileSync(join(CHECK, 'data.json'), '{ "data": "fetched" }\n');
writeFileSync(
  join(CHECK, 'page.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Assets check</title>
<style>@font-face { font-family: Check; src: url(check.woff2) } body { font-family: Check, sans-serif }</style></head>
<body><h1>Assets check</h1>
<script>
window.check = {};
document.fonts.load('16px Check').then((faces) => { window.check.font = faces.length === 1; }, () => { window.check.font = false; });
fetch('data.json').then((r) => r.json()).then((d) => { window.check.data = d; }, (e) => { window.check.data = String(e); });
</script>
<script type="module">
import { value } from './mod.js';
window.check.module = value;
</script>
</body></html>
`,
);
// repo: the example build plus a vault, governance notes, five declared views with sample data, and the
// instruction files and memory the inventory lists. CLAUDE.md and .claude/rules/ exist only here, at run time.
function repoCopy() {
  const R = mkdtempSync(join(tmpdir(), 'nexus-e2e-repo-'));
  cpSync(EXAMPLES, R, { recursive: true });
  for (const e of REGISTRY_ENTRIES) cpSync(join(ARTIFACTS, 'standard', e), join(R, 'docs', '_meta', e), { recursive: true });
  const write = (rel, text) => {
    mkdirSync(join(R, ...rel.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(R, ...rel.split('/')), text);
  };
  const fm = (props, body) => `---\n${Object.entries(props).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}\n---\n${body}`;
  write('docs/governance/decisions/registry-walled.md', fm({ class: 'decision', component: 'shared', status: 'accepted' }, '# The registry is walled during a build\n\nChange it through a permit.\n'));
  write('docs/governance/rules/explicit-staging.md', fm({ class: 'rule', component: 'shared', status: 'active', tier: 'always' }, '# Stage explicit paths only\n\nNever `git add -A`.\n'));
  write('docs/governance/issues/slow-hook.md', fm({ class: 'issue', component: 'shared', status: 'deferred' }, '# The hook starts Node on every write\n'));
  write('CLAUDE.md', '# Relay\n\n<!-- generated by nexus from docs/relay.md · edit the source, not this file -->\n\nWork in small steps.\n');
  write('.claude/rules/web.md', '---\npaths: ["web/**"]\n---\n# Web rules\n\nCharts draw in SVG.\n');
  write('docs/_meta/views/traffic-load.md', fm({ name: 'traffic-load', title: 'Traffic load', type: 'table', data: 'data/traffic-load.csv', table: { sort: { column: 'requests', dir: 'desc' } } }, 'Requests per region, from the nightly export.\n'));
  write('docs/_meta/views/lag-trend.md', fm({ name: 'lag-trend', title: 'Lag trend', type: 'chart', data: 'data/lag.csv', chart: { kind: 'line', x: 'day', y: ['north', 'south'] } }, 'Replay lag per day, in seconds.\n'));
  write('docs/_meta/views/screens.md', fm({ name: 'screens', title: 'Screens', type: 'gallery', data: 'data/screens' }, 'The lag screen, at each step.\n'));
  write('docs/_meta/views/runbook.md', fm({ name: 'runbook', title: 'Runbook', type: 'markdown', data: 'reports/runbook.md' }, 'How to run a replay.\n'));
  write('data/traffic-load.csv', 'region,requests,errors\nNorth,412,3\nSouth,388,9\nEast,97,0\n');
  write('data/lag.csv', 'day,north,south\n1,4.2,6.1\n2,3.9,5.5\n3,5.1,7.2\n4,4.4,6.8\n5,3.2,4.9\n');
  const block = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${fill}"/></svg>`;
  write('data/screens/1-before.svg', block('#3c5a78'));
  write('data/screens/2-after.svg', block('#8aa08a'));
  write('reports/runbook.md', '# Replay runbook\n\n1. Pause the source.\n2. Replay the last day.\n\n```mermaid\nflowchart LR\n  pause --> replay --> resume\n```\n');
  // One accepted guardrail, for the This build group (its name has no "replay", which a search test relies on).
  openGate(R, B, { name: 'guardrails-repo', type: 'mark-list', log: 'guardrails', title: 'Confirm the guardrails', why: 'Mark each one.', items: [{ name: 'no-new-external-calls', text: 'No new external network calls without a gate' }] }, '2026-10-02T19:10:00Z');
  submitAnswers(R, B, 'guardrails-repo', { marks: { 'no-new-external-calls': 'accepted' } }, '2026-10-02T19:12:00Z');
  applyAnswers(R, B, 'guardrails-repo', '2026-10-02T19:13:00Z');
  // Its own isolated home, holding the repo's memory where Claude Code keeps it.
  const repoEnv = isolatedEnv();
  const mem = join(repoEnv.configDir, 'projects', memoryKey(R), 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), '- [Replay caps](replay-caps.md): cap replays at 10,000\n');
  writeFileSync(join(mem, 'replay-caps.md'), '---\nname: replay-caps\n---\nCap replays at 10,000 messages.\n');
  return { root: R, env: repoEnv };
}
const repo = repoCopy();
roots.repo = repo.root;

// reviews: the repo fixture again, with one open review of three items. Its own copy, so the repo fixture's
// baselines and counts don't move.
const reviews = repoCopy();
const listed = governanceInventory(reviews.root, reviews.env).items;
// A row names an item by its inventory id, and its target is that item's location exactly as the inventory lists it
// (openReview refuses anything else), so both come from the same found item.
const rowFor = (name, text, test, what) => {
  const found = listed.find(test);
  if (!found) throw new Error(`reviews fixture: no ${what} in the inventory`);
  return { name, text, item: found.id, target: found.location };
};
openReview(
  reviews.root,
  {
    name: 'repo-tidy',
    type: 'review',
    title: 'Tidy the standing instructions',
    why: 'Three items overlap the vault. Keep, adjust or remove each one.',
    items: [
      rowFor('keep-agreement', 'CLAUDE.md: the working agreement', (i) => i.kind === 'instructions' && i.location === 'CLAUDE.md', 'CLAUDE.md'),
      rowFor('web-rules', 'Web rules: still needed?', (i) => i.kind === 'rule-file' && i.location.endsWith('web.md'), 'web rules'),
      rowFor('replay-caps', 'Memory: cap replays at 10,000', (i) => i.kind === 'memory' && i.title === 'replay-caps', 'the replay-caps memory'),
    ],
  },
  '2026-10-10T15:00:00Z',
  reviews.env,
);
roots.reviews = reviews.root;

// finished: the example build closed out (its finish approved), with its draft final report and its open
// decommission gate. Claude drafts the report by hand, so it is written here; the gate's name and where the report
// sits come from the decommission's own path rules.
const F = plainCopy();
openGate(F, B, { name: 'finish-replay', step: 'finish', type: 'approve', title: 'Finish replay', why: 'Approving closes out the phase on build/relay-rebuild, where it stays until the build is decommissioned.' }, '2026-10-09T20:00:00Z');
submitAnswers(F, B, 'finish-replay', { decision: 'approve' }, '2026-10-09T20:05:00Z');
applyAnswers(F, B, 'finish-replay', '2026-10-09T20:06:00Z');
setStage(F, B, 'close-out');
const FINISHED_ROWS = [
  { name: 'replay-cap', text: 'Replays are capped at 10,000 messages' },
  { name: 'pause-is-per-source', text: 'Pause is per source' },
];
const REPORT = [
  `# ${B} final report`,
  '',
  '## Outcome',
  '',
  '- **replay:** replays capped and paused per source.',
  '',
  '## Guardrails',
  '',
  '- Replays are capped at 10,000 messages: a rule, once accepted, in `governance/rules/replay-cap.md`.',
  '- Pause is per source.',
  '',
].join('\n');
const REPORT_FILE = join(F, '.build', B, ...reportDraft(B).split('/'));
mkdirSync(dirname(REPORT_FILE), { recursive: true });
writeFileSync(REPORT_FILE, REPORT);
// A fixed time, so the date beside the report (masked in the screenshot) has the same width every day.
const REPORT_TIME = new Date('2026-10-10T15:30:00Z');
utimesSync(REPORT_FILE, REPORT_TIME, REPORT_TIME);
openGate(
  F,
  B,
  {
    name: decommissionGateName(B),
    step: 'decommission',
    type: 'mark-list',
    title: `Decommission ${B}`,
    why: 'Mark each guardrail: accept it to make it a rule for this repo, or decline it to leave it with the build.',
    document: reportDraft(B),
    items: FINISHED_ROWS,
  },
  '2026-10-10T16:00:00Z',
);
roots.finished = F;
const envs = { repo: repo.env, reviews: reviews.env };

mkdirSync(join(ARTIFACTS, '.e2e'), { recursive: true });
writeFileSync(join(ARTIFACTS, '.e2e', 'roots.json'), `${JSON.stringify(roots, null, 2)}\n`);
const inventories = Object.fromEntries(Object.keys(roots).map((name) => [name, envs[name] ?? isolatedEnv()]));
// Every temp folder this run made, for the next run to remove.
const temp = [...Object.values(roots), ...new Set(Object.values(inventories).map((env) => dirname(env.home)))];
writeFileSync(TEMP_LIST, `${JSON.stringify(temp, null, 2)}\n`);
for (const [name, root] of Object.entries(roots)) {
  const s = await startE2eServer({ root, cockpitDir: COCKPIT, port: PORTS[name], tries: 1, inventory: inventories[name] });
  console.log(`nexus e2e ${name}: ${s.url} (${root})`);
}
