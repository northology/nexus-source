---
name: nexus
description: Run a build through the nexus cockpit. Start a build folder, keep its logs and guardrails, open review gates for the user, apply their answers, and keep specs, plans and reports in the build's documents area. Use when starting or steering a multi-step build, when the user mentions nexus, the cockpit, a gate, a guardrail or a .build/ folder, or when a hook reports gate answers waiting.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)
---

# nexus

nexus keeps one build's in-flight material in `.build/<name>/` and shows it in a local cockpit that the user
keeps open beside the terminal. You write the files, and the user reviews at gates. A build runs as one or more
phases, and each phase goes planning → plan → build → close-out.

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>` (written `nexus <command>` below).
Add `--build <name>` when a checkout holds more than one build.

## Planning
The user starts planning with `/nexus:plan <build> [phase]`, which runs Superpowers' brainstorming and planning
inside the build. Follow that skill. Never edit a Superpowers file.

## While a phase is active
- Record items as they come up: `nexus log add questions <name> --text "<one sentence>" --status exploring --source "chat 11:20"`.
  Settled items go in `decisions`, problems in `issues`, scope or plan changes in `changes`. nexus tags each by phase.
- New rules, guards or assumptions are guardrails:
  `nexus guardrail propose <name> --text "…" --source "…" --raised-by <user|claude|agent>`. One applies only once the
  user accepts it at a gate; `withdraw` is for proposals. Never write a rule into memory, CLAUDE.md or settings.
- Check `nexus governance list` first: cite a recorded item that says the rule; if only outside items do, propose it.
- Paste `nexus guardrail list --accepted` into every subagent's brief.
- Whenever you'd give the user options shown visually (layouts, mockups, directions), from Impeccable, a companion
  screen or your own drafts, they go through a concept-pick round: one page per option in `concepts/<topic>/`, a
  `topic` on the gate and a `source` on each option (`impeccable`, `superpowers` or `self`). Text-only choices stay in
  the terminal. Never change a page after its round opens. A page may load images, fonts, scripts and data placed
  beside it in its topic folder; a new round gets new pages and new asset files, never edits to an opened round's
  assets. When `nexus gate apply`'s `Next:` line says to open the next round, do it on the same topic; the gate's
  fields are in `${CLAUDE_PLUGIN_ROOT}/reference/gates.md` ("Rounds and topics"). A concept-pick round replaces
  Impeccable's decision page (`impeccable serve-question`), so never serve it: a settled round is the user's recorded
  approval for that direction round, and "none of these" stands in for its re-roll. Live mode is only for refining a
  chosen concept after its round is settled, or when the user asks for live mode by name. Never start Impeccable's
  live mode or a browser tab just to present options. In live mode the user accepts a variant in the browser, never
  you. When live mode delivers an `accept` on a chosen concept, after its cleanup, record it:
  `nexus log add changes <entry-name> --topic <topic> --status applied --text "<what changed>" --source "live <time>"`, where `<topic>` is the gate's `topic`, which defaults to the gate's name when it has none.
- Specs and plans go in `documents/specs/<phase>/` and `documents/plans/<phase>/`; audits and reports in
  `documents/audits|reports/`; scratch work in `files/`. Follow `${CLAUDE_PLUGIN_ROOT}/reference/writing.md`.
- Planned phases go only in `.build/<name>/phases.json`, in order: add, split, reorder or drop them there.
- After a Superpowers execution run, before its workspace is deleted: `nexus ledger import <progress.md>`.
- `nexus plan` and the Plan section show the approved plan's tasks and progress; name tasks by title, not number.
- After editing any JSON by hand, run `nexus check`.

## The wall
While a phase is active, a hook refuses writes to permanent rules (CLAUDE.md, CLAUDE.local.md, AGENTS.md,
`.claude/settings*`, `.claude/rules/`, memory, `.nexus/config.json`, `docs/_meta/`), to `build.json` (change it only
through `nexus stage` and `nexus phase`), to `docs/superpowers/`, to a concept page once its round has opened, to a
review's answers and to the repo's record; `gates/*.answers.json` stay walled until decommission removes the build.
If the user asks for a permanent-rule change, open an approve gate with a `permit` naming the file and the change.
Edit only after they approve, within 30 minutes, then apply the gate.

## Gates
1. Write the request JSON to a scratch file (see `${CLAUDE_PLUGIN_ROOT}/reference/gates.md`), then run
   `nexus gate open <file>`.
2. Tell the user the gate is waiting in the cockpit, then stop and wait.
3. When answers arrive (the hook or the user tells you), run `nexus gate apply <gate>`, act on what it prints, and
   commit the build folder. For an approved permit gate, make the change first, then apply; that closes the permit.

Never answer a gate yourself by any means (an answers file, a request to the server): only the user answers, in the
cockpit. Read `notes/` at every gate.
- Reviews of the Repo view's items (`nexus review open`, in `.nexus/reviews/`) are gates too; see `gates.md`.

## Finishing a phase
- Open the approve gate `finish-<phase>` (`"step": "finish"`) before merging; approving it authorizes the fast-forward
  into `main` and close-out (`/nexus:plan` step 5). `nexus stage close-out` ends the phase; close-out is one-way.
- The next phase starts with `/nexus:plan <build> <phase>`, in the same build.
- `/nexus:decommission <build>` writes a closed build into `docs/`; never delete `.build/<name>/` yourself.

## Reference
- `${CLAUDE_PLUGIN_ROOT}/reference/contracts.md`: every file and field.
- `${CLAUDE_PLUGIN_ROOT}/reference/gates.md`: gate types, guardrail gates, permits, finish gates.
- `${CLAUDE_PLUGIN_ROOT}/reference/cockpit.md`: the server API, navigation and view links.
- `${CLAUDE_PLUGIN_ROOT}/reference/writing.md`: how to write documents for the cockpit.
- `${CLAUDE_PLUGIN_ROOT}/reference/extending.md`: adding tools for a repo; `vault.md`: the vault, init, generate.
- `${CLAUDE_PLUGIN_ROOT}/reference/superpowers.md`: how nexus connects to Superpowers, and the wall's known gaps.
