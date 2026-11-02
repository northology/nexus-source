// The one table of nexus commands. `nexus --help` is built from it (usage and summary), and so is the cockpit's
// Guidance commands page (`pnpm guide`), which adds what each command does, when to use it, and an example.
// Plain data: it imports nothing from the CLI or core.

export type CommandGroup = 'Builds and phases' | 'Repo setup' | 'Logs and guardrails' | 'Gates' | 'Plans and ledgers' | 'Diagnostics' | 'Serving and hooks';

export const GROUPS: readonly CommandGroup[] = ['Builds and phases', 'Repo setup', 'Logs and guardrails', 'Gates', 'Plans and ledgers', 'Diagnostics', 'Serving and hooks'];

export interface CommandSpec {
  /** As `nexus --help` prints it, e.g. 'phase status [--build <b>]'. */
  usage: string;
  /** The --help description; empty for the lines too long to carry one. */
  summary: string;
  group: CommandGroup;
  /** What it does, in a few sentences, for the guide. */
  detail: string;
  /** When you'd use it. */
  when: string;
  /** A command line. */
  example: string;
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    usage: 'builds',
    summary: 'list this checkout\'s builds: phase, stage, active or finished, branch',
    group: 'Builds and phases',
    detail: 'Lists every build in the checkout\'s .build/ folder, one line each, with its current phase, its stage, whether it is still active or finished, and the branch it works on.',
    when: 'You want to see what builds a repo holds, or which one is still running.',
    example: 'nexus builds',
  },
  {
    usage: 'new <name> [--summary <text>] [--branch <name>] [--phase <name>] [--check]',
    summary: 'start a build in .build/<name>/ (its first phase); --check only validates',
    group: 'Builds and phases',
    detail: 'Creates the build folder .build/<name>/ with its first phase at the planning stage, recording the branch it works on (the current one unless you name another). A build name is at most 48 characters, so every gate it opens fits, and a name the repo\'s record already holds for a decommissioned build is refused, since its decommission would replace that record. --check validates the name and options without creating anything.',
    when: 'At the start of a piece of work. /nexus:plan runs it for you when you name a build that doesn\'t exist yet.',
    example: 'nexus new landing-card --summary "A card for the landing page"',
  },
  {
    usage: 'phase start <name> [--branch <b>] [--check]',
    summary: 'start the next phase once the current one is in close-out; --check only validates',
    group: 'Builds and phases',
    detail: 'Opens the build\'s next phase at the planning stage, recording the branch it works on (the current one unless you name another). The current phase has to be in close-out first; the logs and documents of earlier phases stay where they are.',
    when: 'A phase has finished and the same build carries on with more work. /nexus:plan runs it for you on the phase\'s new build/<build>-<phase> branch.',
    example: 'nexus phase start phase-2',
  },
  {
    usage: 'phase status [--build <b>]',
    summary: 'the current phase\'s gates, and the /nexus:plan step to resume at',
    group: 'Builds and phases',
    detail: 'Lists the current phase\'s five steps, each with its gate and that gate\'s state (not opened, open, answered or applied, and whether it was approved or sent back), and ends with a Next: line saying exactly what to do: answer a gate, apply one, or continue at a /nexus:plan step. It reads the build and changes nothing.',
    when: 'You come back to a build after a break, or a session ended between gates.',
    example: 'nexus phase status --build landing-card',
  },
  {
    usage: 'stage <planning|plan|build|close-out>',
    summary: 'set the build\'s stage',
    group: 'Builds and phases',
    detail: 'Moves the current phase to a stage: planning (guardrails, brainstorm and scope), plan (the spec and the implementation plan), build (execution) or close-out (finished). Close-out is refused until you approve the phase\'s finish gate, and it is one-way: only nexus phase start leaves it. The cockpit and the per-prompt reminder follow the stage.',
    when: 'The agent runs it as the phase moves along; you rarely need it yourself.',
    example: 'nexus stage build',
  },
  {
    usage: 'decommission check <build>',
    summary: 'check that a finished build can be decommissioned',
    group: 'Builds and phases',
    detail: 'Checks that a build can be decommissioned: its last phase closed with the finish gate approved, no other build active, every gate applied, a vault this nexus supports, run from the root of a git repository, a clean tree outside the build folder, no file git ignores inside it (decommission removes the folder) and .claude/rules/nexus/ not ignored by git (the generated rule files land there). It prints the build\'s base and final commits, whose difference is what the build changed, and writes nothing.',
    when: 'At the start of /nexus:decommission.',
    example: 'nexus decommission check relay-rebuild',
  },
  {
    usage: 'decommission apply <build>',
    summary: 'move a finished build into the repo\'s record, in one commit',
    group: 'Builds and phases',
    detail: 'Needs the decommission gate applied: a mark-list with a row for every accepted guardrail or, for a build with none, an approve gate the user approved; a rule note for each row you accepted, and the final report drafted in the build, listing its decisions of note (and, where the repo lists components, the ones it touched). It first commits the build folder as it stands, so the gate\'s answers and the whole record stay in git history. Then, in one commit on the current branch: the build\'s specs, plans, reports and audits go to docs/superpowers/archive/<build>/, its final report to docs/governance/builds/<build>.md as the build\'s record, its decisions of note to docs/governance/decisions.json and its open issues to docs/governance/issues.json, the vault is upgraded if it is older, rule files and hubs are generated, the vault is checked, and .build/<build>/ is removed. If a step fails, the decommission isn\'t committed and the build folder stays. If something holds the build folder open once the commit exists, apply says so and leaves the folder for git clean -fd. It never merges, pushes or deletes a branch. Commits use git\'s identity, or GIT_AUTHOR_* and GIT_COMMITTER_* when set.',
    when: 'After the user answers the decommission gate and the agent has written the rule notes. /nexus:decommission runs it.',
    example: 'nexus decommission apply relay-rebuild',
  },
  {
    usage: 'init [root] [--answers <file>] [--no-plugins] [--check]',
    summary: 'set a repo up once: docs/ vault, Obsidian, nexus enabled',
    group: 'Repo setup',
    detail: 'Sets a repo up with the docs vault standard, once: the registry in docs/_meta/ (with the components and tags from an answers file), the shared Obsidian settings and the pinned plugins and theme, downloaded and checked by hash, and nexus enabled in .claude/settings.json. It only adds to CLAUDE.md, .gitignore, .ignore and the settings file, never changing a line already there. Everything is checked before anything is written, so a conflict or a failed download leaves the repo unchanged. --check prints the plan; --no-plugins skips the downloads.',
    when: 'Once, on a new repo, before any other setup. /nexus:init asks the questions and runs it for you.',
    example: 'nexus init --answers .nexus/init-answers.json',
  },
  {
    usage: 'obsidian install [root] [--check]',
    summary: 'download the pinned Obsidian plugins and theme that are missing',
    group: 'Repo setup',
    detail: 'Downloads the pinned plugin and theme files missing from an initialized vault\'s docs/.obsidian/, each checked against its pinned hash. A file already there with the pinned hash is left alone; one with other content stops it, and nothing is replaced. --check says what is missing.',
    when: 'After nexus init --no-plugins once you are online, or on a clone whose plugin files went missing.',
    example: 'nexus obsidian install',
  },
  {
    usage: 'docs generate [root] [--check]',
    summary: 'write the vault\'s rules where the agent reads them, and the vault hubs; --check reports drift',
    group: 'Repo setup',
    detail: 'Writes the vault\'s generated files: one rule file per active rule note (scoped rules load only on their paths) where the harness reads them (.claude/rules/nexus/ in Claude Code, .agents/rules/nexus-*.md in Antigravity, a section of AGENTS.md\'s nexus block in Codex), and one hub per component in docs/dev/context/. Each carries a marker naming its source and a hash, so hand edits show. Marked files whose source is gone are removed; a file without a marker stops it. --check writes nothing and exits 1 when anything is missing, stale, edited or orphaned.',
    when: 'After setting a repo up, after seeding, at decommission, or when CI says the hubs are behind.',
    example: 'nexus docs generate --check',
  },
  {
    usage: 'docs upgrade [root] [--check]',
    summary: 'add the standard classes a vault lacks and raise its contract',
    group: 'Repo setup',
    detail: 'Brings a vault set up by an older nexus up to the contract this nexus supports: it copies in each standard class note the vault lacks and sets docs/_meta/contract.md to the supported number. It never changes or removes any other file, so a repo\'s own classes and edited standard classes stay as they are. It refuses a vault newer than this nexus and, since docs/_meta/ is walled during a build, a repo with an active build; decommission runs it for you inside its commit. --check lists what it would add and writes nothing.',
    when: 'docs check warns that the vault follows an older contract, and no build is active.',
    example: 'nexus docs upgrade --check',
  },
  {
    usage: 'governance list [root] [--json] [--outside]',
    summary: 'list the standing instructions an agent loads here, recorded or not',
    group: 'Repo setup',
    detail: 'Lists the standing instructions an agent can load from the repo, grouped by when it loads: the vault\'s decisions, active rules and open issues, generated rule files, CLAUDE.md and AGENTS.md files here and in the folders above, hand-written .claude/rules/ files, Claude Code\'s memory for this repo, and the active build\'s accepted guardrails. Each line says whether it is in the repo\'s record. --outside lists only what isn\'t and says so in the count line; --json prints the inventory as JSON and honours --outside. It also lists CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/rules/ files in folders below the repo root, which Claude Code loads when it works there (it skips .git, node_modules, .build, the vault archives and what git ignores, except CLAUDE.local.md). Not listed: output styles, context hooks add, skill listings, --append-system-prompt and the managed claudeMd setting; claudeMdExcludes isn\'t applied, so an excluded file still shows. Claude Code\'s /context and /memory are the ground truth for one session.',
    when: 'Before proposing a rule or guardrail, to see what already says it; or to find instructions that never made it into the record.',
    example: 'nexus governance list --outside',
  },
  {
    usage: 'log add <log> <name> --text <t> --status <s> --source <src> [--note <n>] [--quote <q>] [--commit <c>] [--topic <t>]',
    summary: '',
    group: 'Logs and guardrails',
    detail: 'Adds an entry to one of the build\'s four logs: decisions, questions, issues or changes. Each entry has a short name, one sentence of text, a status from that log\'s list, and where it came from. A quote keeps your own words; a commit or a topic ties a change to the work it belongs to.',
    when: 'Something worth keeping comes up: a decision, an open question, a problem, or a change made after review.',
    example: 'nexus log add questions card-width --text "Should the card fill the column on phones?" --status exploring --source "chat 11:20"',
  },
  {
    usage: 'log status <log> <name> <status>',
    summary: 'change an entry\'s status',
    group: 'Logs and guardrails',
    detail: 'Moves an existing log entry to another status from its log\'s list, for example a question from exploring to answered, or an issue from open to closed.',
    when: 'An entry\'s state changes: a question is settled or an issue is dealt with.',
    example: 'nexus log status issues focus-ring closed',
  },
  {
    usage: 'guardrail propose <name> --text <t> --source <src> --raised-by <user|claude|agent> [--quote <q>] [--note <n>]',
    summary: '',
    group: 'Logs and guardrails',
    detail: 'Proposes a guardrail: a rule the build has to keep, such as "no new dependencies". A proposal does nothing until you accept it at a gate; after that it is in force, shown in the cockpit\'s guardrails log and listed for the agent by guardrail list --accepted.',
    when: 'You or the agent want a rule written down for the rest of the build.',
    example: 'nexus guardrail propose no-new-deps --text "Add no new runtime dependencies" --source "chat 09:40" --raised-by user',
  },
  {
    usage: 'guardrail withdraw <name>',
    summary: 'take back a proposal',
    group: 'Logs and guardrails',
    detail: 'Takes back a guardrail that is proposed, or one the user declined. An accepted guardrail can\'t be withdrawn; changing one goes through a gate.',
    when: 'A proposal turns out to be wrong or unneeded before anyone has accepted it.',
    example: 'nexus guardrail withdraw no-new-deps',
  },
  {
    usage: 'guardrail list [--accepted]',
    summary: 'guardrails and their state, which comes from gate answers',
    group: 'Logs and guardrails',
    detail: 'Lists the build\'s guardrails with their state: proposed, accepted, declined or withdrawn. The state comes from your gate answers, so it can\'t be set by hand. --accepted shows only the rules in force.',
    when: 'You want to check which rules the build is holding to.',
    example: 'nexus guardrail list --accepted',
  },
  {
    usage: 'gate open <request.json>',
    summary: 'validate a gate request and open it',
    group: 'Gates',
    detail: 'Checks a gate request (the question, its kind, its options or rows) and opens it in the build\'s gates/ folder, where the cockpit shows it for you to answer. A request that doesn\'t validate is refused with the reasons.',
    when: 'The agent runs it whenever it needs a decision from you; you answer in the cockpit.',
    example: 'nexus gate open scope-phase-1.request.json',
  },
  {
    usage: 'gate apply <gate>',
    summary: 'fold the user\'s answers into the logs and mark them read',
    group: 'Gates',
    detail: 'Reads the answers you gave in the cockpit and records them: rows go to the decision log or open questions, a concept pick becomes a decision, an approval is logged. A guardrail gate\'s answers file is its record, and a decommission gate logs one entry listing its marks. It prints what changed and, for a concept round, whether its topic is settled or the Next: round to open.',
    when: 'The agent runs it after you answer a gate; you rarely need it yourself.',
    example: 'nexus gate apply scope-phase-1',
  },
  {
    usage: 'review open <request.json>',
    summary: 'open a review of listed instructions in the Repo view',
    group: 'Gates',
    detail: 'Opens a review in .nexus/reviews/: each row names one item the Repo view lists (a memory, a rule file, a CLAUDE.md), by its id and location, and the cockpit shows Keep, Adjust and Remove on that item\'s card. It works with or without a build; the folder is ignored by git, since a review can name personal memory.',
    when: 'You want to tidy memory or rule files: the agent opens the review, you mark it in the Repo view, the agent makes each change.',
    example: 'nexus review open tidy-memory.json',
  },
  {
    usage: 'review apply <name>',
    summary: 'mark a review applied once its changes are made',
    group: 'Gates',
    detail: 'Prints how many rows were kept, adjusted and removed, then each Adjust or Remove row with its file and note, and marks the review applied, which closes the permits it opened during a build. The agent runs it after making each change: Adjust follows its row note, Remove deletes the file.',
    when: 'The agent runs it after making the changes you marked.',
    example: 'nexus review apply tidy-memory',
  },
  {
    usage: 'review list',
    summary: 'list this repo\'s reviews and their state',
    group: 'Gates',
    detail: 'Lists each review in .nexus/reviews/ with its state (waiting, answered or applied) and title.',
    when: 'You want to see which reviews are open or waiting for the agent.',
    example: 'nexus review list',
  },
  {
    usage: 'check',
    summary: 'validate every file in the build',
    group: 'Diagnostics',
    detail: 'Reads every file in the build folder against its schema and prints each problem with the file it is in. It exits with an error when anything is wrong, so it works in scripts too.',
    when: 'The cockpit shows a problem banner, or after editing build files by hand.',
    example: 'nexus check',
  },
  {
    usage: 'ledger import <progress.md>',
    summary: 'add a run\'s rulings and minors to the logs and keep its task record',
    group: 'Plans and ledgers',
    detail: 'Reads the progress ledger an execution run keeps and adds its rulings to the decision log and its deferred minors to the issues log, skipping any already there. It also keeps the run\'s task record, so the Plan section shows which tasks finished.',
    when: 'At the end of an execution run, before the finish gate.',
    example: 'nexus ledger import .superpowers/sdd/2026-10-06-card-plan/progress.md',
  },
  {
    usage: 'plan [--phase <name>]',
    summary: 'the phase\'s plan: each task by title, with its progress',
    group: 'Plans and ledgers',
    detail: 'Prints the approved implementation plan for the current phase (or the one you name): each task by title, and whether it is pending, in progress or done.',
    when: 'You want the plan\'s progress in the terminal rather than the cockpit.',
    example: 'nexus plan --phase phase-1',
  },
  {
    usage: 'plan index <gate>',
    summary: 'index the tasks of a plan gate approved before nexus tracked them',
    group: 'Plans and ledgers',
    detail: 'Reads the plan an approved plan gate points to and records its tasks, so the Plan section can track them. Plans approved now are indexed when the gate is applied; this is for older ones.',
    when: 'A build\'s plan was approved before nexus tracked plans, and the Plan section is empty.',
    example: 'nexus plan index plan-phase-1',
  },
  {
    usage: 'doctor guard',
    summary: 'check that the wall\'s guard bundle loads',
    group: 'Diagnostics',
    detail: 'First names the harness this copy of nexus was built for and how far its wall holds there. Then loads the guard the wall runs and runs the hook entry once, and says whether each works and, if not, why. In Claude Code, when the guard can\'t run, writes are refused in repos with a build in progress, so this is the first thing to check.',
    when: 'Writes are refused with a message that the guard couldn\'t run, or after updating the plugin.',
    example: 'nexus doctor guard',
  },
  {
    usage: 'doctor superpowers [--path <dir>]',
    summary: 'check the Superpowers anchors nexus relies on',
    group: 'Diagnostics',
    detail: 'Checks that the installed Superpowers skills still contain each line nexus depends on, and names any that moved and what that breaks. --path points at a Superpowers folder other than the installed one.',
    when: 'After every Superpowers update.',
    example: 'nexus doctor superpowers',
  },
  {
    usage: 'doctor docs',
    summary: 'check the docs vault machinery: bundle, hook, registry',
    group: 'Diagnostics',
    detail: 'Checks that the docs-check bundle runs, that the PostToolUse hook is registered to run it after each write, and that the repo\'s docs/_meta/ registry reads, with its class count and contract. It checks the machinery, not the notes: docs check does that.',
    when: 'After installing or updating the plugin, or when the vault hook stops reporting.',
    example: 'nexus doctor docs',
  },
  {
    usage: 'docs check [root] [--file <p>] [--stale] [--json]',
    summary: 'check the docs/ vault against its registry',
    group: 'Diagnostics',
    detail: 'Checks every note in the repo\'s docs/ vault against the class notes in docs/_meta/classes/: where it sits, its status, source, component, tags and links. Blocking findings exit 1; warnings never fail. --file reports one note (judged against the whole vault), --stale compares thing notes with their source\'s git history, and --json prints the report for CI. Outside a vault it checks nothing and exits 0.',
    when: 'Before committing documentation, on main, in CI, or when the hook reports a finding you want to see in full.',
    example: 'nexus docs check --stale',
  },
  {
    usage: 'serve [--port <n>] [--open] [--cockpit <dir>]',
    summary: 'start the cockpit (127.0.0.1, default port 4410)',
    group: 'Serving and hooks',
    detail: 'Starts the cockpit server on this machine only, at http://127.0.0.1:4410/ unless you pick a port, and prints its address and the concept-page address. --open opens it in your browser; --cockpit serves a cockpit build from another folder, for developing nexus. It keeps running until you stop it.',
    when: 'Whenever you want the cockpit open; /nexus:plan starts it for you.',
    example: 'nexus serve --open',
  },
  {
    usage: 'hook',
    summary: 'UserPromptSubmit hook (reads the hook JSON on stdin)',
    group: 'Serving and hooks',
    detail: 'The per-prompt hook. The harness runs it before each of your prompts reaches the agent, and it adds the active build\'s state: its phase and stage, how many guardrails are accepted, and any gates you\'ve answered. With or without a build, it also names each review you\'ve answered that the agent hasn\'t applied. It never blocks a prompt.',
    when: 'Never by hand: the plugin registers it.',
    example: 'nexus hook < hook-input.json',
  },
  {
    usage: 'guard',
    summary: 'PreToolUse hook: the wall (reads the hook JSON on stdin)',
    group: 'Serving and hooks',
    detail: 'The wall. The harness runs it before each of the agent\'s writes and shell commands, and it refuses writes to protected files while a build is active: standing rules (CLAUDE.md, AGENTS.md, settings, rules, memory, the nexus config, the docs vault registry in docs/_meta/), the build\'s record (gate and review answers, build.json, plan.json, opened concept pages, docs/superpowers) and the repo\'s permanent record that decommission writes (docs/governance/decisions.json, issues.json and builds/). A permit you approve lets through one change to a standing rule; neither record ever takes one.',
    when: 'Never by hand: the plugin registers it, through a small loader. Use doctor guard to check it.',
    example: 'nexus guard < hook-input.json',
  },
];

/** The command's name: the words of its usage before the first `<`, `[` or `--`. */
export function commandName(c: CommandSpec): string {
  const words = c.usage.split(' ');
  const first = words.findIndex((w) => /^[<[]|^--/.test(w));
  return (first === -1 ? words : words.slice(0, first)).join(' ');
}

/** One `--help` line, in today's layout: the summary at column 53, or after three spaces when the usage is long. */
export function usageLine(c: CommandSpec): string {
  if (!c.summary) return `  ${c.usage}`;
  return c.usage.length <= 50 ? `  ${c.usage.padEnd(51)}${c.summary}` : `  ${c.usage}   ${c.summary}`;
}
