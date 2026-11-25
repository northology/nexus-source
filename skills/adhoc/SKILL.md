---
name: adhoc
description: "Bring the repo's docs/ vault up to date after work done outside a nexus build: the notes for the code that changed, and the month's change entries. The user starts it as /nexus:adhoc at the end of an update or job."
disable-model-invocation: true
argument-hint: "[--since <ref>]; from the repo's root, with no build active"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)
---

# Sweep the docs vault after work outside a build

Arguments: $ARGUMENTS

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>` (written `nexus <command>` below).

A build brings the vault up to date at its decommission. Work done outside a build (a fix, an update, an iterative
job) has no decommission, so this sweep does that part of one: the notes for what changed, and the change stream. It
writes, then shows the user the diff. Nothing is committed unless the user asks.

## 1. Find what changed
1. Run `nexus builds`. If a build is active, stop and tell the user: during a build the vault is written only at its
   decommission, which records this work too.
2. Run `nexus docs touched`, with `--since <ref>` when the arguments name one. It lists each thing note whose `source`
   covers a changed path, then the changed paths no note covers, counted from the change stream's last commit (or the
   commit that set the vault up). If it lists nothing, tell the user the vault is current and stop.
3. Read what changed in those paths (`git diff <base> -- <path>`, and the untracked files) before writing anything.

## 2. Write
- **Touched notes:** update each listed note so it describes the code as it now stands, one note per `source`. When
  every path under a note's source is gone (`D`), give the note the status its class has for that
  (`docs/_meta/classes/`), or remove it if the class has none, and say which.
- **Uncovered paths:** create a note, by the vault's classes, for each that is a new thing (a system, integration,
  script, dataset, pipeline, method…). Leave out what isn't one: tests, config, lockfiles, and small changes inside
  something a note already describes. Tell the user which you left out.
- **Change stream:** add one line per piece of work to each touched component's file for the month,
  `docs/governance/change/<yyyy-mm>-<component>.md`: `- yyyy-mm-dd · applied · <what> (<commit>)`. For work not yet
  committed, write `(uncommitted)` and tell the user to put the commit in once it exists. A new month's file follows
  the last one's frontmatter.

Write nothing else in `docs/`: no rule notes, `_meta/`, decision or issue log entries, or build records. A rule, a
decision of note or an open issue you notice goes to the user in your summary: those are settled in a build.

## 3. Check and show
1. Run `nexus docs generate`, then `nexus docs check`, and fix every block it reports in the notes you wrote.
2. Show the user `git status --short -- docs` and `git diff --stat -- docs`, then summarise each note you wrote or
   changed and why, and what you left out.
3. Commit only when the user asks: stage the paths you wrote by name (never `git add -A`), under the commit identity
   your instructions name.
