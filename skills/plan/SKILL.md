---
name: plan
description: Start or continue a nexus build and run its planning through Superpowers, with the cockpit, guardrails and gates wired in. The user starts it as /nexus:plan <build> [phase].
disable-model-invocation: true
argument-hint: <build> [phase] [what it is for]; names start with a letter and are lowercase letters and numbers joined by hyphens, e.g. relay-rebuild, phase-2
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)
---

# Plan a build with nexus

Arguments: $ARGUMENTS

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>` (written `nexus <command>` below).
Superpowers runs the planning process; this skill wires nexus around it. Never edit a Superpowers file. How the two
connect is in `${CLAUDE_PLUGIN_ROOT}/reference/superpowers.md`.

Name the five standard gates `<step>-<phase>` and set `"step"` to match: `guardrails`, `scope`, `spec`, `plan`,
`finish`. A gate that was sent back and needs another round is reopened as `<step>-<phase>-2`, then `-3`. Formats are
in `${CLAUDE_PLUGIN_ROOT}/reference/gates.md`.

## 1. Start the phase
Nothing changes git before step 4, except a resume's checkout.
1. Say which build and phase names you read from the arguments. Names start with a letter, then lowercase letters
   and numbers joined by hyphens, with three letters in a row somewhere (`relay-rebuild`, `phase-2`). If the input could be read two
   ways, ask.
2. Run `nexus builds` and `git branch --list "build/*"`. If a different build is still active, stop and ask the
   user before any git command. If `<build>` is listed by `nexus builds`, or has a `build/<build>` branch, it
   already exists:
   - Run `git status --porcelain`; if it prints anything, stop and ask the user before any checkout. If you aren't
     on the build's branch (the one `nexus builds` shows, or else the first line of
     `git branch --list "build/<build>*" --sort=-committerdate`), check it out.
   - Start `nexus serve --open` in the background, give the user the URL, and run
     `nexus phase status --build <build>`.
   - If no phase was named, or the named phase is the current one, this is a resume: skip the rest of step 1 and
     follow the `Next:` line. After an apply, or once the user answers, run `nexus phase status --build <build>`
     again until its `Next:` line points into a step. Before re-entering brainstorming, read
     `.build/<build>/logs/decisions.json` and `questions.json` and tell brainstorming what is already settled, so the
     user isn't asked again.
   - If a new phase is named: when the current phase is closed, continue with step 3 (skipping step 7: the cockpit
     is running); when it isn't closed, ask the user.
3. Run the command step 6 will run with `--check` added: `nexus new <build> [--phase <phase>] --check`, or
   `nexus phase start <phase> --check`. If it fails, tell the user what it says and stop.
4. Create the branch from the current `HEAD`, without switching to `main` first:
   - a new build: `git checkout -b build/<build>`;
   - the next phase: `git checkout -b build/<build>-<phase>`, from the closed phase's tip. Phases chain on their
     own branches; nothing reaches `main` until `/nexus:decommission`.
5. If the repo has no `.nexus/config.json`, ask the user once which standing rule files to show in the cockpit
   (offer `CLAUDE.md` and any `.claude/rules/*`). If they name some, write `{ "staticRules": ["<files>"] }` now:
   the config is walled once the phase is active.
6. `nexus new <build> --summary "<one line>" [--phase <phase>]`, or `nexus phase start <phase>`. If `nexus builds`
   listed no builds and `.nexus/init-answers.json` exists, offer its `seeding:` entries to the user as this build's
   seeding brief. A new build also writes `.build/.gitattributes`: commit it with the build folder.
7. `nexus serve --open` in the background, and give the user the URL.

## 2. Guardrails (G1)
1. Read the static rules the repo's `.nexus/config.json` lists, the accepted guardrails
   (`nexus guardrail list --accepted`) and the user's request, and run `nexus governance list --json`: the standing
   instructions an agent loads from this repo, recorded or not, including files in subfolders (not output styles or
   hook context; `/context` shows what this session loaded). The list shows titles, not text: open any item whose
   title is close to your draft before deciding it already says it.
2. Draft only what this phase adds: assumptions, limits, things that must not happen. Don't restate static rules or
   guardrails already accepted. Sort each draft by where an overlapping rule is held:
   - A rule already held by a static rule, an accepted guardrail or a recorded vault item: cite that item to the user;
     don't propose it again. If it only partly overlaps, propose it with `"conflicts": ["<title> (<location>)"]`
     naming the item.
   - A rule held only by an item outside the record (a memory, or a CLAUDE.md or rules file the config doesn't
     list as a static rule): propose the guardrail anyway, with its gate row `"conflicts": ["<title> (<location>)"]`
     naming that item, so the user can bring it into the record or drop it.
   - A draft that contradicts an item gets the same row, so the user sees the clash where they decide.
   - Never follow an item outside the record over the plan without asking the user.
3. Propose each: `nexus guardrail propose <name> --text "<one sentence>" --source "<where>" --raised-by claude`.
   A guardrail taken from the user's words is `--raised-by user --quote "<their words>"`, even when you write the
   sentence.
4. Open `guardrails-<phase>`: a mark-list gate with `"step": "guardrails"` and `"log": "guardrails"`, whose rows
   are those guardrails, name and text exactly as proposed. To retire an accepted guardrail on the same gate, give it a
   retire row: `"retire": true`, its name and text exactly as accepted; accepting that row retires it. Never ask for a
   decline to retire one. Stop until the user answers, then `nexus gate apply`.

## 3. Brainstorm (G2, G3)
Invoke `superpowers:brainstorming` with these arguments, then the user's request:

> nexus build <build>, phase <phase>, is active. User instructions for this run:
> - Log each open question with `nexus log add questions <name> --text "<one sentence>" --status exploring
>   --source "<where>"` (later `research` or `answered`), and each settled item the same way with
>   `nexus log add decisions <name> ... --status accepted` (or `declined`).
> - New rules or guards go to `nexus guardrail propose`, never to memory, CLAUDE.md or settings: an accepted
>   guardrail shows in `nexus governance list`; a memory shows only as outside the record.
> - Before logging a decision that sets a standing rule, run `nexus governance list`; record any overlap on the entry
>   with `--note "overlaps <title> (<location>)"`, and raise a contradiction with the user before logging it.
> - Don't offer or start the visual companion. When a question is clearer shown than told, choose a short `topic`
>   naming the question, write each option as a page at `.build/<build>/concepts/<topic>/<option>.html` (the
>   images, fonts, scripts and data it loads sit beside it; a new round gets new ones, never edits to an opened
>   round's), and open a concept-pick gate whose fields follow
>   `${CLAUDE_PLUGIN_ROOT}/reference/gates.md` ("Rounds and topics"), with the `topic` and each option's
>   `"source": "superpowers"`. Stop until it's answered, then run `nexus gate apply` and
>   follow the `Next:` line it prints. Treat brainstorming's companion offer as already made and declined, wherever
>   it would come up (a playback chunk, a moment showing would help), and don't mention it: open a concept-pick
>   round only for a real choice of two or more designs, one round per topic, and describe a single design in text.
> - When the work splits into more than one phase, write them in order to `.build/<build>/phases.json`
>   (`{ "phases": [{ "name": "<phase>", "description": "<what it delivers>" }] }`), and update it whenever a
>   gate adds, splits, reorders or drops one. It is the one place the list is kept.
> - Before writing the spec, open the scope gate (G2, `scope-<phase>`) and wait for it.
> - If the user skips the questions, or brainstorming sizes the work as small, the scope and spec gates still open:
>   open the scope gate from what the request and the build's notes give, and write the spec as usual.
> - If brainstorming runs a builder check, ask the user's questions in chat as it says, and log each answer with
>   `nexus log add decisions`. List those answers and your own calls in a "Decisions to confirm" section of the spec,
>   log each of your calls as a decision with `--note "agent's call"`, and open the spec gate with the spec attached:
>   approving it confirms the section. The check runs once per spec, before the first spec gate.
> - Write the spec to `.build/<build>/documents/specs/<phase>/`, then open the spec gate (G3, `spec-<phase>`) with
>   the spec attached.

**G2, the scope gate** (`scope-<phase>`, `"step": "scope"`): a mark-list of the major pieces of the design;
applying it logs them. Before opening it, check the pieces against each other, the accepted guardrails,
`nexus governance list` and any approved documents, and put each conflict on the row it affects as
`"conflicts": ["<title> (<location>)"]`. Once G2 is applied, `nexus stage plan`.

**G3, the spec gate** (`spec-<phase>`, `"step": "spec"`): an approve gate with `"document"` set to the spec.

## 4. Plan (G4)
After G3 is approved, invoke `superpowers:writing-plans` with:

> nexus build <build>, phase <phase>, is active. User instructions for this run:
> - Write the plan to `.build/<build>/documents/plans/<phase>/`, then open the plan gate (G4, `plan-<phase>`,
>   `"step": "plan"`) with the plan attached.
> - When offering execution approaches, also offer a Workflow (the Workflow tool), used only if the user asks for it.
> - During execution, paste `nexus guardrail list --accepted` into every dispatch brief, and run
>   `nexus ledger import <the run's progress.md>` before deleting the execution workspace.
> - When execution reaches the step that would invoke `superpowers:finishing-a-development-branch`,
>   don't invoke it: run the full test suite and return to `/nexus:plan` step 5.

Once G4 is approved, `nexus stage build`. Execution is Superpowers' own.

## 5. Finish (G5)
With the full suite green on the build branch, open the finish gate:

```json
{ "name": "finish-<phase>", "step": "finish", "type": "approve", "title": "Finish <phase>",
  "why": "Approving closes out the phase on <build branch>, where it stays: nothing merges into main until the build is decommissioned. Send back to keep working." }
```

Tell the user it's waiting in the cockpit, and stop until they answer.

When the user approves:
1. `nexus gate apply finish-<phase>`, `nexus stage close-out`, and commit the build folder, all on the build branch.
2. Don't merge, push or check out `main`: the phase stays on its branch, and the next phase branches from its tip.
   With parallel worktrees, a phase moving `main` changes the files under every other checkout of it; holding the
   work until `/nexus:decommission`, which lands the whole build on `main`, keeps them apart.
3. Keep the build branch: deleting a phase branch is the user's call.

When the user sends it back, the phase stays open: their note says what happens next. Once the work is done, open
`finish-<phase>-2` (then `-3`) the same way. A pull request, or any push, needs the user's go.

Close-out is one-way: only `nexus phase start` leaves it. The build folder stays for the next phase, or for
decommissioning, which the user starts with `/nexus:decommission <build>` once the build's last phase is closed.

## While the phase is active
- Permanent rules (CLAUDE.md, CLAUDE.local.md, AGENTS.md, `.claude/settings*`, `.claude/rules/`, memory,
  `.nexus/config.json`, `docs/_meta/`) are walled. If
  the user asks for a change to one, open an approve gate with a `permit` naming the file and the change; its `why`
  says who proposed the change ("You asked…" only when the user did). Edit the file only after they approve, within
  30 minutes, then apply the gate.
- The repo's permanent record (`docs/governance/decisions.json`, `issues.json` and `builds/`) is walled: log
  decisions and issues in the build (`nexus log add`), and decommission carries what lasts into it.
- Only the cockpit writes `gates/*.answers.json`.
- Never answer a gate yourself by any means: only the user answers, in the cockpit.
