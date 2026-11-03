# nexus Plan Section Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deferred minors and parked findings from the Plan section run before acceptance testing. Nothing
new: every item traces to a ledger line of the Plan section run (`.superpowers/sdd/2026-10-04-nexus-plan-section-plan/progress.md`).

**Architecture:** Four waves, one implementer each, grouped by area so no two waves touch the same file except where
named: progress reading (`core/progress.ts` and its callers), CLI, wall and wording, the cockpit, then tests only.

**Tech Stack:** TypeScript (Node 24 runs .ts directly), Vitest, React + Vite cockpit, Playwright e2e.

**Spec:** `artifacts/design/2026-10-04-nexus-plan-section-design.md`. Task 1 amends its §4 state table, as the user
decided on 2026-10-05.

## Decisions (2026-10-05)

- **Any active task reads in progress.** A task with any ledger line (a fix round, a parked finding, a ruling or a
  minor) and no `complete` line is active. Several tasks can be in progress at once. When no unfinished task is
  active, the first unfinished task reads in progress, as now. This replaces §4's "first task without a `complete`
  line" rule.
- **The board's visual fixes are in.** The board snapshots are regenerated, and the user sees them before merge.
- **Logs stay append-only.** Entries imported before task tagging existed stay untagged; nothing rewrites past log
  lines.
- **A ledger's first line outranks its marker.** This narrows the final review's I2c ruling ("either source"): when
  a ledger's first line names an indexed plan, its `plan-path` marker is ignored. The marker decides only when the
  first line is missing or names no indexed plan.

## Global Constraints

- Repo `C:/work/repo`, branch `nexus-plan-section` (already checked out; never switch
  branches). Code lives in `artifacts/`; run commands from there.
- Commit as the configured user. No attribution or Co-Authored-By lines.
- Stage explicit paths only: never `git add -A`, `git add .` or `git commit -a`. Never stage `docs/.obsidian/`.
- TypeScript strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `noPropertyAccessFromIndexSignature`: guard indexed access, no `!` non-null assertions in source. Typecheck
  (`pnpm typecheck`) is part of every task's gate.
- Quote prose test names that contain an apostrophe with double quotes or template literals.
- No new dependencies. Workstream-neutral: no organisation names, paths or rules baked in.
- **Titles for people, IDs for the backend.** Task and plan IDs are never shown, and plan task numbers are never
  shown in the cockpit or in CLI output: a task is always named by its title.
- **Watch, don't steer.** Nothing in the Plan section answers back to Claude.
- **No red in the Plan section.** Ink and graphite only; red stays for needs-you.
- Cockpit sizes use `calc(N * var(--px))` and the font tokens (`--f-label`, `--f-body`, `--f-title`); 1px borders
  stay 1px. Times are stored in UTC and shown with `formatTime(…, zone)`.
- The cockpit imports types from `core/`, and runtime code only from `core/plan-text.ts` (it has no Node imports).
- Every behaviour change is test-first: write the test, watch it fail, change the code, watch it pass. Finish each
  task with `pnpm test` and `pnpm typecheck`; Task 3 also runs `pnpm cockpit && pnpm e2e`.
- No visual snapshot may change except the four `plan-*-1280.png` files in Task 3.

## Review Focus

- Two tasks active at once (one in a fix round, a later one with rulings): both read as active in the list, the
  board and the summary line, and neither reads pending.
- A ledger whose first line names plan B and whose marker names plan A shows only on B, and `ledger import` keeps
  B's record.
- A completion line with a trailing note (`… review clean). Merged early.`) reads done.
- Three revisions of a plan for one phase: from the newest, each earlier one is reachable by following links back.
- The prompt hook no longer scans ledgers, and the cockpit and `nexus plan` still show progress.

---

### Task 1: Progress reading

Parked findings 1–2, the final review's minors 1–3 and its declined hook item, and the Task 4, 5 and 6 minors.

**Files:**
- Modify: `core/progress.ts`, `core/plan-text.ts` (summary only), `core/snapshot.ts`, `hooks/hook.ts`,
  `server/events.ts`, `scripts/cli.ts` (the guardrails `readSnapshot` call only)
- Modify: `design/2026-10-04-nexus-plan-section-design.md` (§4 state table)
- Test: `tests/progress.test.ts`, `tests/plan-text.test.ts`, `tests/snapshot.test.ts`, `tests/server.test.ts` (the
  file that holds the ledger-refresh test; find it with `grep -rn "ledger" tests/*.test.ts`)

**Interfaces:**
- Produces: `LEDGER_DIR` exported from `core/progress.ts` (`['.superpowers', 'sdd']`); `LedgerFile` gains
  `named: string | null` (the first-line plan, resolved) alongside `plans`; `readSnapshot(root, name, opts?:
  { progress?: boolean })`; `summarize` names every active task.

- [ ] **Step 1: Any active task reads in progress.** Test first, in `tests/progress.test.ts`: a ledger where task 1
  is complete, task 2 has `Task 2: fix round 1/5 (0 addressed, 1 open — x)`, task 3 has a `Ruling:` line under a
  `Task 3:` prefix, and task 4 has nothing. Expect task 2 `fix-round`, task 3 `in-progress`, task 4 `pending`. A
  second case: tasks 1–2 complete, nothing else, expects task 3 `in-progress` (the existing rule). Then replace the
  state loop at the end of `readLedgerProgress`:

  ```ts
  const active = (p: TaskProgress): boolean => p.fixRounds.length > 0 || p.parkedFindings.length > 0 || p.rulings.length > 0 || p.minors.length > 0;
  const unfinished = plan.tasks.map((t) => tasks[t.id]).filter((p): p is TaskProgress => p !== undefined && !done.has(p));
  const anyActive = unfinished.some(active);
  for (const t of plan.tasks) {
    const p = tasks[t.id];
    if (!p) continue;
    if (done.has(p)) p.state = 'done';
    else if (p.fixRounds.length) p.state = 'fix-round';
    else if (active(p) || (!anyActive && p === unfinished[0])) p.state = 'in-progress';
  }
  ```

  Amend the spec's §4 `in-progress` row to: "no `complete` line and no fix round, the ledger exists, and either the
  task has a ledger line (a parked finding, a ruling or a minor) or no unfinished task has one and it is the first
  unfinished task in plan order". Add one line under the table: "Several tasks can be in progress at once (decided
  2026-10-05)."

- [ ] **Step 2: The summary names every active task.** Test first, in `tests/plan-text.test.ts`: with task A in fix
  round 2 and task B in progress, `summarize(...).text` contains `in progress: A (fix round 2), B`. In `summarize`,
  replace `current` with every task whose state is `in-progress` or `fix-round`, in plan order, joined with `, `,
  each carrying ` (fix round N)` when in a fix round. With one active task the text is unchanged.

- [ ] **Step 3: A completion line may carry a trailing note.** Test first: `Task 1: complete (commits a1b2c3d..d4e5f6a, review clean). Merged early.`
  reads done with those commits. Change `COMPLETE` to drop the end anchor after `\)`:
  `/^Task (\d+): complete \(commits ([0-9a-f]{4,40}\.\.[0-9a-f]{4,40})(?:,\s*([^)]*))?\)/`. The `parked` count still
  reads from group 3.

- [ ] **Step 4: The first line outranks the marker.** Tests first:
  - a ledger whose first line names plan B and whose marker names plan A (both indexed, different documents):
    `planProgress` gives A `source: 'record'` or `'none'` and B `source: 'ledger'`;
  - `importRun` on that ledger keeps B's record and tags lines with B's task IDs;
  - a ledger whose first line names a document no plan has, and whose marker names plan A: A reads the ledger (the
    existing either-source test must still pass).

  In `findLedgers` and `importRun`, keep `plans` and add `named` (the resolved first-line path, or null). In
  `ledgerFor`, a ledger matches a plan when `named === doc`, or when `plans.includes(doc)` and `named` names no
  indexed document of this build. `ledgerFor` gains the set of indexed document paths as a parameter
  (`indexed: Set<string>`, built once in `planProgress` from `plans.map((p) => planDocPath(name, p))`). In `importRun`,
  pick the newest plan whose document equals `named` when `named` is an indexed document, else the newest whose
  document is in `targets`.

- [ ] **Step 5: `importRun` reads the marker safely.** Test first: a workspace whose `plan-path` is a folder and
  whose ledger's first line names the plan; `importRun` keeps the record. Replace the `existsSync`/`readFileSync`
  pair with a `try { … } catch { marker = null }`, as `findLedgers` does.

- [ ] **Step 6: An older plan keeps its own Final review.** Test first: two plan entries for one phase with
  different documents, each with a record, and `Final:` log entries for that phase; only the newest plan of the phase
  shows them. In `recordProgress`, take `fromFinal` entries only when `plan` is the newest entry of its phase (pass a
  `newest: boolean` from `planProgress`); otherwise `final` is empty.

- [ ] **Step 7: Symlinked workspaces and outside ledgers.** Tests first:
  - a workspace folder that is a symlink (or a Windows junction: `symlinkSync(target, path, 'junction')`) to a
    folder holding `progress.md` is found by `findLedgers`;
  - `importRun` with a ledger file outside the repo root stores `record.ledger` as an absolute path with forward
    slashes, never as `../…`.

  In `findLedgers`, accept entries where `d.isDirectory() || d.isSymbolicLink()`; a symlink to a file fails the
  `progress.md` read and is skipped by the existing try. In `importRun`, when `relative(root, ledgerFile)` starts
  with `..`, store `resolve(ledgerFile)` with `/` separators.

- [ ] **Step 8: One ledger folder, and markers count as changes.** Export `LEDGER_DIR` from `core/progress.ts` and
  use it in `server/events.ts` `ledgerSignature`. The signature includes each workspace's `plan-path` modified time
  and size alongside `progress.md`'s (a missing marker contributes nothing). Tests first, in the server test file:
  - writing only a `plan-path` marker into an existing workspace fires a refresh (`null`);
  - with no ledger or marker change over two identity ticks, no ledger-driven refresh fires. Assert that the
    collected events stay empty across a wait of three identity intervals after the watcher settles.

- [ ] **Step 9: The prompt hook skips plan progress.** `readSnapshot(root, name, opts: { progress?: boolean } = {})`:
  when `opts.progress === false`, `planProgress` is not called and the snapshot carries `{}`. `hooks/hook.ts` and the
  guardrails call in `scripts/cli.ts` (the one that only reads `.guardrails`) pass `{ progress: false }`. Test first,
  in `tests/snapshot.test.ts`: with a live ledger for the example plan, `readSnapshot(root, B, { progress: false })
  .planProgress` is `{}` and the default call is not.

- [ ] **Step 10: Run and commit.** `pnpm test`, `pnpm typecheck`. Commit in logical commits with explicit paths,
  for example `nexus: several tasks can be in progress at once`, `nexus: a ledger's first line outranks its marker`,
  `nexus: progress reading minors`.

### Task 2: CLI, wall and wording

Task 2, 3 and 11 minors, parked finding 3, and Task 1's contracts table.

**Files:**
- Modify: `core/plan.ts` (fences), `core/gates.ts` (`indexPlanGate`), `scripts/cli.ts` (`plan` and `ledger import`
  output), `core/contracts-doc.ts`, `reference/contracts.md` (regenerated), `reference/gates.md`
- Test: `tests/plan.test.ts`, `tests/progress.test.ts` (CLI lines only), `tests/docs.test.ts` if it pins contracts
  text

- [ ] **Step 1: Fences close only on a matching fence.** Test first: a plan with a four-backtick fence holding
  ```` ``` ```` and a `### Task 9:` line, then a real `### Task 2:` after the closing four backticks, parses tasks 1
  and 2 only. In `parsePlanTasks`, remember the opening fence's character and length; a line closes the fence only
  when it starts (after up to 3 spaces) with the same character repeated at least that many times and has nothing
  else but whitespace after it. Opening needs 3 or more backticks or tildes, as now.

- [ ] **Step 2: `plan index` refusals are consistent.** Tests first: "isn't a plan gate" exits with status 400 (the
  request is wrong); "wasn't approved" and "already indexed" both carry 409 (the gate's state conflicts). Set
  `new NexusError(…, 409)` on the "wasn't approved" refusal. Assert on the thrown `NexusError.status` from
  `indexPlanGate`.

- [ ] **Step 3: `nexus plan` shows the time honestly.** Test first: a record whose `imported` is
  `2026-10-04T13:12:05-06:00` prints `record kept 2026-10-04 19:12 UTC`. Replace the slice with a formatter that
  parses the time and prints `YYYY-MM-DD HH:MM UTC` from `Date#toISOString()`.

- [ ] **Step 4: Problem lines name plan.json once.** Tests first: the `nexus plan` problem line reads
  `plan.json can't be read: <reason>` with no second `plan.json`, and the `ledger import` line reads
  `plan.json can't be read (<reason>), so no task record was kept.` likewise. Strip a leading `plan.json ` (and an
  optional following `is invalid: ` becomes `invalid: `) from the message before printing, in one small helper in
  `scripts/cli.ts` used by both lines.

- [ ] **Step 5: The docs say what apply prints.** In `reference/gates.md`, change "`gate apply` prints how many tasks
  it found." to "`gate apply` prints what indexing found: the number of tasks, or why none were indexed." Update any
  docs test that pins the old sentence.

- [ ] **Step 6: The kept record has a contracts table.** In `core/contracts-doc.ts`, after the plan task table, add
  "When `record` is set:" with a table of `plan.definitions.record` and, if its `tasks` values are their own schema,
  "Each task in `record.tasks`:" with that table. Fail loudly with `at(…)` if the shape drifts, as the other tables
  do. Run `pnpm contracts` and commit the regenerated `reference/contracts.md`.

- [ ] **Step 7: Run and commit.** `pnpm test`, `pnpm typecheck`. Commit with explicit paths.

### Task 3: Cockpit

The final review's minor 4, the Task 8 duplication, and the Task 10 board visuals.

**Files:**
- Modify: `core/plan-text.ts` (notice only), `cockpit/src/lib/plan.ts`, `cockpit/src/views/PlanView.tsx`,
  `cockpit/src/styles/plan.css`
- Modify: `tests/e2e/__screenshots__/visual.spec.ts/plan-board-light-1280.png`, `plan-board-dark-1280.png` (and the
  list images only if they change)
- Test: `tests/plan-text.test.ts`, `tests/cockpit/plan.test.ts`, `tests/e2e/plan.spec.ts`

- [ ] **Step 1: A replaced plan that never ran says so.** Test first: `summarize(plan, progress, { replaced: true })`
  with `source: 'none'` returns the notice `No progress was kept for this plan before it was replaced.`; without
  `replaced` the existing notice stays. `summarize` gains an optional third parameter
  `opts: { replaced?: boolean } = {}`. `PlanView` passes `{ replaced: plan !== newest }`.

- [ ] **Step 2: Every earlier plan is reachable.** Test first, in `tests/e2e/plan.spec.ts` with `serveSnapshot`:
  three plan entries for one phase (gates `plan-replay-a`, `plan-replay-b`, `plan-replay`); from the current plan,
  follow "Replaced an earlier plan (plan-replay-b)", then from there "Replaced an earlier plan (plan-replay-a)". In
  `PlanView`, every plan that has a predecessor in `plans` shows the "Replaced an earlier plan (<gate>)" link to the
  one before it; a plan that is not the newest also shows "A newer plan replaced this one. Show the current plan".
  Both lines can show at once.

- [ ] **Step 3: One rule for a phase's current plan.** In `cockpit/src/lib/plan.ts`, `pickPlan(file, phase, id)`
  returns the plan with that ID within the phase, else `currentPlanFor(file, phase)`; `plansFor` stays for the list
  of a phase's plans. Update `PlanView` and the unit tests to the new signature. Behaviour is unchanged; the
  existing `pickPlan` tests carry over.

- [ ] **Step 4: The board shows which card is open.** In `plan.css`:
  - the open card (`.bcard[aria-expanded="true"]`) gets an inset ink bar on its left,
    `box-shadow: inset calc(3 * var(--px)) 0 0 var(--ink)`, and a solid border even when it is pending or unknown;
  - fix-round and in-progress cards keep their ink border without the bar, so the open card is the only one with it.

  Test first, in `tests/e2e/plan.spec.ts`: after clicking a pending card, its computed `box-shadow` is not `none`
  and its `border-style` is `solid`; another card's `box-shadow` is `none`.

- [ ] **Step 5: Empty columns and the detail.** Tests first, in `tests/e2e/plan.spec.ts`:
  - the In progress column of the `plan` fixture (no in-progress task) shows the text `None`;
  - after clicking a card, the board detail's heading is in the viewport (`toBeInViewport()`) and has focus.

  In `PlanBoard`, render `<p className="bcol-none">None</p>` when a column is empty (style: `--g2`, `--f-label`). When
  a card opens, scroll the detail into view (`scrollIntoView({ block: 'nearest' })`) and move focus to its heading,
  which gets `tabIndex={-1}`. Use a `useEffect` keyed on the open task's ID; do nothing when the list mode is shown.

- [ ] **Step 6: Snapshots.** Run `pnpm cockpit && pnpm exec playwright test tests/e2e/visual.spec.ts
  --update-snapshots`. Only `plan-board-*-1280.png` may change (the empty In progress column now reads `None`); if
  any other image changes, stop and report. Read each changed image with the Read tool and describe it in the report.
  Then `pnpm e2e` in full.

- [ ] **Step 7: Run and commit.** `pnpm test`, `pnpm typecheck`, `pnpm e2e`. Commit with explicit paths, the
  snapshot images in their own commit (`cockpit: board snapshots with the empty-column text`).

### Task 4: Tests only

The coverage gaps the task reviews deferred. No production code changes; if a test exposes a bug, report it
(DONE_WITH_CONCERNS) rather than fixing it here.

**Files:**
- Test: `tests/schemas.test.ts`, `tests/plan.test.ts`, `tests/progress.test.ts`, `tests/guard.test.ts`,
  `tests/protect.test.ts`, `tests/cockpit/plan.test.ts`, `tests/e2e/plan.spec.ts`

- [ ] **Step 1: Schema edges** (`tests/schemas.test.ts`): a record task keyed `t-timeline` is rejected; a fix round
  missing `open` is rejected; a plan task with `number: 0` or `steps: -1` is rejected (check the schema's minimums
  first and assert what it enforces).
- [ ] **Step 2: Index edges** (`tests/plan.test.ts`): `indexPlan` with a request that has no `phase` uses the build's
  current phase; applying a plan gate whose document path is a folder reports `indexed.error` and does not throw. (The
  entry-validation path shares the same catch and has no natural trigger; it stays untested.)
- [ ] **Step 3: Progress edges** (`tests/progress.test.ts`): `recordProgress` through `planProgress` with no ledger
  maps each record state and carries tagged rulings and minors; a ledger file that can't be read (a folder named
  `progress.md`) is skipped and the plan falls back to its record; `importRun` where the logs write succeeds and
  `writePlanFile` throws (stub nothing: make plan.json read-only with `chmodSync(file, 0o444)` and skip on Windows
  if the chmod has no effect), then a second import after restoring it keeps the record and skips the logged lines.
- [ ] **Step 4: The wall** (`tests/guard.test.ts`, `tests/protect.test.ts`): move the `plan.json` guard test into
  `describe('the wall during a build')`; add a `protect.test.ts` case that `.build/<build>/plan.json` is a `build`
  kind target.
- [ ] **Step 5: The rail** (`tests/cockpit/plan.test.ts`): `planRail` renders `off` cells for `fix-round`,
  `in-progress` and `pending` tasks and `on` for done.
- [ ] **Step 6: Not started** (`tests/e2e/plan.spec.ts`): with `serveSnapshot`, the plan's progress set to
  `source: 'none'` and every task `pending`, the summary reads `0 of 5 done · 5 pending · not started`.
- [ ] **Step 7: Run and commit.** `pnpm test`, `pnpm typecheck`, and `pnpm cockpit && pnpm exec playwright test
  tests/e2e/plan.spec.ts`. Commit with explicit paths.

## Not in this run

- Backfilling task tags on log entries imported before tagging existed (the user: logs stay append-only).
- A real broken `plan.json` file in the browser test: the snapshot unit tests cover a broken file becoming a problem,
  and the e2e covers how a problem renders.
- The final review's declined items other than the hook: a build root that isn't the git top level, the Logs
  section's `Task N` source text, case-sensitive file systems, the hatch pattern's pixel stops, Superpowers' own
  workspace reuse, and `plan index` before apply.
