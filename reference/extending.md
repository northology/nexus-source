# Extending nexus for a repo

nexus ships a lean foundation. Specialised tools for a repo, such as a page for a clustering pipeline's results, are
added from that repo, not built into the plugin.

## Declared views

A view is a page in the cockpit's Repo mode, under Views: one registry note naming a view type nexus ships and the
data file it reads. No code from the repo runs in the cockpit; the data is read inside the repo and nowhere else.

Views need a nexus vault: run `nexus init` first. The cockpit reads view notes only from a vault's registry, so
without `docs/_meta/classes/` no view shows, and the Views section says to set the repo up.

- Write `docs/_meta/views/<name>.md`. The registry is walled during a build, so a view changes through a permit.
- `name` is lowercase words joined by hyphens, and the note is `<name>.md`. `title` is the tab label in the cockpit.
- `data` is a path from the repo root, outside `docs/` (payloads live outside the vault). An absolute path, a `..`
  segment, or a path into `docs/` or `.git/` is refused. When the cockpit reads the file it checks again by its real
  path: a link that leads out of the repo (a symbolic link, a junction, a network path or another drive) is refused and
  named, and nothing under `.git/` is read at any depth.
- `component` (optional) names the component the view belongs to; it must be registered in `docs/_meta/components.md`.
- The note's body is the description shown above the view.
- `view-invalid` also covers a note whose frontmatter can't be read or breaks the schema, `table:` or `chart:` options
  on the wrong type, a chart view without `chart:`, an unregistered `component`, and a name another view already has.
- `nexus docs check` validates it: `view-invalid` and `view-file-name` block; `view-data-missing` warns, since a
  pipeline may write the data later. Until it does, the view says the file doesn't exist yet.
- Data files and Markdown are read up to 5 MB, and images up to 10 MB. A larger file is named, not read.

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

Reads `.csv` (a header row) or `.json` (a list of objects; the columns come from the first 100). It reads up to 10,000
rows and names the total when there are more. You can sort on any column and search every row; the cockpit draws the
first 1,000 rows of what you sorted or searched, and says so. Numbers show in full, without grouping. A column of
numbers with a leading zero, such as `007`, stays text. `columns` picks the columns and their order; a `sort` column the
data lacks, or that `columns` leaves out, is named.

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
No Markdown image loads: an outside one shows as a link to it, and a local one as its alt text; images a Mermaid
diagram names may load, since a repo's files come from colleagues. Raw HTML doesn't run.

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

`kind` is `bar`, `line`, `area` or `scatter`; `y` names one column or several, one series each, all numeric. The data is
read like a table's. Series take six colours, chosen to stay apart for colour-blind readers; past six, lines dash and
scatter points change marker, and a bar chart draws six series and names the rest. Bar and area charts include zero on
the y-axis. Rows past the cap are named; with a numeric `x`, a line, area or scatter chart names the rows with no `x`
value. Up to 1,000 marks draw as SVG, more on a canvas. Focus the chart and the arrow keys, Home, End, Page Up and Page
Down read its values out.

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
`file` relative to the list's folder. Click an image, or press Enter or Space on it, for a large view that steps with
the arrow keys and closes with Escape. An image the cockpit refuses, for leaving the repo, is named; one that fails to
load shows its name.

## Build files

The build's Documents section shows `.csv`, list-of-objects `.json` and images in `documents/` and
`notes/` with the same renderers, with no declaration. A folder's images are one gallery entry, and a table
over 5 MB is named rather than fetched. Charts need a declaration, since they name their columns.

## Custom panels

A compiled component the cockpit loads into a rail section, following the same theme, state grammar and writing
rule, is the escape hatch for what a declared view can't show. It isn't built yet.
