---
name: audit
description: "Review how far the repo's docs/ vault still matches its code: each note against its source, each open issue against the code, each active rule against what it governs, and what no note covers. Read-only: it brings back a report and an action list, and changes nothing. The user starts it as /nexus:audit."
disable-model-invocation: true
argument-hint: "[component ...]; from the repo's root"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *), Bash(git log *), Bash(git diff *), Bash(git show *)
---

# Audit the docs vault against the code

Arguments: $ARGUMENTS

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>` (written `nexus <command>` below).

The audit is a routine reviewer, not a fixer. It reads the code, git history and the vault, and writes only its own
report under `.scratch/audits/`. Nothing in `docs/`, the code or the logs changes until the user picks actions.

## 1. Gather
1. Run `nexus docs audit --json` and save its output as `.scratch/audits/<yyyy-mm-dd>-audit.json` (`-2`, `-3` for
   another run that day). It lists each thing note with its source and the commits since the note, the files no note
   covers, the open issues and the paths they name, the active rules, unresolved links and generated drift.
2. Read `docs/_meta/components.md` and the hubs in `docs/dev/context/`. Each component is one slice of the review;
   the open issues and the active rules make one more, `shared`. With components named in the arguments, review
   only those slices, and `shared` only when it is named.
3. Run `nexus builds`. If a build is active, the report says so: its actions are logged in that build.

## 2. Review
Give each slice the reviewer brief, `${CLAUDE_PLUGIN_ROOT}/skills/audit/reviewer.md`, and its part of the audit JSON:
the component's notes and uncovered entries, or for `shared` the open issues and active rules. If you can start
subagents, give each slice to its own, in parallel, and tell each it may only read. If you can't, follow the brief
yourself, one slice at a time. Each returns findings in the brief's format.

Then try to refute what would cost most if wrong: for every finding with the verdict `contradicted`, `violates` or
`likely fixed`, have a fresh reviewer (or yourself, rereading only the cited lines) try to show it wrong. Drop a
finding that doesn't survive, or keep it as `can't tell` and say why.

## 3. Report
Write `.scratch/audits/<yyyy-mm-dd>-audit.md`:

1. **Summary:** the commit audited (`head`), the slices, and the count of findings by verdict.
2. **Issues:** what is wrong, broken or contradicted, by question (notes, open issues, rules, coverage), each with
   its evidence and your reading kept apart.
3. **Optimization:** duplicated or bloated notes, missing typed links (`uses`, `feeds`), always rules that could be
   scoped, coverage gaps worth a note, unresolved links and generated drift.
4. **Checked and fine:** the notes, issues and rules that held, by name, so the next audit can compare.
5. **Actions:** a checklist, one line each, numbered from A1:
   `- [ ] A<n> · <kind> · <target>: <what is wrong, with file:line or commit> → <proposed step> (<who>)`.
   Kinds: update note, retire note, add note, close issue, fix code, scope rule, review rule. Who: `agent, on your
   OK` for note work, `your call` for issues, rules and code.

Show the user the summary, the action list and the report's path, then stop. Change nothing until they say which
actions to take.

## 4. The actions the user picks
- **Note work** (update, retire, add), outside a build: as /nexus:adhoc writes notes and change entries (its step 2),
  then `nexus docs generate` and `nexus docs check`. During a build, log it in the build instead: its decommission
  writes the vault.
- **Close issue:** an issue note is deleted, with a `fixes:` line in its component's change stream naming the
  commit. A log entry in `docs/governance/issues.json` changes only as the user says: outside a build, its `status`
  becomes `closed` and `closedBy` names the commit; during a build, it goes in the final report's "Earlier builds".
- **Rules and code:** the user decides each. A rule change goes through a build's gate; a code fix is its own work.
- Commit only when the user asks: stage the paths you wrote by name (never `git add -A`), under the commit identity
  your instructions name.
