# Gates

A gate is a review the user does in the cockpit. The agent opens it, the user answers it once, and the agent applies
the answers.

```mermaid
sequenceDiagram
  participant C as Agent
  participant F as .build/<name>/gates/
  participant K as Cockpit
  participant U as User
  C->>F: nexus gate open request.json
  F-->>K: change event, the gate shows, rail turns red
  U->>K: marks rows, submits
  K->>F: <gate>.answers.json (once; a second submit gets 409)
  U->>C: next message
  Note over C: the hook adds "answers waiting" to context
  C->>F: nexus gate apply <gate> (logs updated, read time set)
  C->>C: commit the build folder
```

## Types

| Type | The user | Request needs | Answers hold |
|---|---|---|---|
| `mark-list` | marks every row accepted, research or declined | `items` (1+); optional `document`, shown above the rows | `marks`: one per item name |
| `concept-pick` | opens each concept page in the cockpit and picks one, marks several to combine, or picks none of these with a note | `options` (2+), each with a `page` in `concepts/` and an optional `source`; optional `topic` | `choice` (an option name), `choices` (2+ distinct option names) or `none` |
| `approve` | approves or sends back, optionally reading a document | optional `document` | `decision`: `approve` or `send-back` |
| `review` | marks every row Keep, Adjust or Remove, on the Repo view's cards (see Review gates) | `items` (1+), each with `item` and `target` | `marks`: one per item name |

Any answers can carry a `note`. Mark-list answers can also carry `"notes"`, one per row name (1–2,000 characters each). Submit is refused until every mark-list row is marked.

## Steps and tabs

A gate's `"step"`, when it has one, is one of six: the five standard gates of a phase, `guardrails`, `scope`, `spec`,
`plan` and `finish`, named `<step>-<phase>`, and `decommission`. `nexus gate open` checks that a gate fits its step:
`finish` is an approve gate named `finish-<phase>`, or `finish-<phase>-<n>` (n from 2) when a sent-back finish gate
is reopened; `guardrails` carries `"log": "guardrails"`; `scope` is a mark-list; `spec` and `plan` are approve gates
with a `document`; `decommission` is a mark-list or an approve gate, with a `document`. The cockpit files each gate
under the tab its step names. A gate without a step goes to Permits if it carries a `permit`, to Guardrails if it
carries `"log": "guardrails"`, and to Other otherwise. Names are never read for this.

The `decommission` step belongs to a build rather than a phase: `decommission-<build>` has the draft final report,
`documents/reports/<build> final report.md`, as its `document`, and opens once the build's last phase is closed. Its
tab, Decommission, shows only when the build has one.

## What applying does

- **mark-list:** accepted and declined rows go to the decision log; research rows go to open questions. An accepted
  or declined row closes an open question of the same name, and a research row reopens a decision of the same name
  as a question; `nexus gate apply` lists both (`Closed questions:`, `Reopened as questions:`). A row's note becomes
  its log entry's `note`; `nexus gate apply` prints every row note.
- **concept-pick:** records a decision named after the gate's title, then prints what to do next on a line
  starting `Next:`.
  - A pick: `<title>: <label>` (accepted), then `Topic "<topic>" is settled.`
  - A combine: `<title>: combine <label> + <label>` (accepted), then:
    `Open the next round on topic "<topic>" with new pages in concepts/<topic>/, merging <label> and <label>.`
  - None of these: `<title>: none of these` (declined; the note is required), then:
    `Open the next round on topic "<topic>" with new pages in concepts/<topic>/, using the user's note.`
- **approve:** records a decision named after the gate, accepted if approved and declined if sent back. The note
  is kept.

An approved plan gate (`"step": "plan"` with a `document`) also indexes the plan: each `### Task <N>: <title>` heading
becomes a task in `plan.json`, which the cockpit's Plan section tracks. `gate apply` prints what indexing found: the
number of tasks, or why none were indexed. For a plan gate approved before nexus tracked tasks, run
`nexus plan index <gate>`.

## Rounds and topics

A concept-pick gate is one round. Its `topic` names the question being settled and defaults to the gate name. When a
round doesn't settle the topic (a combine, or none of these), open the next round as a new gate on the same
`topic`, with new pages: a page never changes after its round opens. `source` records where an option came from
(`impeccable`, `superpowers` or `self`).

To preview a page as the cockpit will show it, open `<concept pages URL><build>/concepts/<topic>/<option>.html`,
where the concept pages URL is the second line `nexus serve` prints. It changes each time the cockpit starts.

```json
{
  "name": "status-look-2",
  "type": "concept-pick",
  "topic": "status-look",
  "title": "Pick a direction for the status page",
  "why": "Round 2: the warmer takes, after round 1's note.",
  "options": [
    { "name": "quiet-board", "label": "Quiet board", "page": "concepts/status-look/quiet-board.html", "source": "impeccable" },
    { "name": "split-view", "label": "Split view", "page": "concepts/status-look/split-view.html", "source": "self" }
  ]
}
```

## Guardrail gates

A mark-list gate with `"log": "guardrails"` decides guardrails. Each row must be a proposed guardrail, with its name
and text exactly as `nexus guardrail propose` recorded them. The marks stay in the answers file and decide each
guardrail's state: accepted, declined, or (for research) still proposed. Applying the gate changes no log. At
submission the server stamps `log: "guardrails"` and each row's text into the answers file; a mark counts only while
the guardrail's text still matches its stamp, so rewording an accepted guardrail returns it to proposed.

To retire an accepted guardrail, give it a row of its own with `"retire": true`, its name and text exactly as accepted.
The cockpit tags the row "Retire" and asks in words: **Retire** (key X), **Keep** (key K) or research (key R), with
the A and D keys off on that row; the tally counts Retire and Keep apart from Accepted and Declined. In the answers,
Retire is `accepted` and Keep is `declined`. Accepting it retires the guardrail (state `retired`, out of
`nexus guardrail list --accepted` and the governance list); declining it, or marking it research, leaves the guardrail
accepted. A retire row belongs only on a guardrails gate and only names an accepted guardrail; the gate is refused
otherwise. A later row that accepts the guardrail again brings it back, since the latest answer wins. Never ask for a
decline to retire one: an accept reads as agreeing to keep it. `nexus guardrail withdraw` takes back only a proposal
or a declined guardrail, and refuses an accepted one.

```json
{ "name": "build-guardrails", "type": "mark-list", "log": "guardrails", "title": "Confirm this phase's guardrails", "why": "Mark each one.",
  "items": [{ "name": "no-new-external-calls", "text": "No new external network calls without a gate" }] }
```

## Conflict notes

Any mark-list row can carry `"conflicts": ["<title> (<location>)"]`, naming each item, guardrail or document it
conflicts with. The cockpit shows "conflicts with …" on the row. The scope gate (G2) uses it to flag premises that
contradict each other or an approved document.

## Permits

An approve gate can carry a `permit`. Approving it lets the agent change that one protected file while the build is
active, for 30 minutes from the answer, until the gate is applied. At submission the server copies the permit
(target and change) into the answers file, and the wall reads the target from there, so editing the request
afterwards changes nothing. Make the change before running `nexus gate apply`: applying closes the permit. A review
row marked Adjust or Remove is a permit too (see Review gates).

```json
{ "name": "claude-rule", "type": "approve", "title": "Add the replay rule to CLAUDE.md", "why": "You asked for this in chat.",
  "permit": { "target": "CLAUDE.md", "change": "Add the replay rule under Working agreements" } }
```

## Finish gates

Each phase ends with an approve gate named `finish-<phase>` (`"step": "finish"`): approving it authorizes closing out
the phase. The phase stays on its branch and the next phase branches from its tip; nothing merges into `main` until
the build is decommissioned (see Decommission gates), so parallel worktrees never see `main` move under them.
`nexus stage close-out` is refused until the user approves it, which is what lowers the wall. A sent-back finish gate is reopened as `finish-<phase>-2`, then `-3`, and close-out needs an
approved answer on any of the phase's finish gates. The wall reads the stage and that answer together, so a stage set
to close-out any other way leaves it up. The pairing is enforced when the gate is answered as well as when it is
opened, because request files aren't walled: a gate under the phase's finish name that lacks `"step": "finish"` can't
be answered. A new phase can't take a name whose finish gate is already a gate in the build (`replay-2` after
`finish-replay-2`), so an old approval never closes a new phase. Close-out is one-way: `nexus stage` refuses to leave
it, and only `nexus phase start` begins the next phase.

## Decommission gates

`/nexus:decommission <build>` opens `decommission-<build>` (`"step": "decommission"`) once the build is finished. Its
rows are the build's accepted guardrails, every one of them: `nexus decommission apply` refuses a gate that leaves
one out. The user decides which become rules for the repo.

A build with no accepted guardrail has no rows, and is still asked: its gate is an approve gate on the final report.
Approving moves the build as the report says (its decisions of note and the earlier builds' entries it settles).
Sending it back keeps the build; the agent revises the report and opens `decommission-<build>-2` (then `-3`), and apply
reads the latest round.

- **Accepted** makes it a rule: the agent writes `docs/governance/rules/<name>.md` (`tier: always`, or `scoped` with
  the paths a row note names).
- **Declined** leaves it with the build. The final report says so, and its note box doesn't open unasked.
- **Research** decides nothing yet: the final report records it as undecided, and nothing is written.

The `document` is the draft final report, `documents/reports/<build> final report.md`, shown above the rows.
Decisions and issues have no rows: the decisions of note the report lists, and the open issues, go to the repo's logs
at apply (see vault.md). Applying the gate writes one entry, named after the gate, to the build's decision log, listing
each row's mark, so a row never touches a decision that shares its name; the answers file is what
`nexus decommission apply` reads, and the writes happen there.

After apply, `/nexus:decommission` lands the build on `main` by fast-forward (`git fetch . HEAD:main`, which never
switches branches), having first merged `main` into the build branch if another build landed meanwhile. When `main`
is checked out in another worktree, the agent leaves that checkout's files alone and gives the user the
`git merge --ff-only` to run there.

Only the user answers the gate, in the cockpit. A mark-list, once open or answered, can't be reopened or replaced.

## Review gates

A review asks about items the Repo view lists: keep a memory, rule or instruction file, adjust it, or remove it.
The agent opens one with `nexus review open <request.json>`. It lives in `.nexus/reviews/`, works with or without a
build, and isn't committed. Only the user answers it, in the cockpit.

```json
{ "name": "memory-tidy", "type": "review", "title": "Tidy this repo's memory", "why": "Two memories repeat a rule.",
  "items": [{ "name": "replay-caps", "text": "Memory: cap replays at 10,000", "item": "3f9a1c2e7b10",
              "target": "<path to the memory file>" }] }
```

- Each row's `item` is an id `nexus governance list --json` prints, and `target` is that item's `location`, exactly as
  that command prints it. A generated rule file and a guardrail can't be reviewed: the first changes through its
  source note, the second at a guardrails gate.
- While a review is open, the Repo view shows a banner, and Keep, Adjust and Remove with a note on each named item's
  card and in the reader. They're stored as `accepted`, `research` and `declined`; Submit needs every row marked. A
  row whose item left the list after the review opened shows under "No longer listed" and can still be marked. Marks
  and notes lock while the answers are sent and once they are sent.
- On your next prompt the hook tells the agent the review was answered, with or without a build.
  The agent reads the answers file and makes each change (Adjust follows the row's note; Remove deletes the file), then
  runs `nexus review apply <name>`, which prints the counts and each Adjust or Remove row with its note, and marks
  the review read. Reviews log nothing.
  A review that can't be read is named in a notice on the Repo view, and the others still show.
- During a build, each Adjust or Remove row is that file's permit for 30 minutes after the answer, until the review
  is applied; a memory file's row also covers its folder's `MEMORY.md`. The wall refuses the agent's writes to
  `.nexus/reviews/*.answers.json` while a build is active, as it does gate answers.

## Examples

- mark-list: [request](examples/.build/relay-rebuild/gates/scope.json), [answers](examples/.build/relay-rebuild/gates/scope.answers.json)
- concept-pick: [request](examples/.build/relay-rebuild/gates/look.json)
- approve: [request](examples/.build/relay-rebuild/gates/spec-review.json)

The request file can be written anywhere, for example in `files/`. `nexus gate open <file>` validates it, checks
that concept pages and documents exist, and copies it into `gates/`.
