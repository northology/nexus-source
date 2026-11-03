# Commands

Every nexus command runs as `node <plugin folder>/bin/nexus.mjs <command>`, written `nexus <command>` on this page.
Most of the time the agent runs them for you as a build moves along; the ones you're likeliest to type yourself are
`builds`, `phase status`, `serve` and the `doctor` checks. `nexus --help` prints the short list.

## Not typed in a terminal

- **`/nexus:plan <build> [phase]`** is a slash command you type in the agent's chat. It starts a build, or picks an
  existing one back up, and walks it through planning: guardrails, brainstorm and scope, spec, plan, execution and
  finish, with a gate for you at each step.
- **`/nexus:decommission <build>`** is a slash command too. Once a build's last phase is closed, the agent drafts
  the build's final report and opens one gate on it: you mark which guardrails become repo rules, or approve the
  report when there are none. Then everything lands in the repo's `docs/` in one commit.
- **`/nexus:init`** sets a repo up once: its `docs/` vault, Obsidian, and nexus enabled for Claude Code.
- **The UserPromptSubmit hook** runs before each of your prompts reaches the agent, and adds the active build's state:
  its phase and stage, how many guardrails are accepted, and any gates you've answered. With or without a build, it
  also names each review you've answered that the agent hasn't applied. It never blocks a prompt.
- **The PreToolUse hook** is the wall. It runs before each of the agent's writes and shell commands, and refuses writes
  to protected files while a build is active, a review's answers among them. A build's gate answers stay refused until
  decommission removes the build. A permit you approve at a gate lets through one change to a standing rule file, such
  as `CLAUDE.md`; the build's own record never takes a permit.
- **The PostToolUse hook** checks a note in a repo's `docs/` vault after the agent writes it, against the vault's class
  notes in `docs/_meta/`, and tells the agent what to fix. It never undoes a write, and it stays silent outside a vault.

The plugin registers all three hooks; you don't run them yourself.

<!-- generated:commands:start -->
- **Builds and phases:** [builds](#/guidance/commands?h=builds) · [new](#/guidance/commands?h=new) · [phase start](#/guidance/commands?h=phase-start) · [phase status](#/guidance/commands?h=phase-status) · [stage](#/guidance/commands?h=stage) · [decommission check](#/guidance/commands?h=decommission-check) · [decommission apply](#/guidance/commands?h=decommission-apply)
- **Repo setup:** [init](#/guidance/commands?h=init) · [obsidian install](#/guidance/commands?h=obsidian-install) · [docs generate](#/guidance/commands?h=docs-generate) · [docs upgrade](#/guidance/commands?h=docs-upgrade) · [governance list](#/guidance/commands?h=governance-list)
- **Logs and guardrails:** [log add](#/guidance/commands?h=log-add) · [log status](#/guidance/commands?h=log-status) · [guardrail propose](#/guidance/commands?h=guardrail-propose) · [guardrail withdraw](#/guidance/commands?h=guardrail-withdraw) · [guardrail list](#/guidance/commands?h=guardrail-list)
- **Gates:** [gate open](#/guidance/commands?h=gate-open) · [gate apply](#/guidance/commands?h=gate-apply) · [review open](#/guidance/commands?h=review-open) · [review apply](#/guidance/commands?h=review-apply) · [review list](#/guidance/commands?h=review-list)
- **Plans and ledgers:** [ledger import](#/guidance/commands?h=ledger-import) · [plan](#/guidance/commands?h=plan) · [plan index](#/guidance/commands?h=plan-index)
- **Diagnostics:** [check](#/guidance/commands?h=check) · [doctor guard](#/guidance/commands?h=doctor-guard) · [doctor superpowers](#/guidance/commands?h=doctor-superpowers) · [doctor docs](#/guidance/commands?h=doctor-docs) · [docs check](#/guidance/commands?h=docs-check)
- **Serving and hooks:** [serve](#/guidance/commands?h=serve) · [hook](#/guidance/commands?h=hook) · [guard](#/guidance/commands?h=guard)

## Builds and phases

### builds

```
nexus builds
```

Lists every build in the checkout's .build/ folder, one line each, with its current phase, its stage, whether it is still active or finished, and the branch it works on.

**When:** You want to see what builds a repo holds, or which one is still running.

**Example:**

```bash
nexus builds
```

### new

```
nexus new <name> [--summary <text>] [--branch <name>] [--phase <name>] [--check]
```

Creates the build folder .build/<name>/ with its first phase at the planning stage, recording the branch it works on (the current one unless you name another). A build name is at most 48 characters, so every gate it opens fits, and a name the repo's record already holds for a decommissioned build is refused, since its decommission would replace that record. --check validates the name and options without creating anything.

**When:** At the start of a piece of work. /nexus:plan runs it for you when you name a build that doesn't exist yet.

**Example:**

```bash
nexus new landing-card --summary "A card for the landing page"
```

### phase start

```
nexus phase start <name> [--branch <b>] [--check]
```

Opens the build's next phase at the planning stage, recording the branch it works on (the current one unless you name another). The current phase has to be in close-out first; the logs and documents of earlier phases stay where they are.

**When:** A phase has finished and the same build carries on with more work. /nexus:plan runs it for you on the phase's new build/<build>-<phase> branch.

**Example:**

```bash
nexus phase start phase-2
```

### phase status

```
nexus phase status [--build <b>]
```

Lists the current phase's five steps, each with its gate and that gate's state (not opened, open, answered or applied, and whether it was approved or sent back), and ends with a Next: line saying exactly what to do: answer a gate, apply one, or continue at a /nexus:plan step. It reads the build and changes nothing.

**When:** You come back to a build after a break, or a session ended between gates.

**Example:**

```bash
nexus phase status --build landing-card
```

### stage

```
nexus stage <planning|plan|build|close-out>
```

Moves the current phase to a stage: planning (guardrails, brainstorm and scope), plan (the spec and the implementation plan), build (execution) or close-out (finished). Close-out is refused until you approve the phase's finish gate, and it is one-way: only nexus phase start leaves it. The cockpit and the per-prompt reminder follow the stage.

**When:** The agent runs it as the phase moves along; you rarely need it yourself.

**Example:**

```bash
nexus stage build
```

### decommission check

```
nexus decommission check <build>
```

Checks that a build can be decommissioned: its last phase closed with the finish gate approved, no other build active, every gate applied, a vault this nexus supports, run from the root of a git repository, a clean tree outside the build folder, no file git ignores inside it (decommission removes the folder) and .claude/rules/nexus/ not ignored by git (the generated rule files land there). It prints the build's base and final commits, whose difference is what the build changed, and writes nothing.

**When:** At the start of /nexus:decommission.

**Example:**

```bash
nexus decommission check relay-rebuild
```

### decommission apply

```
nexus decommission apply <build>
```

Needs the decommission gate applied: a mark-list with a row for every accepted guardrail or, for a build with none, an approve gate the user approved; a rule note for each row you accepted, and the final report drafted in the build, listing its decisions of note (and, where the repo lists components, the ones it touched). It first commits the build folder as it stands, so the gate's answers and the whole record stay in git history. Then, in one commit on the current branch: the build's specs, plans, reports and audits go to docs/superpowers/archive/<build>/, its final report to docs/governance/builds/<build>.md as the build's record, its decisions of note to docs/governance/decisions.json and its open issues to docs/governance/issues.json, the vault is upgraded if it is older, rule files and hubs are generated, the vault is checked, and .build/<build>/ is removed. If a step fails, the decommission isn't committed and the build folder stays. If something holds the build folder open once the commit exists, apply says so and leaves the folder for git clean -fd. It never merges, pushes or deletes a branch. Commits use git's identity, or GIT_AUTHOR_* and GIT_COMMITTER_* when set.

**When:** After the user answers the decommission gate and the agent has written the rule notes. /nexus:decommission runs it.

**Example:**

```bash
nexus decommission apply relay-rebuild
```

## Repo setup

### init

```
nexus init [root] [--answers <file>] [--no-plugins] [--check]
```

Sets a repo up with the docs vault standard, once: the registry in docs/_meta/ (with the components and tags from an answers file), the shared Obsidian settings and the pinned plugins and theme, downloaded and checked by hash, and nexus enabled in .claude/settings.json. It only adds to CLAUDE.md, .gitignore, .ignore and the settings file, never changing a line already there. Everything is checked before anything is written, so a conflict or a failed download leaves the repo unchanged. --check prints the plan; --no-plugins skips the downloads.

**When:** Once, on a new repo, before any other setup. /nexus:init asks the questions and runs it for you.

**Example:**

```bash
nexus init --answers .nexus/init-answers.json
```

### obsidian install

```
nexus obsidian install [root] [--check]
```

Downloads the pinned plugin and theme files missing from an initialized vault's docs/.obsidian/, each checked against its pinned hash. A file already there with the pinned hash is left alone; one with other content stops it, and nothing is replaced. --check says what is missing.

**When:** After nexus init --no-plugins once you are online, or on a clone whose plugin files went missing.

**Example:**

```bash
nexus obsidian install
```

### docs generate

```
nexus docs generate [root] [--check]
```

Writes the vault's generated files: one rule file per active rule note (scoped rules load only on their paths) where the harness reads them (.claude/rules/nexus/ in Claude Code, .agents/rules/nexus-*.md in Antigravity, a section of AGENTS.md's nexus block in Codex), and one hub per component in docs/dev/context/. Each carries a marker naming its source and a hash, so hand edits show. Marked files whose source is gone are removed; a file without a marker stops it. In Codex it warns when AGENTS.md would pass the 32 KiB Codex reads, naming the largest rules, and still writes it. --check writes nothing and exits 1 when anything is missing, stale, edited or orphaned.

**When:** After setting a repo up, after seeding, at decommission, or when CI says the hubs are behind.

**Example:**

```bash
nexus docs generate --check
```

### docs upgrade

```
nexus docs upgrade [root] [--check]
```

Brings a vault set up by an older nexus up to the contract this nexus supports: it copies in each standard class note the vault lacks and sets docs/_meta/contract.md to the supported number. It never changes or removes any other file, so a repo's own classes and edited standard classes stay as they are. It refuses a vault newer than this nexus and, since docs/_meta/ is walled during a build, a repo with an active build; decommission runs it for you inside its commit. --check lists what it would add and writes nothing.

**When:** docs check warns that the vault follows an older contract, and no build is active.

**Example:**

```bash
nexus docs upgrade --check
```

### governance list

```
nexus governance list [root] [--json] [--outside]
```

Lists the standing instructions an agent can load from the repo, grouped by when it loads: the vault's decisions, active rules and open issues, generated rule files, CLAUDE.md and AGENTS.md files here and in the folders above, hand-written .claude/rules/ files, Claude Code's memory for this repo, and the active build's accepted guardrails. Each line says whether it is in the repo's record. --outside lists only what isn't and says so in the count line; --json prints the inventory as JSON and honours --outside. It also lists CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/rules/ files in folders below the repo root, which Claude Code loads when it works there (it skips .git, node_modules, .build, the vault archives and what git ignores, except CLAUDE.local.md). Not listed: output styles, context hooks add, skill listings, --append-system-prompt and the managed claudeMd setting; claudeMdExcludes isn't applied, so an excluded file still shows. Claude Code's /context and /memory are the ground truth for one session.

**When:** Before proposing a rule or guardrail, to see what already says it; or to find instructions that never made it into the record.

**Example:**

```bash
nexus governance list --outside
```

## Logs and guardrails

### log add

```
nexus log add <log> <name> --text <t> --status <s> --source <src> [--note <n>] [--quote <q>] [--commit <c>] [--topic <t>]
```

Adds an entry to one of the build's four logs: decisions, questions, issues or changes. Each entry has a short name, one sentence of text, a status from that log's list, and where it came from. A quote keeps your own words; a commit or a topic ties a change to the work it belongs to.

**When:** Something worth keeping comes up: a decision, an open question, a problem, or a change made after review.

**Example:**

```bash
nexus log add questions card-width --text "Should the card fill the column on phones?" --status exploring --source "chat 11:20"
```

### log status

```
nexus log status <log> <name> <status>
```

Moves an existing log entry to another status from its log's list, for example a question from exploring to answered, or an issue from open to closed.

**When:** An entry's state changes: a question is settled or an issue is dealt with.

**Example:**

```bash
nexus log status issues focus-ring closed
```

### guardrail propose

```
nexus guardrail propose <name> --text <t> --source <src> --raised-by <user|claude|agent> [--quote <q>] [--note <n>]
```

Proposes a guardrail: a rule the build has to keep, such as "no new dependencies". A proposal does nothing until you accept it at a gate; after that it is in force, shown in the cockpit's guardrails log and listed for the agent by guardrail list --accepted.

**When:** You or the agent want a rule written down for the rest of the build.

**Example:**

```bash
nexus guardrail propose no-new-deps --text "Add no new runtime dependencies" --source "chat 09:40" --raised-by user
```

### guardrail withdraw

```
nexus guardrail withdraw <name>
```

Takes back a guardrail that is proposed, or one the user declined. An accepted guardrail can't be withdrawn; changing one goes through a gate.

**When:** A proposal turns out to be wrong or unneeded before anyone has accepted it.

**Example:**

```bash
nexus guardrail withdraw no-new-deps
```

### guardrail list

```
nexus guardrail list [--accepted]
```

Lists the build's guardrails with their state: proposed, accepted, declined or withdrawn. The state comes from your gate answers, so it can't be set by hand. --accepted shows only the rules in force.

**When:** You want to check which rules the build is holding to.

**Example:**

```bash
nexus guardrail list --accepted
```

## Gates

### gate open

```
nexus gate open <request.json>
```

Checks a gate request (the question, its kind, its options or rows) and opens it in the build's gates/ folder, where the cockpit shows it for you to answer. A request that doesn't validate is refused with the reasons.

**When:** The agent runs it whenever it needs a decision from you; you answer in the cockpit.

**Example:**

```bash
nexus gate open scope-phase-1.request.json
```

### gate apply

```
nexus gate apply <gate>
```

Reads the answers you gave in the cockpit and records them: rows go to the decision log or open questions, a concept pick becomes a decision, an approval is logged. A guardrail gate's answers file is its record, and a decommission gate logs one entry listing its marks. It prints what changed and, for a concept round, whether its topic is settled or the Next: round to open.

**When:** The agent runs it after you answer a gate; you rarely need it yourself.

**Example:**

```bash
nexus gate apply scope-phase-1
```

### review open

```
nexus review open <request.json>
```

Opens a review in .nexus/reviews/: each row names one item the Repo view lists (a memory, a rule file, a CLAUDE.md), by its id and location, and the cockpit shows Keep, Adjust and Remove on that item's card. It works with or without a build; the folder is ignored by git, since a review can name personal memory.

**When:** You want to tidy memory or rule files: the agent opens the review, you mark it in the Repo view, the agent makes each change.

**Example:**

```bash
nexus review open tidy-memory.json
```

### review apply

```
nexus review apply <name>
```

Prints how many rows were kept, adjusted and removed, then each Adjust or Remove row with its file and note, and marks the review applied, which closes the permits it opened during a build. The agent runs it after making each change: Adjust follows its row note, Remove deletes the file.

**When:** The agent runs it after making the changes you marked.

**Example:**

```bash
nexus review apply tidy-memory
```

### review list

```
nexus review list
```

Lists each review in .nexus/reviews/ with its state (waiting, answered or applied) and title.

**When:** You want to see which reviews are open or waiting for the agent.

**Example:**

```bash
nexus review list
```

## Plans and ledgers

### ledger import

```
nexus ledger import <progress.md>
```

Reads the progress ledger an execution run keeps and adds its rulings to the decision log and its deferred minors to the issues log, skipping any already there. It also keeps the run's task record, so the Plan section shows which tasks finished.

**When:** At the end of an execution run, before the finish gate.

**Example:**

```bash
nexus ledger import .superpowers/sdd/2026-10-06-card-plan/progress.md
```

### plan

```
nexus plan [--phase <name>]
```

Prints the approved implementation plan for the current phase (or the one you name): each task by title, and whether it is pending, in progress or done.

**When:** You want the plan's progress in the terminal rather than the cockpit.

**Example:**

```bash
nexus plan --phase phase-1
```

### plan index

```
nexus plan index <gate>
```

Reads the plan an approved plan gate points to and records its tasks, so the Plan section can track them. Plans approved now are indexed when the gate is applied; this is for older ones.

**When:** A build's plan was approved before nexus tracked plans, and the Plan section is empty.

**Example:**

```bash
nexus plan index plan-phase-1
```

## Diagnostics

### check

```
nexus check
```

Reads every file in the build folder against its schema and prints each problem with the file it is in. It exits with an error when anything is wrong, so it works in scripts too.

**When:** The cockpit shows a problem banner, or after editing build files by hand.

**Example:**

```bash
nexus check
```

### doctor guard

```
nexus doctor guard
```

First names the harness this copy of nexus was built for and how far its wall holds there. Then loads the guard the wall runs and runs the hook entry once, and says whether each works and, if not, why. In Claude Code, when the guard can't run, writes are refused in repos with a build in progress, so this is the first thing to check.

**When:** Writes are refused with a message that the guard couldn't run, or after updating the plugin.

**Example:**

```bash
nexus doctor guard
```

### doctor superpowers

```
nexus doctor superpowers [--path <dir>]
```

Checks that the installed Superpowers skills still contain each line nexus depends on, and names any that moved and what that breaks. Supported: 6.4.1, 7.0.0 and 7.0.1. With several installed, only the newest is checked, since that is the one the harness loads. --path points at a Superpowers folder other than the installed one.

**When:** After every Superpowers update.

**Example:**

```bash
nexus doctor superpowers
```

### doctor docs

```
nexus doctor docs
```

Checks that the docs-check bundle runs, that the PostToolUse hook is registered to run it after each write, and that the repo's docs/_meta/ registry reads, with its class count and contract. It checks the machinery, not the notes: docs check does that.

**When:** After installing or updating the plugin, or when the vault hook stops reporting.

**Example:**

```bash
nexus doctor docs
```

### docs check

```
nexus docs check [root] [--file <p>] [--stale] [--json]
```

Checks every note in the repo's docs/ vault against the class notes in docs/_meta/classes/: where it sits, its status, source, component, tags and links. Blocking findings exit 1; warnings never fail. --file reports one note (judged against the whole vault), --stale compares thing notes with their source's git history, and --json prints the report for CI. Outside a vault it checks nothing and exits 0.

**When:** Before committing documentation, on main, in CI, or when the hook reports a finding you want to see in full.

**Example:**

```bash
nexus docs check --stale
```

## Serving and hooks

### serve

```
nexus serve [--port <n>] [--open] [--cockpit <dir>]
```

Starts the cockpit server on this machine only, at http://127.0.0.1:4410/ unless you pick a port, and prints its address and the concept-page address. --open opens it in your browser; --cockpit serves a cockpit build from another folder, for developing nexus. It keeps running until you stop it.

**When:** Whenever you want the cockpit open; /nexus:plan starts it for you.

**Example:**

```bash
nexus serve --open
```

### hook

```
nexus hook
```

The per-prompt hook. The harness runs it before each of your prompts reaches the agent, and it adds the active build's state: its phase and stage, how many guardrails are accepted, and any gates you've answered. With or without a build, it also names each review you've answered that the agent hasn't applied. It never blocks a prompt.

**When:** Never by hand: the plugin registers it.

**Example:**

```bash
nexus hook < hook-input.json
```

### guard

```
nexus guard
```

The wall. The harness runs it before each of the agent's writes and shell commands, and it refuses writes to protected files while a build is active: standing rules (CLAUDE.md, AGENTS.md, settings, rules, memory, the nexus config, the docs vault registry in docs/_meta/), the build's record (gate and review answers, build.json, plan.json, opened concept pages, docs/superpowers) and the repo's permanent record that decommission writes (docs/governance/decisions.json, issues.json and builds/). A permit you approve lets through one change to a standing rule; neither record ever takes one.

**When:** Never by hand: the plugin registers it, through a small loader. Use doctor guard to check it.

**Example:**

```bash
nexus guard < hook-input.json
```
<!-- generated:commands:end -->
