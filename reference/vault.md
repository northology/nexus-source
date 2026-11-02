# The docs vault standard

A repo's `docs/` folder is its vault: the current-state record of what exists, what was decided and how to work on
it. nexus checks it against the registry in `docs/_meta/`.

## The registry

- `docs/_meta/classes/<name>.md`: one note per class. The frontmatter defines the class (`division`, `folder`,
  `produced`, `thing`, `statuses`, `archive`, `required`, `optional`); the first ` ```markdown ` fence in the body is
  the template for its notes.
- `docs/_meta/tags.md` (`vocabulary:`), `docs/_meta/components.md` (`components:`), `docs/_meta/contract.md`
  (`contract:`).
- `docs/_meta/views/<name>.md`: one note per declared view (a cockpit page from one data file); see `extending.md`.
- The registry is walled during a build: change it only through a permit.
- The standard is at contract 3. Contract 2 added the `report` class (archived reports); contract 3 added
  `build-record`, each build's final report kept as its lasting record in `governance/builds/`.
  `nexus docs upgrade [root] [--check]` brings an older vault up: it copies in each standard class note the vault
  lacks and raises `contract.md`, and changes or removes nothing else. It refuses while a build is active;
  decommission runs it for you, in its commit.
- The baseline ships in the plugin's `standard/` folder. A repo adds a class by adding a class note.

## Divisions

`dev/` (agent reference), `data/`, `governance/`, `documentation/` (for people), `design/`, `superpowers/` (outside
`archive/` is the landing zone Superpowers writes to; it isn't checked).
`superpowers/archive/<build>/` holds each decommissioned build's specs, plans and reports by phase; its final
report becomes the build's record in `governance/builds/`. Repos add folders and classes inside them, never new
divisions. `assets/` folders hold files, never notes.

## Notes

Every note names its `class`. Thing classes (systems, datasets, pipelines, methods…) need a `source`, one note per
source. Only governance classes carry a `status`: decisions `accepted` (archive: `superseded`, `retired`), rules
`active` with a `tier` (archive: `retired`), issues `open` or `deferred`. Archive statuses sit under
`governance/archive/`. A resolved issue is deleted; its fix is a `fixes:` line in the change stream.

Typed links (`uses`, `feeds`, `supersedes`, `relates`) are quoted wikilinks with the full path from `docs/`:
`uses: ["[[data/datasets/event-log]]"]`. nexus reads them from the files itself; Obsidian still displays them, and
nexus doesn't depend on how.

No JavaScript query blocks (`dataviewjs`, `datacorejs`) and no Dataview inline fields in repo notes.

## Checking

- `nexus docs check [root] [--file <p>] [--stale] [--json]`: every note, or one; exit 1 on a blocking finding, 2
  when `--file` isn't a note in the vault.
- `nexus doctor docs`: the bundle, the hook and the registry.
- After each Write or Edit to a vault note, a PostToolUse hook reports findings: fix blocking ones before moving on.
- `bin/docs-check.mjs` runs the same check with no plugin, for pre-commit and CI.

## Setting a repo up

- `nexus init [root] [--answers <file>] [--no-plugins] [--check]`, or `/nexus:init`, which asks the questions first.
  Once per repo: it writes `docs/_meta/` (with the answers' components and tags), `docs/.obsidian/` with the pinned
  plugins and theme, and `.nexus/init-answers.json`, and only adds to `.claude/settings.json` (nexus enabled),
  `CLAUDE.md` (a marked block), `.gitignore` (`.scratch/`, Obsidian's workspace files) and `.ignore` (the archives).
  Everything is checked first; a conflict, an existing `docs/_meta/` or a failed download leaves the repo unchanged.
- `nexus obsidian install [root] [--check]` downloads the pinned plugin and theme files a vault is missing, each
  checked by hash; it never replaces a file. Use it after `init --no-plugins`, or on a clone that lost them.
- Two environment variables change where `init` and `obsidian install` read from, and both say so when set:
  `NEXUS_STANDARD_DIR` (another `standard/` folder) and `NEXUS_OBSIDIAN_MIRROR` (a local folder laid out as
  `<host>/<path>`, for offline installs; files are still checked against their pinned hashes).
- The answers file's `seeding:` lines are what the vault should describe from the start. `init` never writes them;
  `/nexus:plan` offers them to the repo's first build.

## Generated files

`nexus docs generate [root] [--check]` writes one `.claude/rules/nexus/<note>.md` per active rule note (a scoped rule
gets `paths:`) and one hub per component in `docs/dev/context/`. Each carries a marker naming its source and a hash.
Marked files whose source is gone are removed; an unmarked file stops it. `--check` writes nothing and exits 1 on
anything missing, stale, edited or orphaned. It runs at `init`, after seeding and at decommission, never per write.

The checker blocks `generated-modified` (a marked file changed after nexus wrote it: regenerate, and edit the source
to change what it says), `class-file-name` (a class note not named `<name>.md`) and `archive-build-folder` (an archived
superpowers note outside the folder its `build:` names).
Views add `view-invalid` and `view-file-name` (block) and `view-data-missing` (warn).

## Decommission

Once a build's last phase is closed, `/nexus:decommission <build>` moves its record into the repo's permanent
record and removes `.build/<build>/`.

| Record | What it is | Where it goes |
|---|---|---|
| Rule | a guardrail, steering, a constraint | the user marks each accepted guardrail at the `decommission-<build>` gate (gates.md); accepted becomes a rule note |
| Decision | why the scope is what it is, and the run's implementation calls | the final report; those of note also `docs/governance/decisions.json` |
| Issue | a bug, a problem, a contradiction, something put off | open: `docs/governance/issues.json` and the final report; fixed: the final report |

The final report becomes the build's record, `docs/governance/builds/<build>.md` (class `build-record`): the
lasting account of the build, one hop from the current state. It carries `components` (the components the build
touched, whose hubs list it under Builds) and `nex-category: build-record`, which the shipped graph settings colour,
so records stand apart from current-state notes in Obsidian's graph. Its specs, plans, reports and audits stay in
the archive, which Obsidian and agent search pass over, and the record links each one.

Only decisions of note reach the decision log: those that affect future development, integration or systems, which
the agent lists in the draft's `decisions:`. Approvals (spec, plan, finish, permits) stay in the record as one line, and
every other decision stays in its Decisions section.

The two logs are one record each for the whole repo, kept as data so they can be searched and queried. Each is
`{ "entries": [...] }`; an entry is the build's log entry (`name`, `text`, `status`, `source`, `time`, `phase`) with
`build` added. A decommission replaces its own build's entries and leaves every other build's, except those its
final report says it settles: an earlier issue it fixed becomes `closed` with `closedBy`, an earlier decision it
replaced `superseded` with `supersededBy`.

The logs and `governance/builds/` are written only at decommission: during a build the wall protects them, without
permits, and the build logs what it finds in `.build/<build>/logs/`. Seeding, change entries and rule notes aren't
walled.

- `nexus decommission check <build>` refuses unless the build is closed, no other build is active, every gate is
  applied, the vault is one this nexus supports, it runs from the root of a git repository and the tree is clean
  outside the build folder, git ignores no file inside it, and git doesn't ignore `.claude/rules/nexus/`. It prints
  the build's `base` and `final` commits.
- The agent drafts the final report in the build (with `decisions:` and, where the repo lists them, `components:`),
  opens the gate, then writes a rule note for each accepted row and the notes for what the build changed (thing
  notes and change entries).
- `nexus decommission apply <build>` first commits the build folder as it stands (`Record <build> before
  decommission`), so the gate's answers and the whole record stay in git history. Then, in one commit on the
  current branch (`Decommission <build>`): each spec, plan, report and audit goes to
  `docs/superpowers/archive/<build>/` by phase, with `class` and `build` set and the files beside it; the final
  report becomes the build's record; the decisions of note and the open issues go to the logs; the vault is
  upgraded if its contract is older; the rule files and hubs are generated; the vault is checked; and the build
  folder is removed. If anything fails, the decommission isn't
  committed and the build folder stays. It never merges, pushes or deletes a branch.
