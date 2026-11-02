# Contracts

Everything about a build lives in `.build/<name>/` at the repo root, committed on the build's branch. The
JSON Schemas in `../schemas/` are the source of truth. The tables below are generated from them (`pnpm contracts`),
so edit the schemas, not the tables.

## The writing rule

- The cockpit writes only `gates/<gate>.answers.json`, once per gate, and `.nexus/reviews/<name>.answers.json`,
  once per review.
- The agent writes everything else, using the `nexus` command where one exists.
- After editing any JSON by hand, run `nexus check`.

## Folder

```
.build/<name>/
├── build.json
├── logs/        decisions.json, issues.json, changes.json, questions.json
├── plan.json
├── phases.json  the planned phases, in order (optional)
├── gates/       <gate>.json and <gate>.answers.json
├── concepts/    concept HTML pages for concept-pick gates
├── documents/   plans/, specs/, audits/, reports/ (markdown)
├── notes/       the user's notes and the agent's working prose (markdown)
└── files/       scratch and iterative build files
```

## Names and times

- **Names** are readable: lowercase letters and numbers, starting with a letter, in words joined by hyphens, with
  at least three letters in a row (`relay-rebuild`, `spec-review`, `phase-2`). Coded IDs like `d01` are rejected.
- **Times** are ISO 8601. nexus writes them in UTC (`2026-10-02T20:16:29Z`); any explicit offset is also
  accepted. The cockpit shows them in its display zone.

A complete, valid example build is in [examples/.build/relay-rebuild/](examples/.build/relay-rebuild/build.json).

## .nexus/reviews/ (in the repo, written by nexus review open)

Reviews of what the Repo view lists, with or without a build. They aren't committed: `nexus review open` writes a
`.gitignore` of `*` in the folder, since a review can name and quote personal memory files.

- `<name>.json`: the request, in the gate request format with `"type": "review"`. It takes no `options`, `step`,
  `log`, `permit`, `topic` or `document`. Each row adds `item` (the inventory id `nexus governance list --json`
  prints) and `target` (that item's `location`, exactly as the inventory lists it).
- `<name>.answers.json`: written only by the cockpit, once. `marks` takes the gate values: `accepted` is Keep,
  `research` is Adjust, `declined` is Remove. The server stamps `targets`, the files each row's mark may
  change, when at least one row still has a file to change (a row whose item left the list has none).
- `index.json`: `{ "<name>": { "opened": time, "read": time or null } }`; `nexus review apply` sets `read`. `index`
  can't be a review's name.

<!-- generated:contracts:start -->

## build.json

The build's identity, stage and gate bookkeeping.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | readable name | yes | Same as the folder name. |
| `stage` | `planning` / `plan` / `build` / `close-out` | yes | Where the build is. |
| `branch` | string | yes | The git branch the build lives on. |
| `summary` | string | yes | One line on what the build delivers. |
| `created` | time | yes | When the build started. |
| `phase` | readable name | no | The current phase. Builds made before phases have neither field and read as one phase named after the build. |
| `phases` | list of object (fields below) | no | Every phase so far, in order. The stage belongs to the last one. |
| `gates` | map of name → object (fields below) | yes | Every gate opened, by gate name. |

Each `gates` entry holds `opened` (time) and `read` (time, or null until `gate apply` runs).

Each `phases` entry:

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | readable name | yes | The phase's name; also names its finish gate. |
| `branch` | string | yes | The git branch the phase works on. |
| `started` | time | yes | When the phase started. |
| `finished` | time or null | yes | When the phase finished, or null while it is active. |

## logs/<log>.json

Each log file is `{ "entries": [ ... ] }`, and every entry has these fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `phase` | readable name | no | The phase it belongs to; nexus fills it in. |
| `name` | readable name | yes | Unique within its log. |
| `text` | string | yes | The entry itself, in one sentence. |
| `status` | string | yes | Allowed values depend on the log (table below). |
| `source` | string | yes | Where it came from: "chat 11:20", "scope gate", a test. |
| `quote` | string | no | Optional words from the source. |
| `note` | string | no | Optional short note. |
| `commit` | string | no | Optional commit hash, mainly for the change log. |
| `raisedBy` | `user` / `claude` / `agent` | no | Who raised it: the user, the agent running the build, or a helper agent (a subagent, advisor or workflow). Required for guardrails. |
| `task` | string | no | The plan task this entry came from, set by `nexus ledger import`. |
| `topic` | readable name | no | The concept topic a live-mode refinement belongs to; Concepts › Chosen lists it. |
| `time` | time | yes | When it was recorded. |

Statuses per log, for a build's own record. A docs vault's repo-level statuses are set by its class notes (see vault.md):

| Log | Statuses |
|---|---|
| `decisions` | `accepted` / `declined` |
| `issues` | `open` / `addressed` / `closed` |
| `changes` | `applied` / `reverted` |
| `questions` | `exploring` / `research` / `answered` |
| `guardrails` | `proposed` / `withdrawn` |

Guardrails also require `raisedBy`. Whether one is accepted or declined is never stored: it comes from the answers of gates with `"log": "guardrails"` (see gates.md).

## gates/<gate>.json (written by the agent)

Written by the agent. mark-list and review need items, concept-pick needs options (2+), approve has neither.

| Field | Type | Required | Notes |
|---|---|---|---|
| `phase` | readable name | no | The phase it belongs to; nexus fills it in. |
| `step` | `guardrails` / `scope` / `spec` / `plan` / `finish` / `decommission` | no | Which standard step this gate is: one of a phase's five, or decommission, after a build's last phase. The cockpit files the gate under that tab; nexus checks the gate fits the step. |
| `name` | readable name | yes | Same as the file name. |
| `type` | `mark-list` / `concept-pick` / `approve` / `review` | yes | What the user does. A review lives in .nexus/reviews/ and opens with nexus review open. |
| `title` | string | yes | Shown as the gate's heading. |
| `why` | string | yes | One line on what to do and why. |
| `topic` | readable name | no | concept-pick only: the question this round belongs to. Gates with the same topic are its rounds, in the order they opened. |
| `opened` | time | yes | When the gate opened. |
| `items` | list of object (fields below) | no | mark-list and review rows. |
| `options` | list of object (fields below) | no | concept-pick choices. |
| `document` | string | no | Optional Markdown document the review is about: shown beside an approve gate, or above a mark-list's rows. A decommission gate's document is the draft final report, in documents/reports/. |
| `log` | `guardrails` | no | Set on mark-list gates that decide guardrails. Their marks stay in the answers file and decide each guardrail's state; applying them changes no log. |
| `permit` | object (fields below) | no | Approve gates only. Approving lets the agent change one protected file for 30 minutes, until the gate is applied. |

Each item (mark-list, review):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | readable name | yes | Unique within the gate. |
| `text` | string | yes | The point to mark. |
| `source` | string | no | Where it came from, e.g. "chat 11:20". |
| `quote` | string | no | Shown when the user opens the row. |
| `conflicts` | list of string | no | Accepted items, guardrails or documents this row conflicts with. The cockpit shows them on the row. |
| `item` | string | no | review only: the inventory id of the item the row is about. |
| `target` | string | no | review only: the item's location, exactly as the inventory lists it. |

Each option (concept-pick):

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | readable name | yes | Unique within the gate. |
| `label` | string | yes | The option's title. |
| `source` | `self` / `impeccable` / `superpowers` | no | What produced the option. |
| `page` | string | yes | The concept page, a path inside the build such as concepts/quiet-board.html. |

The permit (approve gates only):

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | string | yes | The protected file, relative to the repo root or absolute, e.g. CLAUDE.md. |
| `change` | string | yes | One sentence on the change, shown above the approve button. |

## gates/<gate>.answers.json (written only by the cockpit)

Written only by the cockpit, once per gate. Exactly one of marks, choice, choices, none or decision.

| Field | Type | Required | Notes |
|---|---|---|---|
| `gate` | readable name | yes | The gate answered. |
| `submitted` | time | yes | Set by the server. |
| `marks` | map of name → `accepted` / `research` / `declined` | no | mark-list: one mark per item name. |
| `choice` | readable name | no | concept-pick: the option name. |
| `choices` | list of readable name | no | concept-pick: combine these options in the next round. |
| `none` | `true` | no | concept-pick: none of these; the note says what was missing. |
| `decision` | `approve` / `send-back` | no | approve gates. |
| `note` | string | no | Optional note from the user. |
| `notes` | map of name → string | no | mark-list only: optional notes from the user, by row name. Applying copies each into the note of the log entry its row creates. |
| `log` | `guardrails` | no | Stamped by the server from the gate request: this gate decided guardrails. |
| `texts` | map of name → string | no | Stamped by the server: each row's text exactly as the user saw it. |
| `permit` | object (fields below) | no | Stamped by the server from an approve gate's permit, exactly as the user saw it. |
| `targets` | map of name → list of string | no | Stamped by the server on review answers: the files each row's mark may change, exactly as the user saw them. |

The stamped permit (approve gates with a permit only):

| Field | Type | Required | Notes |
|---|---|---|---|
| `target` | string | yes | The protected file the user approved a change to. |
| `change` | string | yes | The one-sentence change, as the user saw it. |

## plan.json

The tasks of each approved plan, indexed when its plan gate is applied, and the record kept when its run's ledger is imported. Only nexus commands write it.

Each entry in `plans`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Opaque; never shown. |
| `phase` | readable name | yes | The phase the plan belongs to. |
| `gate` | readable name | yes | The plan gate that approved it. |
| `document` | string | yes | The plan document, relative to the build folder. |
| `title` | string | yes | The document's first # heading, or its file name. |
| `indexed` | time | yes | When the tasks were indexed. |
| `tasks` | list of object (fields below) | yes | The plan's `### Task <N>: <title>` headings, in document order. |
| `record` | null or record (fields below) | yes | Kept by `nexus ledger import`: each task's outcome when the run's ledger was imported. Null until then. |

Each task:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Opaque; never shown. |
| `number` | integer | yes | The plan's task number; only joins ledger lines, never shown. |
| `title` | string | yes | How the task is named everywhere a person reads. |
| `steps` | integer | yes | Checkbox steps under the heading. |

When `record` is set:

| Field | Type | Required | Notes |
|---|---|---|---|
| `imported` | time | yes | When `nexus ledger import` kept this record. |
| `ledger` | string | yes | The ledger it was imported from: relative to the repo root, or absolute when it sits outside it. |
| `tasks` | map of name → object (fields below) | yes | Each plan task's outcome, by task ID. |
| `final` | object (fields below) | yes | Counts from the final review. |

Each task in `record.tasks`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `state` | `done` / `incomplete` | yes | `done` once the ledger has the task's completion line. |
| `commits` | string or null | yes | The commit range on the completion line. |
| `note` | string or null | no | The note on the task's completion line, such as its test command or review result. |
| `parked` | integer | yes | How many findings were parked for later. |
| `fixRounds` | list of fix round (fields below) | yes | Each fix round the task's review needed. |

Final review counts:

| Field | Type | Required | Notes |
|---|---|---|---|
| `rulings` | integer | yes | Rulings made in the final review. |
| `minors` | integer | yes | Minor findings the final review deferred. |

Each fix round:

| Field | Type | Required | Notes |
|---|---|---|---|
| `round` | integer | yes | The fix round's number, from 1. |
| `addressed` | integer | yes | Findings this round fixed. |
| `open` | integer | yes | Findings still open after it. |
| `findings` | string or null | yes | What the round's findings were, as the ledger says. |
| `commits` | string or null | yes | The round's commit range. |

## phases.json (optional)

The build's planned phases, in order: the list ideation lays out, kept current as phases are added, split, reordered or dropped. The agent edits it; the cockpit's Phases tab shows it, numbering each phase by its place.

Each entry in `phases`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | readable name | yes | The phase's name, as `nexus phase start` would take it. |
| `description` | string | yes | What the phase delivers, in a sentence or two. |

## .nexus/config.json (in the repo, optional)

Where the repo's standing rules live, and extra files to protect during a build.

| Field | Type | Required | Notes |
|---|---|---|---|
| `staticRules` | list of string | no | Markdown files holding the repo's and workspace's standing rules, relative to the repo root or absolute, no globs. The cockpit shows them read-only; nexus never writes them. |
| `protect` | list of string | no | Extra files to protect during a build: globs relative to the repo root, starting with ~/, or absolute. Added to the defaults; a repo can't remove a default. |

## .nexus/init-answers.json (written by nexus init)

What nexus init was told when it set the repo up, kept as the record of setup.

| Field | Type | Required | Notes |
|---|---|---|---|
| `answers` | `1` | yes | The answers file's format version. |
| `components` | list of string | yes | The repo's components, written to docs/_meta/components.md. |
| `tags` | list of string | yes | Starter tags, written to docs/_meta/tags.md. |
| `seeding` | list of object (fields below) | yes | What already exists that the vault should describe: each a what and a where. init never acts on it; /nexus:plan offers it to the repo's first build. |

## docs/_meta/views/<name>.md (a declared view)

A page the cockpit shows from one data file in the repo, declared in docs/_meta/views/. The note's body describes it. These fields are the note's frontmatter (see extending.md for a recipe per type).

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Lowercase words joined by hyphens; the note is <name>.md. |
| `title` | string | yes | The tab label in the cockpit. |
| `type` | `table` / `markdown` / `chart` / `gallery` | yes | One of the view types nexus ships. |
| `data` | string | yes | The data file (or, for a gallery, a folder) as a path from the repo root, outside docs/. |
| `component` | string | no | A registered component the view belongs to. |
| `table` | object (fields below) | no | Table options. |
| `chart` | object (fields below) | no | Chart options: required for a chart view. |

Table options (`table`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `columns` | list of string | no | Which columns to show, in order. |
| `sort` | object (fields below) | no | The starting sort. |

The starting sort (`table.sort`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `column` | string | yes | The column to sort by, by name. |
| `dir` | `asc` / `desc` | no | Ascending unless desc. |

Chart options (`chart`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `bar` / `line` / `area` / `scatter` | yes | The kind of chart. |
| `x` | string | yes | The column along the x-axis. |
| `y` | string or list of string | yes | The column, or columns, drawn as series. |

<!-- generated:contracts:end -->
