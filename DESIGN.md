---
name: nexus cockpit
description: Swiss information design with line-form state; ruled, flat, graphite, one red that means "needs you".
colors:
  ground: "#F5F5F3"
  sheet: "#FAFAF8"
  ink: "#111111"
  graphite-1: "#2B2B2A"
  graphite-2: "#5C5C59"
  graphite-3: "#6E6E6A"
  rule: "#D9D9D5"
  rule-soft: "#E7E7E3"
  signal: "#E63B2E"
  signal-text: "#C2301F"
  ground-dark: "#141414"
  sheet-dark: "#191919"
  ink-dark: "#EDEDEA"
  graphite-1-dark: "#CFCFCB"
  graphite-2-dark: "#9B9B97"
  graphite-3-dark: "#8E8E8A"
  rule-dark: "#2E2E2D"
  rule-soft-dark: "#242423"
  signal-dark: "#FF5A4B"
  signal-text-dark: "#FF5A4B"
typography:
  label:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Fragment Mono, ui-monospace, monospace"
    fontSize: "60px"
    fontWeight: 400
    lineHeight: 0.82
    letterSpacing: "-0.04em"
  data:
    fontFamily: "Fragment Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
spacing:
  row-gap: "12px"
  gutter: "24px"
  view-x: "48px"
  view-x-narrow: "32px"
  rail: "232px"
  rail-narrow: "176px"
  topbar: "64px"
  view-max: "1180px"
  view-max-wide: "1240px"
  view-max-at-2560: "1800px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  toggle:
    textColor: "{colors.graphite-2}"
    typography: "{typography.data}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  field:
    backgroundColor: "transparent"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: nexus cockpit

Recorded from the shipped cockpit (`cockpit/src/styles/*.css`, `lib/marks.ts`, `lib/rail.ts`, the components and the 40 visual baselines at 960, 1280, 1920 and 2560). The frontmatter carries the token values at a 1920px window (the type and frame grow above it; see Typography and Layout); the dark theme is the `*-dark` entries, applied by `data-theme="dark"` on `<html>`. The CSS variable names are `--ground --sheet --ink --g1 --g2 --g3 --rule --rule-soft --signal --signal-text`. Motion, state grammar and snippets are in `.impeccable/design.json`.

## Overview

**Creative North Star: "The Ruled Sheet"**

A working document, not an app chrome: hairline rules divide everything, state is drawn as line weight and dash rather than coloured badges, and the single accent appears only when something waits on the person. Density is calm and tabular. Light and dark are both first-class. The sheet is fluid from a 960px window (half a 1080p screen, split beside a terminal) to 2560x1440: it folds and stacks when narrow, and widens and scales its type when wide, so it reads at about the same physical size on 1080p and 1440p screens.

**Key Characteristics:**
- Graphite ramp on a cool off-white (or near-black) ground; ink is the only strong colour.
- State is line form: solid, dashed, half, faint-and-struck.
- Flat: no cards, no shadows, 2px corners at most; depth comes from rules.
- Mono for data only; grotesk for everything a person reads.

## Colors

One accent over a neutral ramp. Values are in the frontmatter; both themes keep the same roles.

- **Ground / Sheet.** `ground` is the page and the sticky runner; `sheet` is used only as the fill behind code blocks, raw dumps and Mermaid diagrams.
- **Ink** (`--ink`): primary text, solid marks, active underlines, the primary button fill, the heading rule under `.head` and the submit bar.
- **Graphite 1/2/3** (`--g1 --g2 --g3`): body prose and rail labels (g1), secondary text and captions (g2), tertiary text, column heads, dashed strokes, counts (g3). All are tuned for text contrast in each theme.
- **Rule / Rule-soft**: `rule` for structural lines (top bar, rail edge, column heads, input borders); `rule-soft` for row separators.
- **Signal** (`--signal`, #E63B2E light / #FF5A4B dark): strokes and figures only (the 60px figure, extent-bar cells, needs marks, Mermaid "needs" outlines). Large or non-text.
- **Signal-text** (`--signal-text`, #C2301F light, 5.15:1 on ground; same as signal in dark): any red text under 18px (rail and runner counts, "needs you" notes, the "waiting for you" marker).

**The Needs-You Rule.** Red means exactly one thing: something waits on the user. It is never a status, an error, a warning or decoration, and never a log status (`needs` is not in any `LOG_STYLES`). Allowed places, and only these:
1. Rail count when a gate is open or a document is attached to an open gate (`.cnt.needs`), plus the matching extent-bar cells (`.extent i.need`).
2. Runner tab count for an open gate (`.c.needs`).
3. The 60px gate figure while any gate is open; it turns ink (`.calm`) at zero.
4. Documents list: the "needs review" link under a file attached to an open gate (`.needs-note`).
5. Concepts, while a round is open: the "waiting for you" marker on a round in the Proposed list (`.crounds .needs`), the Proposed tab count (`.c.needs`), and the rail's Concepts count and extent cells (`.cnt.needs`, `.extent i.need`). Chosen has no red: its tab count and everything under it stay ink and graphite.
6. Mermaid nodes tagged `needs` (stroke only).
7. Repo view, while a review is open: the banner's "n of m to mark" count (`.review-banner .review-status .needs`).
8. `.mk-needs` stroke is defined but no component currently renders it.

**The Two-Reds Rule.** Use `--signal` for strokes and the figure; use `--signal-text` for any small red text. Never put `--signal` on text below 18px in light theme.

## Typography

**Sans:** Schibsted Grotesk 400/500/600/700, bundled via `@fontsource` (no CDN). **Mono:** Fragment Mono 400, bundled. Both fall back to system faces.

Four sizes only: **12** label (`--f-label`), **14** body (`--f-body`), **22** title (`--f-title`), **60** figure (`--f-figure`). No other font sizes appear.

**The Fluid Scale.** The four tokens are `clamp()`s: they hold 12/14/22/60 up to a 1920px window and grow linearly to 14/16/26/72 at 2560 (for example `--f-label: clamp(12px, calc(12px + (100vw - 1920px) * 0.003125), 14px)`). Still four sizes at any width. Mermaid diagrams take the body size as drawn (`getComputedStyle(body)`) and redraw when the window crosses a whole pixel of it. The sizes below are their 1920 values.

- **Label 12 / 400:** column heads, captions, counts, toggles, stage names, paths, hints. Sentence case, no tracking, no uppercase.
- **Body 14 / 400, 1.5:** rows, rail labels, buttons (600), tabs (active 600).
- **Title 22 / 600, -0.02em:** page and build names, empty-state headline, markdown h1, fact values.
- **Figure 60 / Fragment Mono, line-height .82, -0.04em:** the single count on the gate head only.
- Markdown headings h2/h3 are 14px weight 600/500; hierarchy comes from weight and spacing, not size.

**The Mono-For-Data Rule.** Fragment Mono (`.mono`, tabular numerals) is for figures, counts, times, paths, branch names, ids, code, toggle labels and the theme switch. Never for prose, labels of meaning, or headings.

## Layout

App frame: 64px top bar across; 232px rail left; main field right. Main content sits at 48px side padding, max 1180px (1240 for documents). Rows are ruled grids with 12px column gaps (gate: 28/36/1fr/132/112; logs: 28/1fr/96/132/96). Rail items pad 12px 24px. Documents is a 260px sticky list plus a reader with 40px gap. These are the 1920 values.

**The Scaled Pixel.** `--px` is `calc(var(--f-body) / 14)`: 1px up to 1920, 16/14px at 2560. Anything that sits with text is written `calc(n * var(--px))` so proportions hold as the type grows: rail width, top-bar height, stage steps (118) and their tick and track offsets, gate and log column widths and row heights, gate and log marks (14x20, 10x14), action buttons (32x28) and their 14px icons, the search field (240), the documents list (260) and sticky offsets (72), fact columns (180), the note field's cap (560) and task-list boxes (11). Hairlines (1px, 1.5px), extent cells (6px) and spacing stay fixed.

What changes with the window:
- **Up to 1200px (narrow; a split 1080p screen).** Rail 176px with 16px insets; labels, counts and extent bars kept; side padding 32px. The stage track keeps its ticks and numbers; the stage names are visually hidden (still read by screen readers) and steps are 40px. The build name truncates with an ellipsis before anything is pushed off. The view bar wraps: status toggles on one row, search (filling the row) with its count and "Copy this view" on the next. Gate and log rows fold the Source / From / Commit column under the statement (its column head drops; an empty source adds no line); marks, status, time and the action buttons stay on the row. The gate submit bar wraps: note field full width, the hint and buttons together on the right. Documents: the list stacks above the reader at full width, the contents list above the text. The runner wraps rather than scrolling sideways if a build has many long gate names.
- **1201-1919px.** The 1920 layout; the 1180px content cap is wider than the field, so rows fill it.
- **1600px and up.** Documents get a third column: the contents list sits to the right of the text (220 x `--px` wide, a 1px rule on its left), sticky while reading. The document list stays on the left. The approve gate's embedded reader keeps its contents above the text.
- **1920px.** The reference layout, unchanged from the original baselines.
- **Above 1920 to 2560.** Type and `--px` dimensions grow (rail 265px, top bar 73px at 2560) and the content cap grows from 1180px to 1800px (`--view-max`; documents from 1240 to 1800), so gate rows, log tables and the concepts list stretch while prose keeps its measure. The field to the right of the content cap is kept clear on purpose: it is reserved for a possible right sidebar or later features, so don't fill it.

No window from 960 to 2560 scrolls sideways; `tests/e2e/responsive.spec.ts` checks every route and the empty, offline and picker states at 960, 1100, 1280, 1600, 1920 and 2560.

**Visual snapshots are exact.** `tests/e2e/visual.spec.ts` compares at `maxDiffPixelRatio: 0` (Playwright's default colour `threshold` stays). Baselines are made and checked on one machine, so nothing needs absorbing; the workspace convention of 0.01 hid real changes here. The cost: a Playwright upgrade (a new bundled Chromium) or a Windows font-rendering update shifts anti-aliasing in every image at once, so every snapshot fails together. Such an upgrade goes in a commit of its own that regenerates the baselines, after looking at a sample of the image diffs to confirm only rendering moved; never alongside a real change.

**The Reader Measure.** The reader is capped at 72ch (plus the contents column at 1600px and up); prose (p, li, h1-h3, blockquote) at 54ch of the body size (about 65-75 characters of running text at any width, since `ch` grows with the type); tables, code and diagrams use the full reader width. Line-height 1.65 for prose. Head paragraphs cap at 68ch, quotes at 66ch, empty states at 60ch.

Navigation has three levels, the same everywhere:
1. **Rail** (`Rail`): Gate, Plan, Logs, Concepts, Documents. Label, mono count, and a 3px stepped extent bar (6px cells, 2px gaps, max 12: `on` g2, `off` rule, `need` signal). Active item: ink 600 label with a 1px ink bar on the left edge. Foot holds the time-zone select; a build picker appears only with more than one build.
2. **Runner** (`Runner`, sub-menu): sticky tab row, 28px gaps, each tab with a mono count; active tab is ink 600 with a 1.5px drawn underline.
3. **View bar** (`ViewBar`): under the runner; "Show" status toggles with their marks, search (240px, right-aligned; its own row when narrow), "n of m" match count, copy-this-view.

## Elevation & Depth

Flat. No cards, no shadows, no gradients, no blur; the only `box-shadow` is a 1.5px inset ink edge used as the current-item line in the documents list. Depth is built from rules: `rule` (1px) for structure, `rule-soft` for rows, a 1px ink rule to close a section (`.head`, `.submit`), and `sheet` fill for code and diagrams. Hover is a 2.5% ink tint on rows or a colour shift to ink.

**The Rules-Not-Boxes Rule.** Group with a hairline and spacing. A bordered box (1px rule) is reserved for inputs, buttons, the offline banner and the problems notice (which has an ink top rule).

## Shapes

Square and hairline. Radius is 2px on buttons, toggles, inputs, selects, inline code; nothing else is rounded (the scrollbar thumb aside). Strokes are 1.5px for marks, underlines and focus; 1px for rules. Focus: 1.5px ink outline, 2px offset.

## Components

**Line-form state grammar** (`Mark`, `lib/marks.ts`; gate marks in `gate.css`). A 10x14 (gate: 14x20) vertical stroke, 1.5px:
- **Solid ink** = accepted / live: decisions accepted, changes applied, questions answered, gate "accepted", chosen option.
- **Dashed g3 (3 3)** = exploring / pending: issues open, questions exploring, unmarked gate rows, pending Mermaid nodes.
- **Half-height ink** = research: questions research, issues addressed, gate "research".
- **Faint (40%) dashed + struck text** = declined / settled: decisions declined, changes reverted (struck); issues closed (faint, not struck). Struck text is 1px line-through in g2/g3.

Where they appear: gate rows and options, log row marks (`.emark`), view-bar toggle chips (an off toggle is g3 and struck), and diagrams. Default-shown statuses: decisions accepted; issues open; changes applied; questions exploring and research. Others are hidden behind a "hidden n, show all" note.

**Buttons.** Primary: ink fill, ground text, 600, 9px 16px, 2px radius; disabled becomes transparent with g3 text and rule border. Ghost: transparent, rule border, ink text, hover border g2. Small: 12px, 6px 10px. Icon actions (`.act`, 32x28): rule border, 14px 1.5px-stroke SVG, pressed = ink fill.

**Fields.** Transparent, 1px rule border, 2px radius; focus turns the border ink and drops the outline. Selects and toggles are mono 12px.

**Top bar.** Brand, then build name (22px, truncating with an ellipsis) over mono branch, then four numbered stages on one hairline: solid ink up to the current stage, dashed g3 after; a 14px tick marks each stage, and narrow windows show the numbers only. Light/Dark switch at the right (pressed = ink fill), never pushed off-screen.

**Gate head.** `Figure` (60px mono, red while open, ink when calm) beside a 22px title, closed by a 1px ink rule. Empty state shows a calm figure.

**Documents.** Sticky list (name 500, mono path 12px g2), reader with path bar, contents links, markdown. Code highlighting uses weight and graphite only, no hues. Mermaid diagrams are restyled to the grammar after render: `done` ink 1.5px solid, `pending` g2 dashed (4 3), `needs` signal; filters (shadows) removed.

## Motion

State is drawn, not faded. Marks draw by `scaleY` from the bottom (.32s), strikes and runner underlines by `scaleX` from the left (.36s and .3s), all on `--ease` `cubic-bezier(0.16, 1, 0.3, 1)`; the figure colour eases .4s; action buttons transition at .15s. `prefers-reduced-motion: reduce` zeroes every transition and animation duration. No other animation exists.

## Extending

- Compose from the tokens and the four sizes; add no fifth size, no new hue, no second accent.
- A new status maps onto an existing mark kind in `LOG_STYLES`; add a row there, never a colour.
- A new category adds a `RailItem` (label, count, `needs`, cells); a new sub-page adds a `Tab` to `Runner`; page controls go in `ViewBar`. Tab and rail counts turn red only under the Needs-You Rule.
- New lists are ruled rows (grid, 12px gaps, `rule-soft` separators, 1px `rule` under a 12px `g3` column head), not cards.
- New long text goes in the reader measure; new data text uses `.mono`.
- Any new motion is a draw (scale from an edge) on `--ease`, and must fall under the reduced-motion rule.
- Canvases (plan maps, second sweep): lanes on a dotted grid, lines bend only at 45 and 90 degrees, solid done, dashed pending, red waiting on the user. Not yet built; nothing is recorded as shipped.

## Do's and Don'ts

### Do:
- **Do** use `--signal-text` for small red text and `--signal` for strokes and the figure.
- **Do** express state with the mark kinds and strike, and pair every mark with a text label (marks are `aria-hidden`).
- **Do** keep needs-you counts readable to assistive tech (`(needs you)` hidden text on the rail).
- **Do** use rules for separation and `sheet` only for code and diagrams.

### Don't:
- **Don't** use red for errors, warnings, closed or declined states.
- **Don't** add cards, shadows, gradients, rounded corners over 2px, or coloured badges.
- **Don't** use Fragment Mono for prose or headings.
- **Don't** introduce font sizes outside the four tokens (12/14/22/60 at 1920, growing to 14/16/26/72 at 2560), and don't hard-code a px font size anywhere, diagrams included.
- **Don't** animate by fading or sliding; draw lines instead.
