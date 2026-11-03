# Superpowers integration

nexus runs planning through Superpowers (brainstorming, writing-plans, execution) and never edits it. This file lists
every point where nexus depends on Superpowers, so an update that moves one is caught. `nexus doctor superpowers`
checks the anchors at the end of this file against the installed Superpowers. Run it after every Superpowers update.

nexus supports Superpowers 6.4.1, 7.0.0 and 7.0.1. Where their wording differs, the row below names both, and the
anchor lists each version's wording; the doctor says which one it found. 6.4.1 support goes once nothing still runs it.

## How the two connect

| Superpowers skill | What nexus relies on | What depends on it | What you see when it breaks |
|---|---|---|---|
| `brainstorming` | the spec location yields to the user: 6.4.1 "(User preferences for spec location override this default)", 7.0.0 "Your human partner's preferences override both." | `/nexus:plan` sends the spec to `documents/specs/<phase>/` | specs head for `docs/superpowers/specs/`, and the wall refuses them |
| `brainstorming` | the companion is offered at a moment nexus can override: 6.4.1 "Offer the visual companion just-in-time", 7.0.0 "**Offer it just-in-time.**" (7.0.0 also offers it during playback and whenever seeing would help) | `/nexus:plan` treats the offer as made and declined, and shows real choices as concept-pick rounds | the companion may open its own tab again, and choices made there skip the build's record |
| `brainstorming` | how the spec is checked before the user sees it: 6.4.1 the agent's own "**Spec Self-Review:**", 7.0.0 the "**Builder check:**" instruction, a fresh subagent with `builder-check-prompt.md` | `/nexus:plan`'s builder-check line: questions asked in chat and logged, then listed in the spec's Decisions to confirm for the spec gate | the spec reaches the gate unchecked, or the check's questions and the agent's calls skip the build's record |
| `writing-plans` | "(User preferences for plan location override this default)" | `/nexus:plan` sends the plan to `documents/plans/<phase>/` | plans head for `docs/superpowers/plans/`, and the wall refuses them |
| `using-superpowers` | user instructions "take precedence over skills" | every nexus override is a user instruction | Superpowers may stop honouring the overrides |
| `subagent-driven-development`, `executing-plans` | ledger lines "Ruling: <what you decided> …" and "minor (deferred)" | `nexus ledger import` | rulings and deferred minors stop reaching the logs |
| `subagent-driven-development` | the ledger lives at `<workspace>/progress.md` | the reminder's ledger-import line | the import has no file to read |
| `subagent-driven-development`, `executing-plans` | the ledger's first line "# SDD ledger — plan: <path>" and "Task <N>: complete (commits …)" lines | the Plan section, live, and the record `nexus ledger import` keeps | tasks stay pending in the Plan section |
| `subagent-driven-development`, `executing-plans` | the hand-off line "Use superpowers:finishing-a-development-branch" | `/nexus:plan`'s step-4 override replaces the hand-off with the finish gate | execution may end in Superpowers' merge menu instead of the finish gate |
| `finishing-a-development-branch` | the skill exists under that name | the override names it | the override names a missing skill |

## Known gaps in the wall

- **Indirect shell writes:** commands that write through an interpreter or a script (`python -c "…"`, `node -e "…"`,
  a script file), and `dd`, `curl -o`, `wget -O`, `rsync`, `find -delete`, `git checkout` and `git restore`, aren't
  seen. The guard reads the common write forms: redirects (including `>|`), `tee`, `cp`/`mv`/`install` (including
  `-t`), `ln`, `sed -i`, `rm`, `touch`, shell wrappers (`bash`/`sh`/`zsh -c`, `pwsh`/`powershell -Command`,
  `cmd /c`, re-scanned), prefixes (`env`, `time`, `nohup`, `sudo` and the like), and `Set-Content`, `Add-Content`,
  `Out-File`, `Clear-Content`, `New-Item`, `Remove-Item`, `Copy-Item`, `Move-Item`, `Rename-Item` and their aliases.
  A leading `~`, `$HOME` or `${HOME}` is expanded, and on Windows `$env:USERPROFILE`, `%USERPROFILE%` and
  `$USERPROFILE` too. `$PWD` is the session's folder (unknown once the line changes folder). Other variables take
  their value from the environment the hook runs in, unless the command sets them. Where part of a path can't be
  known (a variable the command sets or the environment lacks, `$(…)`, a backtick, PowerShell's `(Join-Path …)`,
  an `xargs -I` replacement), the write is judged by the parts that can be seen, on both sides of the unknown:
  during a build, `$D/CLAUDE.md`, `$(pwd)/CLAUDE.md`, `.claude/rules/$X.md` and `.build/b/gates/$G.answers.json` are
  refused, `$OUT/log.txt` isn't. A path that is entirely unknown (`rm $f`, `> "$out"`) isn't judged at all, and
  neither is a protected path the unknown part hides (`D=.claude/rules; rm $D/x.md`). A glob in a removal
  (`rm -rf .claude/*`, or `rm -rf *` run from the repo root) is expanded against the disk, as the shell will expand
  it, and each file it takes is judged; opened concept pages are matched against the glob itself. A `**` glob, or
  one naming over 2,000 files, is judged as removing the folder before its first glob (`rm -rf .claude/**` is
  refused). Globs in other commands aren't expanded. `git rm` and `git mv` aren't read.
- **Deletes and moves:** `rm`, `rmdir`, `unlink`, `del`, `Remove-Item` and their aliases, and the sources of `mv`,
  `Move-Item` and `Rename-Item`, are refused when they name a protected file or a folder that holds one by its
  pattern (`.claude`, `.claude/rules`, `.build`, a build folder, `docs` above `docs/superpowers`, the repo root). A
  folder that holds a protected file only through "any folder" (`packages/` above `packages/app/CLAUDE.md`) isn't
  caught. Deleting or moving a folder that holds an active build's repo, directly or one level down, is refused;
  deeper nesting isn't checked. A rename's new name (`Rename-Item a CLAUDE.md`, `ren`, `-NewName`) counts as a write.
- **Answering through the server:** a local process can read the cockpit page's token and post answers, and the
  guard can't see network calls. It refuses, best effort, a Bash or PowerShell line that sends the token or posts to
  an answers route through `curl`, `wget`, `Invoke-WebRequest`, `Invoke-RestMethod` or `fetch` while a build is
  active. A `git fetch` command isn't read as an HTTP client; any other `fetch` is. A script or another client gets
  through. The skills tell the agent never to answer a gate itself.
- **MCP tools that write files aren't covered.** The guard runs on Write, Edit, MultiEdit, NotebookEdit, Bash and
  PowerShell.
- **Paths are matched as strings** after normalization (drive letters, drive-relative `E:file`, `/e/`,
  `/cygdrive/e/` and `/mnt/e/` forms, `\\?\` prefixes, admin shares of this machine, nested quotes, trailing dots
  and spaces, `..` segments). `/w/repo` is checked both as drive W and as a folder on the current drive. Case is
  folded on Windows and macOS. A path through `\\?\GLOBALROOT` or `\\?\Volume{…}` is refused during a build. 8.3
  short names, symlinks, junctions and NTFS streams aren't resolved. A `protect` entry containing `..` is ignored and
  reported.
- **Where the build is found:** a written file is judged by the build root that contains it (its own targets and
  its own permits). The session's build root also judges files that sit in no build root, such as memory folders, a
  workspace-level `CLAUDE.md` or a sibling repo with no `.build/`. A repo whose own builds are all in close-out is
  judged by the nearest repo above it with an active build, if any; a sibling repo's builds don't reach it. The
  per-turn reminder looks only from the session's folder.
- **Permits** are read from the cockpit-stamped answers file. `build.json` is walled, but an indirect write can
  still reset its read record, which reopens an applied permit only inside its 30-minute window.
- **Ending a phase:** a build stops holding the wall up only when its stage is `close-out` and the cockpit's answer to
  its `finish-<phase>` gate approves; `build.json` itself is walled, so build state changes through `nexus stage` and
  `nexus phase`. Left open: an indirect write can roll `phase` back to an earlier phase whose finish gate was
  approved, and renaming or deleting a build folder by means the guard doesn't read (it refuses `rm`, `mv` and
  their PowerShell forms on `.build/` and a build folder) lowers the wall. A build moved to close-out before this
  check existed, with no approved finish gate, stays walled until it's finished through `finish-<phase>`.
- **When the guard can't run** (a broken plugin build, hook input it can't read), the hook's loader refuses writes in
  repos with a build in progress (a session or written file inside one) and stays silent otherwise, so finished and
  unrelated repos keep working. `nexus doctor guard` says why. A guard that hangs past the hook's 10-second timeout
  still lets the write through.
- **Concept pages:** the refusal of an edit to an opened concept page shares the wall's path and shell parsing, so it
  has the same gaps (indirect writes, an interpreter or a script). It holds only while the page's own build is
  active, and it judges only pages a gate request names. If the build's `gates/` folder can't be read, writes to its
  concept pages are refused.

## Verified behaviour

Probed on 2026-10-03 with Claude Code 2.1.288: a `PreToolUse` deny (the JSON `hookSpecificOutput` form, exit 0)
stopped a Write in the main session and in a subagent, in bypass-permissions mode. Hook input fields seen:
`session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `hook_event_name`, `tool_name`,
`tool_input`, `tool_use_id` and `effort`. A subagent's call adds `agent_id` and `agent_type` and carries the parent
session's `cwd`.

## Anchors

<!-- anchors:start -->
```json
[
  { "file": "skills/brainstorming/SKILL.md", "text": [{ "version": "6.4.1", "text": "(User preferences for spec location override this default)" }, { "version": "7.0.0", "text": "Your human partner's preferences override both." }], "breaks": "Specs head for docs/superpowers/specs/ instead of the build; the wall refuses them." },
  { "file": "skills/brainstorming/SKILL.md", "text": [{ "version": "6.4.1", "text": "Offer the visual companion just-in-time" }, { "version": "7.0.0", "text": "**Offer it just-in-time.**" }], "breaks": "/nexus:plan's companion override may stop matching, and choices could be made outside the cockpit again." },
  { "file": "skills/brainstorming/SKILL.md", "text": [{ "version": "6.4.1", "text": "**Spec Self-Review:**" }, { "version": "7.0.0", "text": "**Builder check:**" }], "breaks": "/nexus:plan's builder-check line may stop matching, so the spec could reach the gate unchecked, or the check's questions could skip the build's record." },
  { "file": "skills/writing-plans/SKILL.md", "text": "(User preferences for plan location override this default)", "breaks": "Plans head for docs/superpowers/plans/ instead of the build; the wall refuses them." },
  { "file": "skills/using-superpowers/SKILL.md", "text": "take precedence over skills", "breaks": "Superpowers may stop honouring nexus's overrides." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": "Ruling: <what you decided>", "breaks": "nexus ledger import may stop finding rulings." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": [{ "version": "6.4.1", "text": "minor (deferred)" }, { "version": "7.0.1", "text": "minor (deferred)", "file": "skills/subagent-driven-development/references/fix-loop.md" }], "breaks": "nexus ledger import may stop finding deferred minors." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": "progress.md", "breaks": "The ledger nexus imports may have moved." },
  { "file": "skills/executing-plans/SKILL.md", "text": "Ruling: <what you decided>", "breaks": "nexus ledger import may stop finding rulings from inline runs." },
  { "file": "skills/executing-plans/SKILL.md", "text": "minor (deferred)", "breaks": "nexus ledger import may stop finding deferred minors from inline runs." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": "Use superpowers:finishing-a-development-branch", "breaks": "/nexus:plan's override no longer matches how execution hands off, so a run may end in Superpowers' merge menu instead of the finish gate." },
  { "file": "skills/executing-plans/SKILL.md", "text": "Use superpowers:finishing-a-development-branch", "breaks": "/nexus:plan's override no longer matches how inline execution hands off, so a run may end in Superpowers' merge menu instead of the finish gate." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": "# SDD ledger — plan:", "breaks": "The Plan section can't tell which plan a run's ledger executes, so its tasks stay pending." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": "Task <N>: complete (commits", "breaks": "The Plan section stops seeing tasks finish." },
  { "file": "skills/executing-plans/SKILL.md", "text": "Task <N>: complete (commits", "breaks": "The Plan section stops seeing tasks finish in inline runs." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": [{ "version": "6.4.1", "text": "Task <N>: fix round <R>/5 (" }, { "version": "7.0.1", "text": "Task <N>: fix round <R>/5 (", "file": "skills/subagent-driven-development/references/fix-loop.md" }], "breaks": "The Plan section stops showing a task's fix rounds." },
  { "file": "skills/subagent-driven-development/SKILL.md", "text": [{ "version": "6.4.1", "text": "Task <N>: parked —" }, { "version": "7.0.1", "text": "Task <N>: parked —", "file": "skills/subagent-driven-development/references/fix-loop.md" }], "breaks": "The Plan section stops counting a task's parked findings." },
  { "file": "skills/finishing-a-development-branch/SKILL.md", "text": "name: finishing-a-development-branch", "breaks": "/nexus:plan's step-4 override names a skill that no longer exists." }
]
```
<!-- anchors:end -->
