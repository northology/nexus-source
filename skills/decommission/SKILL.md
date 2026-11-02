---
name: decommission
description: Move a finished nexus build's record into the repo's permanent record, archive its documents and keep its final report as the build's record, in one commit. The user starts it as /nexus:decommission <build>.
disable-model-invocation: true
argument-hint: <build>, a build whose last phase is closed (its finish gate approved), e.g. relay-rebuild
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)
---

# Decommission a build

Arguments: $ARGUMENTS

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>` (written `nexus <command>` below).
Add `--build <build>` to every other nexus command when the checkout holds more than one build.

During a build, `.build/<build>/` is the temporary record. Decommission moves it into the repo's permanent record
and removes the folder. It is a transfer, not a review of the build: the user decides one thing, which guardrails
become repo rules. Everything else moves on its own.

| Record | What it is | Where it goes |
|---|---|---|
| Rule | a guardrail, steering, a constraint | each accepted guardrail is a gate row; the user decides |
| Decision | why the scope is what it is, and the run's calls | the report; those of note also the decision log |
| Issue | a bug, a problem, a contradiction, something put off | open: the issues log and report; fixed: the report |
| Question | | stays with the build |

Decommission only the build the user named in this command. Formats are in
`${CLAUDE_PLUGIN_ROOT}/reference/vault.md` ("Decommission") and `${CLAUDE_PLUGIN_ROOT}/reference/gates.md`
("Decommission gates").

## 1. Check
1. Say which build you read from the arguments. With none, run `nexus builds` and ask which one.
2. Run `nexus decommission check <build>`. It refuses unless the build's last phase is closed with its finish
   approved, no other build is active, every gate is applied, the repo has a `docs/` vault this nexus supports, it
   runs from the root of a git repository, the tree is clean outside `.build/<build>/`, git ignores no file inside
   it, and git doesn't ignore `.claude/rules/nexus/`. If it names a problem, tell the user what it says and stop.
3. It prints the build's `base` and `final` commits. `git diff --stat <base> <final>` is what the build changed.

## 2. Draft the final report
Write `.build/<build>/documents/reports/<build> final report.md`, from the build's logs, gates, plan and documents.
It becomes the build's record in the vault: the lasting account of how and why. Its frontmatter carries two lists:

- `decisions: [...]`: the accepted decisions of note, those that affect future development, integration or systems.
  Only these go to the repo's decision log, and `decisions: []` is a choice. Approvals (spec, plan, finish, permits)
  never go there: apply adds them to the record as one line.
- `components: [...]`: the components the build touched, when the repo lists components. Their hubs link the record.

Then the report:

1. **Outcome:** per phase, its goal, what it delivered, and where the result differs from the approved plan.
2. **Guardrails:** every accepted guardrail, with its outcome filled in after the gate (step 4).
3. **Decisions:** under "To the decision log", the ones `decisions:` lists; under "Kept in this record", the other
   accepted decisions, by phase. The user sees the split on the gate.
4. **Issues:** the open ones (they go to the issues log) and the ones the build fixed.
5. **Earlier builds:** the entries earlier builds left in `docs/governance/issues.json` and `decisions.json` that this
   build settles: each issue it fixed and each decision it replaced, by name and build, with why. Step 4 changes
   them, so the user sees the list on the gate. Leave the section out when there are none.
6. **Need to know:** known limits, deliberate omissions and open risks.

## 3. The gate
Run `nexus guardrail list --accepted`. Every guardrail it prints is a row: never leave one out or sort them yourself.
Write the request to a scratch file in `.build/<build>/files/` and run `nexus gate open <file>`:

```json
{ "name": "decommission-<build>", "type": "mark-list", "step": "decommission", "title": "Decommission <build>",
  "why": "Mark each guardrail: accept it to make it a rule for this repo, or decline it to leave it with the build.",
  "document": "documents/reports/<build> final report.md",
  "items": [{ "name": "<the guardrail's name>", "text": "<the guardrail's text>" }] }
```

With no accepted guardrail there are no rows, but the user still approves what the report moves:

```json
{ "name": "decommission-<build>", "type": "approve", "step": "decommission", "title": "Decommission <build>",
  "why": "Approving moves the build into the repo's record as its final report says. Send back to revise it.",
  "document": "documents/reports/<build> final report.md" }
```

If the cockpit isn't running, start `nexus serve --open` in the background and give the user the URL. Tell the user
the gate is waiting in the cockpit, then stop until they answer. When answers arrive, run
`nexus gate apply decommission-<build>` and read every row note. When an approve gate is sent back, revise the report
as its note says and open `decommission-<build>-2` (then `-3`) the same way.

| Mark | What you do |
|---|---|
| accepted | write its rule note (below) |
| research | nothing: the report says it is undecided |
| declined | nothing: the report says it stayed with the build |

A rule note is `docs/governance/rules/<the guardrail's name>.md`, with `class: rule`, `status: active`,
`build: <build>` and `tier: always`, or `tier: scoped` with `paths` when the row note names paths.

## 4. Write what the build leaves behind
- The rule notes, from the table above.
- **Earlier builds' entries:** for each one the report lists, change that entry in its log and nothing else: an issue
  gets `"status": "closed"` and `"closedBy": "<build>"`, a decision `"status": "superseded"` and
  `"supersededBy": "<build>"`. These two logs are written only here, at decommission: the wall keeps them shut while a
  build is active.
- **What changed:** create or update the note for each thing the build touched (system, integration, script,
  dataset, pipeline, method…, by the vault's classes), one note per `source`, and add one line per phase to each
  touched component's change stream for the month: `- yyyy-mm-dd · applied · <what> (<commit>)`.
- **The report:** fill in section 2 with each guardrail's outcome, link the notes you wrote (rules, systems,
  changes) by full path, and finish the rest.

Write nothing else into `docs/`. Apply does the build's record, the archive, this build's log entries and the
generated files.

## 5. Apply
Run `nexus decommission apply <build>` with `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and
`GIT_COMMITTER_EMAIL` set to the commit identity your instructions name, if they name one. A command with variables
in front of `node` falls outside this skill's pre-approved prefix, so expect a permission prompt for it.

It commits the build folder as it stands (`Record <build> before decommission`), so the gate's answers and the whole
record stay in git history. Then, in one commit, `Decommission <build>`, on the branch you are on:

- every spec, plan, report and audit goes to `docs/superpowers/archive/<build>/`, by phase;
- the final report becomes the build's record, `docs/governance/builds/<build>.md` (`class: build-record`), with a
  line of the build's approvals and a link to every archived file;
- the decisions `decisions:` lists go to `docs/governance/decisions.json` and every open issue to
  `docs/governance/issues.json`, each entry carrying the build's name;
- the vault is upgraded if its contract is older, the rule files and hubs are generated, and the vault is checked;
- `.build/<build>/` is removed.

If it stops, the decommission isn't committed and the build folder is in place. Fix what it names and run it again.
Report the commit to the user, and anything it printed. If it says the build folder is still held open, the
decommission is committed: tell the user, who removes it with `git clean -fd .build/<build>/` once nothing uses it
(never delete it yourself).

## Rules
- Never answer a gate yourself by any means (an answers file, a request to the server): only the user answers, in the
  cockpit.
- Never delete `.build/<build>/` yourself, and never write `.claude/rules/nexus/`, the archive, the build's record or
  this build's entries in the two logs: apply does all five. Earlier builds' entries change only as step 4 says.
- Never push, merge or delete a branch: decommission leaves branches as they are.
