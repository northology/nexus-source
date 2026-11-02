# Cockpit

The cockpit is a local web app served by `nexus serve` at `http://127.0.0.1:4410/`. If that port is taken, it
uses the next free one and prints the address. It reads `.build/` and, in Repo mode, the repo's standing
instructions, and writes nothing except the answers to gates and to reviews.

## Navigation

1. **Rail categories:** Gate, Plan, Phases, Logs, Concepts, Documents, Guidance. The **Build | Repo** switch in the
   top bar swaps in the Repo rail ([Repo mode](#repo-mode)).
   Guidance is the guide for people using nexus, built into the cockpit from `reference/guide/`; it reads no build,
   so it has no count and stays reachable with no build, offline or while choosing a build (the rail then holds it
   alone). `?h=<heading slug>` scrolls to a heading; an unknown one shows the page from the top.
2. **Sub-menu** along the top:
   - Logs: `decisions`, `issues`, `changes`, `questions`.
   - Concepts: `proposed` (the default: concept rounds waiting for you, one at a time, and pages in no round) and
     `chosen` (one topic at a time: its pick, and the lineage of its rounds with what each kept and dropped, then
     its Refinements: log entries tagged with the topic, oldest first, within the selected phase). A topic shows
     under a phase when it has rounds or refinements there, so a concept chosen in one phase and refined in a later
     one shows under both; under the later phase its lineage holds none of its rounds, and "Show all phases" brings
     them back.
   - Documents: `plans`, `specs`, `audits`, `reports`, `notes`.
   - Guidance: `overview` (the default), `flow` (how a build runs), `commands`, `views` (how to declare a view).

   **Compare.** A concept round, in Proposed or the Gate view, can show two options at once. Tick two (the
   **Combine** box; **Compare** on an answered round) and press **Compare** in the bar above the frame. **Side by
   side** puts the two pages at half width, each with its label, source and a **Pick** button (none on an answered
   round); below 900px wide they stack. **Swipe** lays the first page over the second at the same size, cut off
   at the edge the **Reveal** slider sets (arrow keys move it). The pages scroll separately: each is its own frame
   on another origin. Combine, None of these and the note sit below the pages. Full view works while comparing.
   **One at a time** or Esc returns to the single page (Esc leaves full view first), and so does unticking either
   option.
3. **View bar:** slice, view mode, search, status toggles, match count, copy this view.

## View links

The view lives in the URL hash, so a link opens the cockpit at exactly that place:

```
#/<category>[/<sub-page>][?<params>]
```

| Param | Meaning | Example |
|---|---|---|
| `show` | statuses shown, comma-separated | `show=open,addressed` |
| `q` | search text | `q=replay` |
| `mode` | view mode, where a section has several | `mode=diagram`, `mode=board` |
| `slice` | scope or slice, where a section has several | `slice=relay` |
| `phase` | the phase shown in Logs, Documents, Gate, Plan and Concepts (`all` for every phase, except in Plan) | `phase=dashboard` |
| `tab` | the Gate tab to show when no gate is named (`guardrails`, `scope`, `spec`, `plan`, `finish`, `decommission`, `permits`, `other`) | `tab=finish` |
| `doc` | the open document, as a build-relative path | `doc=documents/specs/relay-rebuild-spec.md` |
| `task` | the task open in Plan, by its ID | `task=t-9c2e7b10` |
| `plan` | an earlier plan of the phase, shown read-only in Plan, by its ID | `plan=p-3f9a1c2e` |
| `round` | the concept round shown in Concepts › Proposed, by its gate name: open, or answered and shown read-only (default: the oldest open round) | `round=legend-1` |
| `page` | a concept page in no round, shown in Concepts › Proposed, as a build-relative path | `page=concepts/scratch.html` |
| `topic` | the topic shown in Concepts › Chosen (default: the most recently answered) | `topic=status-look` |

For example: `http://127.0.0.1:4410/#/logs/issues?show=open,addressed&q=replay`.

## Which file feeds which section

| Section | Files |
|---|---|
| Gate | `gates/*.json`, `gates/*.answers.json`, `build.json`. A decommission gate's tab, Decommission, shows only when the build has one, with its document (the draft final report) above its rows. |
| Plan | `plan.json` (tasks indexed at the plan gate, and the record kept at `nexus ledger import`); while a run is live, its ledger `.superpowers/sdd/*/progress.md` |
| Phases | `phases.json`: the build's planned phases in order, each numbered by its place; a build without one shows how to add it |
| Logs | `logs/decisions.json`, `logs/issues.json`, `logs/changes.json`, `logs/questions.json` |
| Concepts | concept-pick gates (`gates/*.json`, `gates/*.answers.json`) and the pages in `concepts/**/*.html` (a page no gate names shows under "Not in a round"). Gates sharing a `topic` are rounds of one topic. Every concept page renders inside the cockpit in a sandboxed `<iframe>`, loaded from the asset origin (below) so the fonts, modules and data beside it load. The Concepts section and rounds open no new tab; a Markdown document's link to a concept page opens it in a new tab on the asset origin, sandboxed by that origin's CSP. |
| Documents | `documents/**`, `notes/**`: Markdown, `.csv`, list-of-objects `.json` and images, each shown by type, with a folder's images as one gallery; a table over 5 MB is named, not fetched |

## Repo mode

The **Build | Repo** switch in the top bar moves between the build's record and the repo's standing instructions: what
an agent loads from the repo, the folders above it and the user's and managed settings to know how to work here. It is
not everything a session loads (see [What the inventory doesn't list](#what-the-inventory-doesnt-list)). A checkout
with no build opens on Repo › Overview. Each side keeps its own last route, and the open build travels with the
switch, so a checkout with several builds skips the picker on the way back.

The Repo rail:
- **Overview:** three counts (outside the record, recorded, this build) and every item, grouped by when it loads:
  always, path-scoped, on demand, or for this build; any item that couldn't be read, with its reason, above the rest;
  and a footnote naming what isn't listed. The rail counts the items outside the record.
- **Decisions, Rules, Issues:** the vault's governance notes; Rules also holds the files generated from them in
  `.claude/rules/nexus/`.
- **Instructions:** `CLAUDE.md` and `AGENTS.md` files in the repo, the folders above it, the user's config folder and
  the managed-policy folder, with the files they import; and `.claude/rules/` files in the repo, the user's config
  folder and the folders above. An `AGENTS.md` that Claude Code won't load, because the repo or a folder above has a
  `CLAUDE.md`, says so in its row and the reader.
- **Memory:** Claude Code's memory for sessions in this repo (or in the folder `autoMemoryDirectory` names, from any
  settings scope), and for sessions launched from each folder above it. Like Claude Code, it keys the repo's memory by
  its git repository: a worktree or a subfolder shares the main checkout's (found from `.git`, its `gitdir:` and
  `commondir`, with no git process), and `CLAUDE_CODE_PROJECT_DIR_NAME` names the folder when it is set.
- **Guardrails:** the accepted guardrails of every active build, with a link across to Logs › Guardrails.
- **Views:** the repo's declared views, one tab each; [extending.md](extending.md) has a recipe for each type.
- **Guidance:** as on the Build side.

Each item has a record: `recorded` (a vault note), `generated` (a file nexus wrote from a note), `build` (an accepted
guardrail) or `outside` (anything else, such as a `CLAUDE.md`, a hand-written rules file or a memory). Search and the
record toggles filter the list. Pick an item and the reader opens beside the list: where it lives, when it loads,
whether it's recorded, then its text. An HTML comment in a standing-rule file (the reader, and the static rules under
Build › Guardrails) shows dimmed with a `comment` label, since it may still reach the agent; in a document it is hidden.
An item or view removed while it's open says it is no longer here. No section
shows an error for what a repo hasn't set up. With no `docs/` vault, Overview, Decisions, Rules, Issues and Views say
to run `nexus init`, since views are notes in the vault; a vault with no declared views says how to declare one; an
empty Memory or Guardrails section says what fills it, and any other empty section says it has nothing yet.

While a review is open (gates.md, "Review gates"), a banner sits above every section but Views: what it asks, how
many rows wait, any row whose item left the list ("No longer listed"), the note and Submit. Each item it names shows
Keep, Adjust and Remove with a note, on its card and in the reader; both edit one draft. The marks lock while the
answers are sent and once they are sent. A review that can't be read is named in a notice above the list; the rest
still show.

Changes show live: every 2 s, and at once on a file event under `docs/` or `.claude/`, the server compares the size and
time of every item, every view's note and data, and each build's guardrail log and gate files. Files in folders below
the repo root are found on a slower walk: about every 30 s, and when Repo mode opens more than 5 s after the last one.
A poll reads no file whose size and time haven't changed. `nexus governance list` prints the same inventory in a
terminal. The inventory reads the user's instructions and memory from `CLAUDE_CONFIG_DIR` (else `~/.claude`), memory
moved by `autoMemoryDirectory` from where that names, and never writes. A link to a network or device path, or to
another drive, is never followed: the item, folder or view data it leads to is named as a problem instead.

### What the inventory doesn't list

The inventory is what nexus can find from the repo root, not everything a session loads. It doesn't list:

- Output styles, context that hooks add, skill listings, `--append-system-prompt` and the managed `claudeMd` setting.

Files in folders below the repo root (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `AGENTS.md` and nested
`.claude/rules/`) are listed under their folder, each saying when Claude Code loads it. The project-instructions
setting is read from managed and user settings; a `--settings` file given at launch can't be seen, and the Overview
says which value it read and where. Its values are `claude-md-or-agents-md` (the default), `claude-md-and-agents-md`,
`claude-md` and `managed-only`; a file the value says Claude Code won't load shows as "not loaded".

The subfolder walk doesn't descend into `.git`, `node_modules`, `.build`, `.claude` folders, the vault's two archives
(`docs/governance/archive` and `docs/superpowers/archive`) or anything git ignores; a folder's own `.claude/rules/` is
read from the folder itself, and a git-ignored `CLAUDE.local.md` is still listed. It stops at 20,000 folders and names
that in the problems, so instruction files deeper than that aren't listed.

It doesn't apply `claudeMdExcludes` either: an excluded file still shows. For what one session actually loaded,
Claude Code's `/context` and `/memory` are the ground truth.

Repo routes:

```
#/repo/<section>?item=<id>&view=<name>&q=<text>&show=<records>
```

| Param | Meaning | Example |
|---|---|---|
| `item` | the item open in the reader, by its id | `item=3f9a1c2e7b10` |
| `view` | the view open in Views, by its name (default: the first) | `view=traffic-load` |
| `q` | search text | `q=wall` |
| `show` | records shown, comma-separated (all is the default; `-` shows none) | `show=outside,build` |
| `build` | the build kept from the Build side, so switching back skips the picker | `build=relay-rebuild` |

## API

Every error response is `{ "error": string }`. A path with a malformed percent escape gets 400. A build file path
whose decoded parts hold a slash, a backslash, `.` or `..`, or that reaches outside the build folder through a link,
gets 403.

| Route | Returns |
|---|---|
| `GET /api/builds` | `{ root, builds: string[], assets: string or null }`: `assets` is the asset origin's base URL, ending in `/` |
| `GET /api/builds/<build>` | the build's snapshot (below) |
| `GET /api/builds/<build>/files/<path>` | the raw file, sandboxed (see below). Only under `documents/`, `notes/`, `files/`, `concepts/` and `decommission/` (a decommission's staged files); anything else gets 403. |
| `GET /api/rules/<index>` | a static rules file the repo's `.nexus/config.json` lists, by its position, sandboxed. Read-only; 404 for anything not listed. |
| `POST /api/builds/<build>/gates/<gate>/answers` | `201 { ok, answers }`. 400 if invalid, 404 if there's no such gate, 409 if already answered. |
| `GET /api/repo` | the repo snapshot: `{ inventory, views, problems }`, the standing instructions, the declared views and any view notes that can't be used |
| `GET /api/repo/items/<id>` | `{ item, text }`: one standing instruction and its text, by its 12-character id; 404 for any other id |
| `GET /api/repo/views/<name>` | `{ view, data, error }`: a declared view and its parsed data; a data problem is `error`, not a failure; 404 for an unknown view |
| `GET /api/repo/views/<name>/files/<n>` | a gallery view's image by its position, sandboxed; 404 off the list, 413 over 10 MB |
| `GET /api/reviews` | `{ reviews, problems }`: each review's request, answers (or null), and opened and read times; `problems` names any review that can't be read |
| `POST /api/reviews/<name>/answers` | `201 { ok, answers }`, as for gate answers. 400 if invalid, 404 for no such review, 409 if already answered. |
| `GET /api/events` | Server-Sent Events: `event: change`, data `{ "build": string or null }` after a build changes, or `{ "repo": true }` after the repo's standing instructions, views or reviews do. Refetch that snapshot. |

Every `/api/repo` route only reads, and needs no build: any method but GET or HEAD gets 405 ("The repo view is
read-only"). A view image is served from the file nexus checked, with `Content-Security-Policy: sandbox` and
`X-Content-Type-Options: nosniff`.

Reviews sit beside the repo routes, at `/api/reviews`, so `/api/repo` stays read-only. The one write is a review's
answers, posted once, with the same checks as gate answers below. Nothing else on the Repo side writes: the Repo view
and the Guardrails panel only read.

A POST body over the server's limit gets 413, for gate answers and review answers alike.

The answers body is `{ "marks": { "<item>": "accepted" | "research" | "declined" } }`, `{ "choice": "<option>" }`
or `{ "decision": "approve" | "send-back" }`, plus an optional `"note"`. The server sets `gate` and `submitted`.

Only the cockpit can answer:
- POSTs must be sent with `content-type: application/json` (otherwise 415);
- an `Origin` header, if present, must be the server's own; `Origin: null`, which a sandboxed page sends, is
  refused (otherwise 403);
- every request must be addressed to `127.0.0.1` or `localhost` (otherwise 403);
- POSTs must carry the `x-nexus-token` header holding the token from `<meta name="nexus-token">` in the page the
  server served. The token changes each time the server starts (otherwise 403).

The server also keeps other pages from acting as the cockpit:
- **Build files are sandboxed.** Every `/api/builds/<build>/files/...` response (documents, notes, files, a
  decommission's staged files, and concept pages when no asset origin is known) carries
  `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms` and `X-Content-Type-Options: nosniff`.
  A script in one still runs, but in an opaque origin: it can't read the cockpit page or its token, and
  anything it POSTs carries `Origin: null`, which answers refuse.
- **Concept pages have their own origin.** `nexus serve` also starts a files-only asset listener on a second,
  free port of the same host, and names it as `assets` in `GET /api/builds`. It serves only
  `<assets><build>/concepts/<path>` (GET or HEAD; any other area 403, any other method 405, a host other than
  `127.0.0.1` or `localhost` 403, and a service worker's script request, `Service-Worker: script`, 403, so no page
  can register a worker over the concept origin), with
  `Content-Security-Policy: sandbox allow-scripts allow-same-origin allow-forms allow-popups` and
  `X-Content-Type-Options: nosniff`. The cockpit loads concept pages from there, in
  `<iframe sandbox="allow-scripts allow-same-origin">`, so a page's fonts, `<script type="module">` imports and
  `fetch` of files beside it load. A page there still can't answer gates: its origin isn't the cockpit's, so answers
  refuse its `Origin`; it has no token; and the API sends no CORS headers, so it can't read the cockpit's responses.
  A frame on the cockpit's own origin is only ever given `sandbox="allow-scripts"`. The client re-reads `assets` on
  every `GET /api/builds`, so after a restart concept pages follow the new port.
- **The cockpit can't be framed.** Its pages carry `Content-Security-Policy: frame-ancestors 'none'` and
  `X-Frame-Options: DENY`, so no other page can wrap it and steer clicks.
- **Every HTML response from the cockpit origin is unframeable or sandboxed:** the cockpit's pages carry
  `frame-ancestors 'none'`, and build files and rules a `sandbox` CSP. A concept frame's sandbox is chosen from its
  first `src`, and a page can navigate its own frame, so this is what keeps a frame sent to the cockpit origin from
  holding the cockpit.

**After a server restart** the open tab keeps working without a reload. When its event stream reconnects, the
cockpit re-reads the token from `/`, and if an answer is still refused with `Answers must come from the cockpit
page` it re-reads the token once and sends the answer again. Marks and the note stay in place whenever sending
fails. Only an unreachable server counts as offline (the page retries every 3 s); any other error, such as a 404
or 500, is shown as it is and tried again on the next change event, not on a timer.

```ts
interface Snapshot {
  name: string;
  build: Build | null;                       // null if build.json is unreadable (see problems)
  logs: Record<'decisions' | 'issues' | 'changes' | 'questions', LogEntry[]>;
  plan: PlanFile | null;                     // plan.json: indexed plans and kept records (contracts.md)
  planProgress: Record<string, PlanProgress>; // per plan ID: source ledger | record | none, read, ledger, tasks, final
  gates: { name: string; request: GateRequest; answers: GateAnswers | null; read: string | null }[];
  guardrails: { entry, state, gate, decided }[];
  rules: { index, path, problem }[];       // static rules files from .nexus/config.json
  files: Record<'documents' | 'notes' | 'files' | 'concepts', { path: string; size: number; modified: string }[]>;
  problems: { file: string; message: string }[]; // shown in the cockpit; never block the rest
}
```

The field-level shapes of `Build`, `LogEntry`, `GateRequest` and `GateAnswers` are in
[contracts.md](contracts.md).

## Diagrams in documents

Mermaid diagrams use three classes, which the cockpit themes:
- `done`: solid;
- `pending`: dashed;
- `needs`: signal red, for what's waiting on the user.

See [writing.md](writing.md).
