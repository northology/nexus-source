# Changelog

nexus follows semantic versioning. In the source repo, the design behind each change is in `design/`, by date.

## 1.4.3 (2026-11-10)

Phases stay on their branches until decommission, and dropdowns read in the dark theme. Gates, answers and records
are unchanged.

- **Phases don't merge on their own:** approving a finish gate closes the phase out and nothing more; the work stays
  on its branch, and the next phase branches from its tip. Before, each finish fast-forwarded `main`, which, with
  builds running in parallel worktrees, changed the files under every other checkout of `main`. `nexus phase status`
  now points a closed phase at the next phase or at `/nexus:decommission`.
- **Decommission lands the build:** if another build reached `main` meanwhile, it merges `main` into the build branch
  and runs the suite first; after apply it fast-forwards `main` to the decommission commit. When `main` is checked
  out in another worktree, it leaves that checkout alone and gives you the `git merge --ff-only` to run there.
- **Dark-theme dropdowns:** the phase and rail dropdowns opened as a white list with the theme's light text; the
  list now takes the dark ground.

## 1.4.2 (2026-11-09)

Two cockpit fixes. Gates, answers and records are unchanged.

- **Retire rows ask in words:** a retire row's buttons read **Retire** and **Keep** (with research still `?`), and
  its keys are X, K and R. A and D do nothing there, so the habit "A means agree" can't retire a guardrail. The tally
  counts Retire and Keep on their own. Keep leaves the guardrail's text standing; Retire strikes it through. In the
  answers, Retire is still `accepted` and Keep `declined`.
- **Gate documents span the gate:** a spec, plan or report attached to a gate used the Documents tab's 72ch reader
  without its side column, which left an empty band on the right at landscape widths. It now spans the gate: tables,
  code and diagrams take the width, prose keeps its measure, and from 1200px the contents list sits on the right edge.

## 1.4.1 (2026-11-03)

A remediation pass: fixes for the issues still open after 1.4.0, and a gate row for retiring a guardrail. Records
written by 1.4.0 read the same.

- **Retiring a guardrail:** a guardrails-gate row can carry `"retire": true`, naming an accepted guardrail with its
  text as accepted. The cockpit labels it "Retire" and its accept button "Retire it", the tally counts it as a
  retirement, and accepting it retires the guardrail (state `retired`, out of `nexus guardrail list --accepted`);
  declining it keeps the guardrail. `gate apply` reports "Retired:" or "Kept, not retired:". A retired guardrail can't
  be withdrawn, so the record keeps the gate that retired it. Before, retiring meant declining a re-listed row, which
  read as agreeing to keep it.
- **Gates hold under Superpowers 7:** `/nexus:plan` tells brainstorming that skipping the questions, or sizing the work
  as small, still opens the scope and spec gates.
- **The wall:** under Antigravity, hook input that isn't JSON is judged against the workspace its text names, and
  refused when it names none. Codex's hook matcher covers `container.exec`. The wall also protects Antigravity's
  `.agents/rules.json` and the older rule folders `.agent/rules/`, `_agents/rules/` and `_agent/rules/`; the guides
  list them.
- **Codex's AGENTS.md cap:** `nexus docs generate` warns when `AGENTS.md` would pass the 32 KiB Codex reads, naming
  the largest rules, and still writes it.
- **The Repo view:** a review can be submitted from the foot of its cards as well as from the banner, and a submit
  reuses the server's walk below the repo rather than walking it again.
- **`nexus doctor superpowers`:** a malformed, empty or blank anchor wording is named instead of failing with a
  TypeError or matching any file; the 7.0.0 spec-check anchor is the "**Builder check:**" instruction. The README,
  INSTALL.md and the guide name the supported versions (6.4.1, 7.0.0 and 7.0.1) and say only the newest install is
  checked.
- **Other fixes:** Antigravity rule globs with braces (`src/{a,b}/**`) read back as one path; skills with CRLF line
  endings are rewritten and marked user-only correctly; decommissioning the last build removes `.build/` too; the
  Antigravity package carries a logo.
- **The harness blocks** that `nexus init` writes name the repo's record (`docs/governance/decisions.json`,
  `issues.json` and `builds/`). Repos set up before 1.4.1 keep their old block; add the line by hand if you want it.
- **Development:** tests remove their temporary folders (a run used to leave hundreds behind), and
  `node scripts/clear-test-temp.ts [--delete]` clears ones left by older runs. The per-test timeout is 60 s.

## 1.4.0 (2026-11-02)

nexus in Codex and Antigravity, beside Claude Code: three packages from one source, each proven in a live session
(codex-cli 0.162.0, agy 1.4.12). The README's Harnesses section says how to install each and how far the wall holds.

- **Packages:** `pnpm build` makes `dist/nexus/` (Claude Code, as before), `dist/nexus-codex/` and
  `dist/nexus-antigravity/`, all named `nexus` at the same version. Codex installs the Codex package from
  `.agents/plugins/marketplace.json` and starts the skills as `$nexus:plan`, `$nexus:init` and `$nexus:decommission`;
  its user-only skills are marked in `agents/openai.yaml`. Antigravity installs `plugins/nexus-antigravity/` with
  `agy plugin install`, and nexus's status reaches the agent once per prompt. Skills find the CLI by a path relative to
  their own folder.
- **The wall in each harness:** a thin adapter per harness turns its hook input into the guard's. Codex's
  `apply_patch` is checked file by file, so a patch touching one protected file is refused whole, and its shell
  commands are read as PowerShell on Windows. Codex and Antigravity are refused with an explicit deny, the one answer
  both held to in testing (Codex let writes through on any exit code, a timeout or unreadable output). `nexus doctor
  guard` now opens by naming the harness and how strong its wall is there. In every package the wall also protects the
  files Codex and Antigravity load: a folder's `AGENTS.override.md`, `GEMINI.md`, `.agents/rules/`,
  `.agents/hooks.json`, `.codex/config.toml` and their global copies.
- **init, docs generate and decommission:** in Codex and Antigravity, `nexus init` writes its block to `AGENTS.md`,
  and adds just that block to a repo already set up from another harness. `nexus docs generate` writes the vault's
  rules to `.agents/rules/nexus-<rule>.md` for Antigravity (with `trigger: always_on` or `trigger: glob`), and for
  Codex into a generated section of `AGENTS.md`'s nexus block, refusing a rule that quotes a nexus marker.
  Decommission commits each harness's generated rules with the record.
- **The Repo view** lists the instruction files the running harness loads: the `AGENTS.md` files (and Antigravity's
  `.agents/rules/`) under Codex and Antigravity, with no Claude Code memory or project-instructions line.
- **Superpowers:** `nexus doctor superpowers` looks where each harness keeps plugins, and passes on Superpowers 7.0.1,
  which moved three of the lines nexus relies on into `references/fix-loop.md` (an anchor's wording can now name its
  own file).
- **Fix:** the `/nexus:init` skill's frontmatter is valid YAML (its values are unchanged).

## 1.3.2 (2026-10-20)

Superpowers 7.0.0 support beside 6.4.1, and wording that fits whichever harness runs nexus.

- **Superpowers:** nexus works with Superpowers 6.4.1 and 7.0.0. An anchor in `reference/superpowers.md` can list
  each version's wording, and `nexus doctor superpowers` says which one it found (`ok ... (7.0.0)`); both versions
  pass all 18 anchors. `/nexus:plan` treats brainstorming's visual-companion offer as made and declined on either
  version, opening a concept-pick round only for a real choice of two or more designs. When 7.0.0's builder check
  reads the spec, its questions for the user are asked in chat and logged, and the answers and the agent's own calls
  are listed in the spec's Decisions to confirm section, which the spec gate confirms.
- **Wording:** the cockpit, CLI, hooks and docs say "the agent" for the one doing the work and "the harness" for the
  tool running nexus. "Claude Code" stays where the text is about Claude Code itself: the plugin install, the Repo
  view's notes on what Claude Code loads, and its hooks. Text that assumed a terminal now says "on your next
  message". The cockpit shows who raised a guardrail as you, the agent or a helper agent; stored values don't change.

## 1.3.1 (2026-10-15)

Fixes from a pre-production inspection of 1.3.0.

- **The wall:** if the guard itself fails, it still refuses every file the wall protects (the repo's permanent record
  and `docs/_meta/` were missing from its fallback), and only where a build is at or above the session, so it never
  blocks a repo without one, or one whose `.build/` holds no build. A finished build's gate answers, and the folders that hold them, stay walled until
  decommission removes the build, so the decommission gate is answered only in the cockpit. The refusals for posting gate answers and for unmappable paths
  now see a build in a parent folder, as the rest of the wall does.
- **Commands:** each command takes only the flags its usage line names, so a stray `--check` on `decommission apply`,
  `stage` or `gate open` is refused instead of ignored while the command acts. `nexus new` refuses a name longer than
  48 characters and the name of a decommissioned build whose record the repo holds.
- **Decommission:** a row named like a decision no longer rewrites or removes it (the gate logs one entry listing its
  marks), and a build folder held open after the commit is reported as left for `git clean -fd .build/<build>/` instead of failing a
  decommission that is already committed. The unused `decommission/` staging area is gone from the server and the gate
  schema.
- **Cockpit:** the Phases tab keeps a list that names a phase twice and says so; a static rule file created after the
  page loads shows without a reload; marks and notes lock while answers are sent; the time-zone list offers no
  built-in zone of its own. The server drops a file that disappears mid-send instead of raising an unhandled error.
- **Ledgers:** the snapshot and the live watcher check a linked run folder the same way, and the prompt hook stops
  asking for `nexus ledger import` once a phase's run is imported, even one with no rulings or minors.
- Docs corrected where they described earlier behaviour; dead code and development-only tests removed.

## 1.3.0 (2026-10-14)

- **Phases tab:** a build's planned phases, kept in `.build/<build>/phases.json` and shown in the cockpit as a table of
  phase number, name and description. The number comes from the order, so splitting or dropping a phase renumbers the
  rest. The agent writes the list when ideation lays out several phases and keeps it current.
- **Guidance in neutral words:** the Guidance pages and the command details say "the agent" and "the harness"
  where they said Claude and Claude Code, and the glossary defines both, a first step towards running nexus from
  other harnesses. The skills, reference pages and cockpit keep their wording for now.
- Fixed: a Guidance link to a heading below the diagrams lands on the heading, and stays there until you scroll.

## 1.2.0 (2026-10-14)

- **Build records:** a build's final report is kept as its lasting record, `docs/governance/builds/<build>.md`
  (class `build-record`, vault contract 3), linked from the hubs of the components it touched and coloured apart in
  the Obsidian graph. Its archived specs, plans and audits stay hidden, one link away.
- **Decisions of note:** only the decisions the final report lists reach `docs/governance/decisions.json`; approvals
  stay in the build's record as one line.
- **Hubs** gain a Builds section: the records naming the component and the two repo logs.
- **The repo's permanent record is written only at decommission:** during a build the wall protects
  `docs/governance/decisions.json`, `issues.json` and `builds/`, with no permit. At decommission, a build closes
  the earlier builds' issues it fixed (`closedBy`) and supersedes the decisions it replaced (`supersededBy`), as
  its final report lists.
- **Every decommission asks you:** a build with no accepted guardrail gets an approve gate on its final report, where
  apply used to refuse it. Sent back, it is asked again as `decommission-<build>-2`.
- Fixed: an uncommitted `.build/.gitattributes` no longer blocks a decommission, and a declined decommission row no
  longer opens its note.

## 1.1.0 (2026-10-14)

P2: the vault standard, `nexus init`, the Repo view and declared views, and, in its last phase:

- **Decommission:** `/nexus:decommission <build>`, with `nexus decommission check` and `apply`. A finished build's
  record moves into the repo's in one commit: accepted guardrails you mark become rules, decisions and open issues go
  to `docs/governance/decisions.json` and `issues.json`, and its documents and final report go to
  `docs/superpowers/archive/<build>/`. The build folder is committed as it stands first, then removed.
- **The wall:** closes two gaps in 1.0.0: a copy into a walled folder (`cp x.answers.json .build/<build>/gates/`),
  and a write that reaches a walled file after a `cd` or through a glob.
- **Vault contract 2:** the `report` class, and `nexus docs upgrade` for older vaults (add-only).
- **Reviews:** `nexus review open`, `apply` and `list`; Keep, Adjust and Remove on the Repo view's items, with a permit
  per row during a build.
- **Inventory:** Claude Code's project-instructions setting, and instruction files in subfolders.
- **Cockpit:** the Decommission tab, a mark-list's document, and static rule files shown as repo files.

## 1.0.0 (2026-10-06)

The first official release, published from the nexus marketplace (`nexus@nexus`). It closes P1: the build cockpit,
gates, planning through Superpowers, concept rounds, the wall and the Guidance tab, as tested in the 0.1.0 trials.

- The per-prompt reminder points Claude at both the specs and plans folders in the plan stage.
- The plugin ships its README and changelog.

Next: P2 sets the standards a repo is set up with (`nexus init`) and the permanent navigation layer; P3 adds
decommissioning a build into that layer.

## 0.1.0 (trial, 2026-10-02 to 2026-10-06)

Built and accepted through trial installs (`claude --plugin-dir`):

- **Builds and phases:** `.build/<build>/` records, phases with their own branches, stages from planning to close-out.
- **Gates:** approve, mark-list and concept-pick gates answered once in the cockpit; the five planning steps
  (guardrails, scope, spec, plan, finish); permits for changes to standing rules.
- **Planning:** `/nexus:plan` wires Superpowers' brainstorming, plan writing and execution to the build, and resumes a
  phase from `nexus phase status`.
- **Cockpit:** Gate, Plan, Logs, Concepts, Documents and Guidance sections, live, in light and dark themes.
- **Concept rounds:** options shown as frozen pages, compared side by side or by swipe, with lineage across rounds.
- **The wall:** a PreToolUse guard over Claude's writes and shell commands, with a dependency-free loader that stays
  out of repos without a build in progress if the guard can't run.
- **Health:** `nexus doctor guard`, `nexus doctor superpowers` and `nexus check`.
