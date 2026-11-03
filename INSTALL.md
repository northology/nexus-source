# Installing nexus

This guide covers everything nexus needs, how to install it in Claude Code, Codex or Antigravity, and how to check it
works. Once it's installed, the [README](README.md) covers setting up a repo and running a build.

- [What you need](#what-you-need)
- [Get nexus](#get-nexus): from the release marketplace, or built from this source
- [Install in Claude Code](#install-in-claude-code)
- [Install in Codex](#install-in-codex)
- [Install in Antigravity](#install-in-antigravity)
- [Check it](#check-it)
- [Updating](#updating)
- [Troubleshooting the install](#troubleshooting-the-install)
- [Developing nexus](#developing-nexus)

## What you need

| Need | Version | Why | Check it |
|---|---|---|---|
| Node.js, as `node` on the PATH | 20 or later | nexus's hooks, CLI and cockpit server are Node programs | `node --version` |
| git | any recent | each phase of a build works on its own branch, and the record is committed with the work | `git --version` |
| A harness | Claude Code 2.1.288 or later, Codex CLI (proven on 0.162.0) or Antigravity (proven on agy 1.4.12) | nexus is a plugin for one of them | `claude --version`, `codex --version`, `agy --version` |
| Superpowers | 6.4.1, 7.0.0 or 7.0.1 (newer versions are checked by `nexus doctor superpowers`) | nexus's planning runs through its brainstorming, plan-writing and execution skills | `nexus doctor superpowers`, once nexus is installed |
| A web browser | any current one | the cockpit is a local page, served from your machine | |
| Obsidian | optional | `nexus init` sets up a `docs/` vault that Obsidian opens well; nexus doesn't need it | |

nexus is developed and tested on Windows. It handles macOS and Linux paths too, though those platforms see less use.

**Node must be reachable by the harness, not just your terminal.** The hooks start `node` themselves, with the PATH
the harness was started with. If you install Node or change your PATH, restart the harness. Version managers work
when their `node` is on that PATH (Volta's shim was tested in all three harnesses).

### Superpowers

[Superpowers](https://github.com/obra/superpowers) is a separate plugin. Install it in the same harness as nexus:

| Harness | Install Superpowers |
|---|---|
| Claude Code | `/plugin install superpowers@claude-plugins-official` |
| Codex | `codex plugin marketplace add obra/superpowers`, then `codex plugin add superpowers@superpowers-dev` |
| Antigravity | `agy plugin install https://github.com/obra/superpowers` |

In Codex, also turn on multi-agent support, so Superpowers' spec check can send a helper agent. In Codex's
`config.toml` (`~/.codex/config.toml`, or under `CODEX_HOME`):

```toml
[features]
multi_agent = true
```

nexus relies on particular passages of Superpowers' skills. After installing or updating Superpowers, run
`nexus doctor superpowers`: it says whether each passage is there, and what breaks if one has moved. nexus supports
6.4.1, 7.0.0 and 7.0.1; with several installed, only the newest is checked, since that is the one the harness loads.

## Get nexus

There are two ways to get nexus. Both give you the same three packages, one per harness:

| Package | For |
|---|---|
| `nexus` | Claude Code |
| `nexus-codex` | Codex |
| `nexus-antigravity` | Antigravity |

**From the release marketplace.** Released versions are published to the GitHub repository `northology/nexus`, which
is private: you need to have been given access. git on your machine must be able to reach it without prompting, with
a stored GitHub credential (install the [GitHub CLI](https://cli.github.com/), then run `gh auth login` and
`gh auth setup-git` once) or an SSH key that loads without a passphrase prompt. Then follow your harness's
"from the release marketplace" steps below.

**Built from this source.** Anyone can build nexus from this repository. You need Node.js 22.18 or later and pnpm 11
for the build (see [Developing nexus](#developing-nexus)); the result runs on Node 20 or later.

```bash
git clone https://github.com/northology/nexus-source.git nexus
cd nexus
pnpm install
pnpm build
```

`pnpm build` writes the three packages to `dist/nexus/`, `dist/nexus-codex/` and `dist/nexus-antigravity/`. The
marketplace files in this repository (`.claude-plugin/marketplace.json` for Claude Code,
`.agents/plugins/marketplace.json` for Codex) list the packages under `plugins/`, so copy them there:

```bash
node -e "for (const p of ['nexus', 'nexus-codex', 'nexus-antigravity']) require('fs').cpSync('dist/' + p, 'plugins/' + p, { recursive: true })"
```

The same command works in PowerShell. Then follow your harness's "from source" steps below, with `<clone>` as the full
path to this folder.

## Install in Claude Code

Install nexus per repo (project scope), so it's on only in the repos that build with it.

**From the release marketplace.** If you have no GitHub SSH key, first set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` in the
environment Claude Code starts with, or installs started from `/plugin` try SSH and fail. Then, in Claude Code:

```text
/plugin marketplace add northology/nexus
```

**From source.**

```text
/plugin marketplace add <clone>
```

Then, either way, open Claude Code in each repo that will build with nexus and run:

```text
/plugin install nexus@nexus
```

Choose **project scope** when asked; from a terminal it's `claude plugin install nexus@nexus --scope project`. Both
marketplaces are named `nexus`, so add only one of them.

To try a build without installing it at all, start a session with `claude --plugin-dir <clone>/dist/nexus`.

## Install in Codex

**From the release marketplace:** `codex plugin marketplace add northology/nexus`.
**From source:** `codex plugin marketplace add <clone>`.

Then, either way:

```text
codex plugin add nexus@nexus
```

Codex picks the Codex package, which the marketplace lists for it in `.agents/plugins/marketplace.json`.

**Trust nexus's hooks.** Codex runs a plugin's hooks only after you trust them. Start `codex`, open `/hooks`, and
trust each of nexus's three hooks (the prompt hook, the wall before each tool, and the docs check after a patch). Until
you do, the wall and nexus's status line don't run. Trust is tied to the hook's contents, so after an update you may be
asked again.

Start nexus's skills as `$nexus:init`, `$nexus:plan` and `$nexus:decommission`.

**On Windows**, if Codex's own sandbox can't set itself up (`codex sandbox` reports setup errors), a `workspace-write`
session runs read-only, and `nexus init` can't write. Run that session with another sandbox mode, or set Codex's
Windows sandbox up first.

## Install in Antigravity

**From the release marketplace:** clone `northology/nexus` (you need access), then:

```text
agy plugin install <your clone>/plugins/nexus-antigravity
```

**From source:**

```text
agy plugin install <clone>/dist/nexus-antigravity
```

Antigravity copies the plugin into its own folder (`~/.gemini/config/plugins/nexus/`), so the clone can move or change
afterwards; to update, pull or rebuild, and install the folder again. Start nexus's skills as `/nexus:init`,
`/nexus:plan` and `/nexus:decommission`.

Antigravity has no docs check after a write; run `nexus docs check` yourself when you change notes in the vault. A
one-shot `agy -p` run ends its background tasks when it finishes, the cockpit included: start the cockpit yourself
(below) when you work that way.

## Check it

Restart the harness (in Claude Code, `/reload-plugins` is enough), then ask the agent to run these, or run them yourself
with `node <the installed plugin>/bin/nexus.mjs <command>`:

| Command | What a good result looks like |
|---|---|
| `nexus doctor guard` | it names your harness and how strong the wall is there, then `ok` for the guard bundle and the hook entry |
| `nexus doctor superpowers` | `All 18 anchors found.` |

Where the installed plugin lives:

| Harness | Folder |
|---|---|
| Claude Code | `~/.claude/plugins/cache/nexus/nexus/<version>/` |
| Codex | `~/.codex/plugins/cache/nexus/nexus/<version>/` (or under `CODEX_HOME`) |
| Antigravity | `~/.gemini/config/plugins/nexus/` |

Then set a repo up with `/nexus:init` (`$nexus:init` in Codex) and start a build with `/nexus:plan <build-name>`: the
[README](README.md) walks through both. The agent starts the cockpit and gives you its address, `http://localhost:<port>`
(4410, or the next free port). To start it yourself, from a terminal in the repo:

```bash
node <the installed plugin>/bin/nexus.mjs serve
```

## Updating

A new version shows up when its version number changes.

| Harness | Update |
|---|---|
| Claude Code | `claude plugin marketplace update nexus`, then `claude plugin update nexus@nexus`, then `/reload-plugins` |
| Codex | `codex plugin marketplace upgrade nexus` (a release marketplace) or rebuild (from source), then remove and add `nexus@nexus` again |
| Antigravity | pull or rebuild, then install the folder again |

From source, rebuild first: `git pull`, `pnpm install`, `pnpm build`, and the copy command above. Builds in progress
carry over an update. Run `nexus doctor guard` afterwards, and `nexus doctor superpowers` after updating Superpowers.

## Troubleshooting the install

| Symptom | What to do |
|---|---|
| `node` isn't found, or the hooks fail to start | install Node.js 20 or later so `node` is on the PATH the harness starts with, then restart the harness |
| `/plugin marketplace add northology/nexus` or an update fails to clone | the release marketplace is private: check you have access, then `gh auth status`, or your SSH key; without an SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` |
| `pnpm install` stops on a build script it won't run | this repo allows esbuild's build step in `pnpm-workspace.yaml`; use pnpm 11, or run `pnpm approve-builds` and allow esbuild |
| `pnpm build` or `pnpm guide` fails on a `.ts` file | the development scripts need Node.js 22.18 or later |
| Writes are refused with "the guard couldn't run" | run `nexus doctor guard`; rebuild or reinstall the plugin |
| In Codex, writes to protected files go through | nexus's hooks aren't trusted yet: trust them in `/hooks` |
| `nexus doctor superpowers` reports missing anchors | your Superpowers version moved a passage nexus relies on; the report names what breaks. Use a listed version until nexus supports it |
| The cockpit page doesn't load | start it yourself (`nexus serve`) and open the address it prints; another program may hold port 4410, in which case nexus takes the next free one |

## Developing nexus

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.18 or later (developed on 24) | the build and development scripts run TypeScript directly |
| pnpm | 11 | the package manager this repo's lockfile and `pnpm-workspace.yaml` are written for |
| Chromium for Playwright | `pnpm exec playwright install chromium` | the end-to-end and visual tests (`pnpm e2e`) |

```bash
pnpm install
pnpm test        # unit tests
pnpm typecheck   # the root, cockpit and end-to-end TypeScript projects
pnpm e2e         # builds the cockpit, then the end-to-end and visual tests
pnpm build       # the cockpit and all three packages, into dist/
```

The README's [Development](README.md#development) section maps the folders and the other commands.
