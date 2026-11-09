# nexus

A cockpit for planned builds with an AI agent. nexus keeps a build's record in the repo, under `.build/<build>/`: the
guardrails it holds to, its decisions, questions, issues and changes, the specs and plans it follows, and the concept
rounds you picked from. You read that record and answer gates in the cockpit, a page in your browser, while the agent
does the work. A wall keeps the agent from changing your standing rules or the record behind your back.

How a build runs, every command and a glossary are in the cockpit's **Guidance** tab (the same pages are in
`reference/guide/`). This file covers installing, setting up, running and releasing the plugin.

## Requirements

[INSTALL.md](INSTALL.md) is the full install and dependency guide: versions, Superpowers in each harness, building
from source, checking the install, updating and troubleshooting. In short:

| Need | Why |
|---|---|
| Claude Code 2.1.288 or later, or Codex or Antigravity (see [Harnesses](#harnesses)) | the plugin's hooks and skills; the wall was verified on Claude Code 2.1.288 |
| Node.js 20 or later, as `node` on the PATH | the hooks and the CLI run with it |
| git | builds work on their own branches, and the record is committed |
| The Superpowers plugin, 6.4.1, 7.0.0 and 7.0.1 | `/nexus:plan` runs planning through its brainstorming, plan-writing and execution skills; `nexus doctor superpowers` checks only the newest installed |

nexus is developed on Windows; macOS and Linux paths are handled too.

## Install

This section installs the Claude Code package; Codex and Antigravity have their own, under [Harnesses](#harnesses).

nexus is published from the nexus marketplace, the private GitHub repository `northology/nexus`. It holds each
release under `plugins/<name>/`, for nexus and, in time, the other tools under the nexus umbrella. The plugin's id is
`nexus@nexus`. Its README covers access to the private repository: git on your machine needs a stored GitHub
credential (`gh auth login`, then `gh auth setup-git`) or an SSH key, and without an SSH key you set
`CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

Enable it per repo (project scope), in the repos that build with nexus. In Claude Code, from the repo:

```text
/plugin marketplace add northology/nexus
/plugin install nexus@nexus
```

Choose project scope when asked; from a terminal it's `claude plugin install nexus@nexus --scope project`. Or commit
the same thing in the repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "nexus": { "source": { "source": "github", "repo": "northology/nexus" } }
  },
  "enabledPlugins": { "nexus@nexus": true }
}
```

To develop nexus, register the source folder as the marketplace instead (`/plugin marketplace add <path to the
source>/nexus`, or a `"directory"` source with that path): sessions then load each committed release from
`plugins/nexus/` in place, after `/reload-plugins`.

Restart Claude Code, then check it: `/plugin` lists nexus, and asking the agent to run `nexus doctor guard` reports that
the guard bundle loads and the hook entry runs.

To try a local build without installing it, copy `dist/nexus` somewhere the tests won't rebuild (this repo uses the
git-ignored `.trial/nexus`) and start `claude --plugin-dir <that folder>`.

### Running the CLI yourself

The agent runs nexus as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>`. From a terminal, use the installed copy
under `~/.claude/plugins/cache/nexus/nexus/<version>/bin/nexus.mjs`, or a build's `dist/nexus/bin/nexus.mjs`. The
Guidance tab's Commands page lists every command.

## Harnesses

nexus is built once into three packages, one per harness, each named `nexus` and at the same version. Install the
one for the harness you use. A repo already set up takes Codex or Antigravity as well by running `nexus init` from
that harness, which then adds only its `AGENTS.md` block; Claude Code's `nexus init` still runs only on a new repo, so
set a repo that will use all three up from Claude Code first. Then `nexus docs generate` from each harness writes that
harness's rule files.

| Harness | Package | Status | The wall |
|---|---|---|---|
| Claude Code | `plugins/nexus/` | supported | A `PreToolUse` hook. While a build is in progress, a hook that can't run refuses the write. |
| Codex | `plugins/nexus-codex/` | supported (proven on codex-cli 0.162.0) | A `PreToolUse` hook, which Codex's own docs call "a useful guardrail, not a complete enforcement boundary". It runs only once you trust nexus's hooks in `/hooks`. Until then, and whenever the hook fails (any exit code, a timeout or unreadable output, on codex-cli 0.162.0), writes go through. |
| Antigravity | `plugins/nexus-antigravity/` | supported (proven on agy 1.4.12) | A `PreToolUse` hook. Antigravity's docs say a failing hook is ignored; on agy 1.4.12 one blocked the write instead, and nexus answers with an explicit deny either way. If the plugin's hooks don't load, writes go through. There is no docs check after a write. |

`nexus doctor guard` starts by naming the harness its package was built for, with that harness's line from this table.
"Proven" means a live session in that harness, at that version, installed the package, set a repo up, started a
build, and had the wall refuse a write to the record.

**In Codex:**

- Add the marketplace (`codex plugin marketplace add northology/nexus`, or the path to a clone of it) and run
  `codex plugin add nexus@nexus`. Codex takes the Codex package, which the repository lists for it in
  `.agents/plugins/marketplace.json`. Then start `codex`, open `/hooks` and trust each of nexus's three hooks: the
  wall and the status line don't run until you do.
- Install Superpowers from obra: `codex plugin marketplace add obra/superpowers`, then
  `codex plugin add superpowers@superpowers-dev`. Turn on `multi_agent = true` under `[features]` in Codex's
  `config.toml`, so its spec check can send a subagent.
- On Windows, if Codex's own sandbox can't set itself up, `workspace-write` runs read-only and `nexus init` can't
  write: run that session with another sandbox mode, or set Codex's Windows sandbox up first.
- Start nexus's skills as `$nexus:plan`, `$nexus:init` and `$nexus:decommission`: Codex names a plugin's skills
  `<plugin>:<skill>`.
- `nexus init` writes its block to `AGENTS.md`; `nexus docs generate` writes the vault's rules into a generated
  section inside that block, since Codex reads no rules folder. Codex reads only the first 32 KiB of `AGENTS.md`, so
  `docs generate` warns when the file would pass that, naming the largest rules.

**In Antigravity:**

- Install the package folder: `agy plugin install <a clone of northology/nexus>/plugins/nexus-antigravity`, and
  Superpowers with `agy plugin install https://github.com/obra/superpowers`.
- Its hooks run `node ./bin/…` from the plugin's folder, so `node` must be on the PATH Antigravity starts with.
- A one-shot `agy -p` run ends its background tasks when it finishes, the cockpit included; start the cockpit
  yourself (below) when you work that way.
- Start nexus's skills as `/nexus:plan`, `/nexus:init` and `/nexus:decommission`.
- `nexus init` writes its block to `AGENTS.md`; `nexus docs generate` writes `.agents/rules/nexus-<rule>.md`, since
  Antigravity reads that folder flat. Run `nexus docs check` yourself: there is no docs hook.

**The cockpit**, in either: the agent starts `nexus serve` and gives you its address, `http://localhost:<port>`. If
the harness's sandbox stops it from starting or staying up, start it yourself from a terminal in the repo:
`node <the installed plugin>/bin/nexus.mjs serve`.

## Set up a repo

On a new repo, run `/nexus:init` first, before any other setup: it asks for the repo's components, tags and what the
vault should describe, then runs `nexus init`, which sets up the `docs/` vault, its Obsidian settings and plugins, and
enables nexus for the repo. See `reference/vault.md`.

Nothing else is required: `/nexus:plan <build>` creates the build, its branch and `.build/<build>/`, and starts the
cockpit.
Commit `.build/` with the work; it is the record.

Optionally, before the first build, add `.nexus/config.json`:

```json
{
  "staticRules": ["CLAUDE.md", ".claude/rules/testing.md"],
  "protect": ["docs/decisions/**", "~/.config/tool/settings.json"]
}
```

- `staticRules`: the standing rule files the cockpit shows beside the build's guardrails. `/nexus:plan` asks once
  if the file doesn't exist.
- `protect`: extra files the wall protects during a build, as globs from the repo root, from home with `~/`, or
  absolute. They join the defaults (a repo can't remove one), and like the default standing rules they can take a
  permit. An entry
  containing `..` is ignored and reported.

The config file is itself protected while a build is active, so set it up before starting one.

## Running the cockpit

`nexus serve` starts it on this machine only, at `http://127.0.0.1:4410/` unless you pass `--port`; when a port is in
use it tries the next ones. It prints a second address, for concept pages, on its own random port so they run apart
from the cockpit. The cockpit page carries a token the server checks, so other local pages can't post answers.
`/nexus:plan` starts it for you; `nexus serve --open` opens it in your browser.

## Decommission a build

Once a build's last phase is closed, `/nexus:decommission <build>` moves its record into the repo's: at one gate you
mark which accepted guardrails become repo rules, and one commit writes those, keeps the final report as the build's
record, logs the decisions of note and the open issues, archives the build's documents, and removes
`.build/<build>/`. The `Decommission <build>` commit follows a record commit of the build folder. Branches are left
as they are, and nothing is pushed. See `reference/vault.md`.

## Health checks

| Check | What it tells you | When |
|---|---|---|
| `nexus doctor guard` | the wall's guard bundle loads and its hook entry runs | after installing or upgrading, or when writes are refused because the guard couldn't run |
| `nexus doctor superpowers` | Superpowers still has every line nexus relies on, and what breaks if one moved | after every Superpowers update |
| `nexus check` | every file in the build matches its format | when the cockpit shows a problems banner, or after editing build files by hand |
| `nexus phase status` | the phase's gates and the step to resume at | when coming back to a build |

## Upgrading

- **nexus:** `claude plugin marketplace update nexus`, then `claude plugin update nexus@nexus` (or both from
  `/plugin`), restart Claude Code, then run `nexus doctor guard`.
  Claude Code caches plugins by version, so a release is visible only once its version changes. Builds in progress
  carry over: the record's formats are checked by `nexus check`.
- **Superpowers:** after updating it, run `nexus doctor superpowers`. A missing anchor names the nexus behaviour it
  breaks; `reference/superpowers.md` says how the two connect.

If an upgrade leaves the guard unable to run, the wall refuses the agent's writes in repos with a build in progress and
stays out of the way everywhere else, so finished and unrelated repos keep working. `nexus doctor guard` says why.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The agent says a write was refused by the wall | the file is protected while a build is active | for a standing rule (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md`, rules, settings, memory, config, `docs/_meta/`, your `protect` entries), ask for the change: the agent opens a gate with a permit, and has 30 minutes after you approve. The build's record (answers, `build.json`, `plan.json`, opened concept pages, `docs/superpowers/`), a review's answers and the repo's permanent record (`docs/governance/decisions.json`, `issues.json`, `builds/`, written at decommission) never take a permit; a build's gate answers stay walled until decommission removes it |
| Writes refused with "the guard couldn't run" | a broken or half-updated plugin | run `nexus doctor guard`; reinstall or roll back the plugin |
| The cockpit says it can't reach the server | `nexus serve` stopped | start it again; the page reconnects by itself |
| The cockpit shows a problems banner | a build file doesn't match its format | `nexus check` names each file and problem |
| A finished build still holds the wall up | its phase reached close-out without an approved finish gate | open and approve `finish-<phase>` (`/nexus:plan` step 5), then `nexus stage close-out` |
| Specs or plans are refused under `docs/superpowers/` | Superpowers' default location is walled during a build | they belong in `.build/<build>/documents/`; if this keeps happening, run `nexus doctor superpowers` |
| `/nexus:plan` doesn't pick a build back up | the working tree isn't clean, or another build is active | commit or stash, then run it again; the agent asks before touching another build |

The wall binds the agent only: you can always change any file yourself, outside the harness.

## Development

| Folder | What it holds |
|---|---|
| `core/` | the build model: files, schemas, gates, logs, guardrails, the wall's path and shell reading |
| `hooks/` | the per-prompt hook and the guard (the wall) |
| `server/` | the cockpit's local server and API |
| `cockpit/` | the cockpit (React and Vite) |
| `scripts/` | the CLI, the command table, the hook loader and the doc generators |
| `skills/` | the five skills: `nexus`, `/nexus:plan`, `/nexus:decommission`, `/nexus:init` and `grill-me` |
| `standard/` | the docs vault standard `nexus init` and `docs upgrade` copy into a repo: classes, components, tags, contract |
| `reference/` | the reference pages the agent reads, and `guide/`, the Guidance tab's pages |
| `schemas/` | JSON Schemas for every build file |
| `design/` | dated design specs and plans, the history of each change |
| `tests/` | Vitest units and Playwright end-to-end tests, with example builds |

Run these in this folder:

| Command | What it does |
|---|---|
| `pnpm test` | unit tests |
| `pnpm e2e` | builds the cockpit, then the end-to-end and visual tests |
| `pnpm typecheck` | the root, cockpit and end-to-end TypeScript projects |
| `pnpm build` | the cockpit and the three packages, into `dist/nexus/`, `dist/nexus-codex/` and `dist/nexus-antigravity/` |
| `pnpm guide` | regenerates the Guidance commands page from `scripts/commands.ts` |
| `pnpm contracts` | regenerates `reference/contracts.md` from the schemas |

A new command goes in `scripts/commands.ts`, which builds both `--help` and the Guidance commands page; a test fails
when the CLI handles a command the table lacks. Visual baselines are updated in a commit of their own.

## Releasing

1. On a clean `main`, run `pnpm test`, `pnpm typecheck` and `pnpm e2e`, all green.
2. Bump `version` in `.claude-plugin/plugin.json` (semantic versioning) and add its entry to `CHANGELOG.md`.
3. `pnpm build`, then `node dist/nexus/bin/nexus.mjs doctor guard` and `doctor superpowers`, and
   `agy plugin validate --strict dist/nexus-antigravity`.
4. Replace `plugins/nexus/`, `plugins/nexus-codex/` and `plugins/nexus-antigravity/` with `dist/nexus/`,
   `dist/nexus-codex/` and `dist/nexus-antigravity/`, and commit the three folders, `plugin.json` and `CHANGELOG.md`
   together.
5. Publish to `northology/nexus`, in a clone of it beside this repo: replace its three `plugins/` folders with these
   release folders, copy `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json` and `CHANGELOG.md`
   over, and run `claude plugin validate .`. Then
   commit `nexus <version>`, tag `nexus--v<version>`, and push the branch and the tag. That repo's README, LICENSE
   and CLAUDE.md are its own: update its Known issues when a release fixes one. `.agents/plugins/marketplace.json`
   points at `./plugins/nexus-codex`, which only step 4 creates: a Codex marketplace added from a checkout between
   releases finds the last release's folder, or none.
6. Publish the public source to `northology/nexus-source`, in a clone of it beside this repo: `pnpm snapshot
   ../nexus-source` replaces the clone's files with this commit's, leaving out the build records (`.build/`), the
   design history (`design/`), this repo's docs vault (`docs/`), the built releases (`plugins/`) and this repo's own
   config. It refuses on uncommitted
   changes, and on any line that matches a name in the private `.publish/internal-names`; `pnpm snapshot --check` runs
   just that scan. Then commit `nexus <version>` there, tag `nexus--v<version>`, and push the branch and the tag.
7. Users update from `/plugin`; the new version number is what makes the update visible.

The build copies only `plugin.json` from `.claude-plugin/`, so the marketplace's own manifest never travels into the
plugin. The marketplace manifest, `.claude-plugin/marketplace.json`, was written with the first release (1.0.0); a
later tool under the nexus umbrella joins it as another entry in `plugins`:

```json
{
  "name": "nexus",
  "owner": { "name": "Brent Colman" },
  "metadata": { "description": "nexus and the tools under its umbrella." },
  "plugins": [{ "name": "nexus", "source": "./plugins/nexus", "description": "A cockpit for planned builds with an AI agent." }]
}
```
