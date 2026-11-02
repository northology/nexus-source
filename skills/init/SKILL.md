---
name: init
description: "Set a repo up with nexus, once: the docs/ vault and its registry, the shared Obsidian setup, and nexus enabled for the repo. The user starts it as /nexus:init from the repo's root, before any other setup."
disable-model-invocation: true
argument-hint: "[repo root]; run it from the root of a new repo"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)
---

# Set a repo up with nexus

Arguments: $ARGUMENTS

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" <command>` (written `nexus <command>` below).
`nexus init` runs once per repo. It checks everything before writing, and stops with nothing changed on a conflict.

1. Work from the repo root: the argument, or the current folder. If `docs/_meta/` exists, the repo is already set up:
   say so and stop.
2. Ask the user, one question at a time:
   - the repo's components, the parts notes are grouped by (none for a single-part repo), as lowercase words joined
     by hyphens;
   - any starter tags (optional);
   - what already exists that the vault should describe from the start, one line each: what it is and where it lives
     (a spec, a dataset and where its truth is, a design system, product docs). These seed the repo's first build;
     init doesn't write them.
3. Write `.nexus/init-answers.json`:
   `{ "answers": 1, "components": [...], "tags": [...], "seeding": [{ "what": "...", "where": "..." }] }`.
4. Run `nexus init --answers .nexus/init-answers.json --check` and show the user the plan. Stop until they say go.
5. Run `nexus init --answers .nexus/init-answers.json`. If it stops because the network is out, offer
   `nexus init --answers .nexus/init-answers.json --no-plugins` now and `nexus obsidian install` once online. If it
   stops on a conflict, show the user what it printed and stop: never edit around it.
6. Report what was written, and the commit to make: `docs/`, `.nexus/`, `CLAUDE.md`, `.claude/settings.json`,
   `.gitignore` and `.ignore`, by explicit paths. Never commit yourself.
