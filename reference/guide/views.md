# Views

Add a page to the cockpit's Repo mode with one registry note: a note in `docs/_meta/views/` that names a view type
nexus ships and the data file it reads. The page shows under Repo › Views. Nothing from the repo runs in the cockpit:
it reads the data file inside the repo and draws it with its own renderers.

Views need a nexus vault: run `nexus init` first. The cockpit reads view notes only from a vault's registry, so
without `docs/_meta/classes/` no view shows, and the Views section says to set the repo up.

## Declaring a view

- Write `docs/_meta/views/<name>.md`. The registry is walled during a build, so a view changes through a permit.
- `name` is lowercase words joined by hyphens, and the note is `<name>.md`. `title` is the tab label.
- `data` is a path from the repo root, outside `docs/`. An absolute path, a `..` segment, or a path into `docs/` or
  `.git/` is refused. The cockpit checks the real path again when it reads the file, and refuses and names a link
  that leads out of the repo.
- `component` (optional) names the component the view belongs to; it must be registered in
  `docs/_meta/components.md`.
- A note is invalid when its frontmatter can't be read or breaks the schema, when it has `table:` or `chart:` options
  on the wrong type, for a chart view without `chart:`, for an unregistered `component`, and for a name another view
  already has.
- The note's body is the description shown above the view.
- Data files and Markdown are read up to 5 MB, and images up to 10 MB. A larger file is named, not read.

## The four view types

### Table

```yaml
---
name: traffic-load
title: Traffic load
type: table
data: data/out/traffic-load.csv
table:
  columns: [region, requests, errors]
  sort: { column: requests, dir: desc }
---
```

Reads `.csv` (a header row) or `.json` (a list of objects). It reads up to 10,000 rows and names the total when there
are more. Sort on any column and search every row; the cockpit draws the first 1,000 rows of what you sorted or
searched, and says so. `columns` picks the columns and their order, and `sort` the starting sort.

### Markdown

```yaml
---
name: runbook
title: Runbook
type: markdown
data: reports/runbook.md
---
```

A rendered page, Mermaid diagrams included. Links to other files show as text, and only web and `mailto:` links open.
No Markdown image loads: an outside one shows as a link to it, and a local one as its alt text. Only the images a
Mermaid diagram names may load.

### Chart

```yaml
---
name: lag-trend
title: Lag trend
type: chart
data: data/out/lag.csv
chart: { kind: line, x: day, y: [north, south] }
---
```

`kind` is `bar`, `line`, `area` or `scatter`; `y` names one column or several, one series each, all numeric. Series
take six colours that stay apart for colour-blind readers; past six, lines dash and scatter points change marker, and
a bar chart draws six series and names the rest. Bar and area charts include zero on the y-axis; with a numeric `x`,
a line, area or scatter chart names the rows with no `x` value. Focus the chart and use the arrow keys, Home, End, Page
Up and Page Down to read its values.

### Gallery

```yaml
---
name: screens
title: Screens
type: gallery
data: data/screens
---
```

A folder's images (PNG, JPEG, GIF, WebP, AVIF, SVG), by name; or a `.json` list of `{ "file", "caption" }`, with each
`file` relative to the list's folder. Click an image for a large view; the arrow keys step through them and Escape
closes it. An image refused for leaving the repo is named.

Boards are JSON Canvas files in the docs/ vault, opened in Obsidian.

## Files in a build

The build's Documents section shows `.csv`, list-of-objects `.json` and images in `documents/` and
`notes/` with the same renderers, with no declaration. A folder's images are one gallery entry, and a table
over 5 MB is named rather than fetched. Charts need a declaration, since they name their columns.

## Checking a view

[`nexus docs check`](#/guidance/commands?h=docs-check) checks every view note. `view-invalid` (a note that can't be read
or breaks a rule under "Declaring a view") and `view-file-name` (a note not named `<name>.md`) block;
`view-data-missing` warns, since a pipeline may write the data later, and the view says the file doesn't exist yet until
it does.
