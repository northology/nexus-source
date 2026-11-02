import { extent } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import type { Cell, TableData } from '../../../core/views/types.ts';
import type { ViewDef } from '../../../core/vault/types.ts';
import { formatCell } from './table.ts';

export const MAX_SVG_MARKS = 1000;
const MARGIN = { left: 56, right: 16, top: 12, bottom: 36 };

export interface ChartModel {
  xKind: 'linear' | 'band';
  xLabels: string[];
  xTicks: { label: string; px: number }[];
  yTicks: { label: string; py: number }[];
  series: { name: string; points: { label: string; y: number | null; px: number; py: number }[] }[];
  marks: number;
  plot: { left: number; top: number; width: number; height: number };
  bandWidth: number;
  /** Where y is zero, or the nearest edge to it: bars and areas grow from here, and their y range takes in zero. */
  baseline: number;
  /** Rows left out: on a linear x, the rows with no x. */
  dropped: number;
}

/** About one band label per this many pixels of plot. */
const LABEL_SPACING = 60;

/**
 * Scales and points for a chart: D3 does the maths here, React draws in ChartView. A linear x is drawn in x order and
 * leaves out (and counts) rows with no x; bands keep the data's order. Labels read as the table shows them
 * (formatCell). Only bars and areas take zero into the y range; lines and scatters use the data's extent.
 */
export function chartModel(data: TableData, opts: NonNullable<ViewDef['chart']>, size: { width: number; height: number }): { error: string } | ChartModel {
  const ys = Array.isArray(opts.y) ? opts.y : [opts.y];
  const problem = chartProblem(data, opts);
  if (problem !== null) return { error: problem };
  const xi = data.columns.indexOf(opts.x);
  const plot = { left: MARGIN.left, top: MARGIN.top, width: Math.max(10, size.width - MARGIN.left - MARGIN.right), height: Math.max(10, size.height - MARGIN.top - MARGIN.bottom) };
  const linear = opts.kind !== 'bar' && data.numeric.includes(opts.x);
  const xOf = (r: Cell[]) => r[xi];
  const rows = linear
    ? data.rows.filter((r) => typeof xOf(r) === 'number').sort((a, b) => Number(xOf(a)) - Number(xOf(b)))
    : data.rows;
  const labels = rows.map((r) => formatCell(xOf(r) ?? null));
  const values = ys.flatMap((c) => rows.map((r) => r[data.columns.indexOf(c)])).filter((v): v is number => typeof v === 'number');
  const [lo = 0, hi = 1] = extent(values);
  const fromZero = opts.kind === 'bar' || opts.kind === 'area';
  const [y0, y1] = fromZero ? [Math.min(0, lo), Math.max(0, hi)] : [lo, hi];
  const y = scaleLinear().domain([y0, y1 === y0 ? y0 + 1 : y1]).nice().range([plot.top + plot.height, plot.top]);
  let px: (row: number) => number;
  let bandWidth = 0;
  let xTicks: { label: string; px: number }[];
  if (linear) {
    const xs = rows.map(xOf).filter((v): v is number => typeof v === 'number');
    const [x0 = 0, x1 = 1] = extent(xs);
    const x = scaleLinear().domain([x0, x1 === x0 ? x0 + 1 : x1]).nice().range([plot.left, plot.left + plot.width]);
    px = (row) => x(Number(xOf(rows[row] ?? []) ?? 0));
    // A whole-number x (days, years, counts) has no ticks between its values.
    const whole = xs.every((v) => Number.isInteger(v));
    xTicks = x
      .ticks(8)
      .filter((t) => !whole || Number.isInteger(t))
      .map((t) => ({ label: formatCell(t), px: x(t) }));
  } else {
    const x = scaleBand<number>().domain(rows.map((_, i) => i)).range([plot.left, plot.left + plot.width]).padding(0.2);
    bandWidth = x.bandwidth();
    px = (row) => (x(row) ?? 0) + bandWidth / 2;
    const step = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plot.width / LABEL_SPACING))));
    xTicks = labels.map((label, i) => ({ label, px: px(i) })).filter((_, i) => i % step === 0);
  }
  const series = ys.map((c) => {
    const ci = data.columns.indexOf(c);
    return {
      name: c,
      points: rows.map((r, i) => {
        const v = r[ci];
        const yv = typeof v === 'number' ? v : null;
        return { label: labels[i] ?? '', y: yv, px: px(i), py: yv === null ? Number.NaN : y(yv) };
      }),
    };
  });
  return {
    xKind: linear ? 'linear' : 'band',
    xLabels: labels,
    xTicks,
    yTicks: y.ticks(6).map((t) => ({ label: formatCell(t), py: y(t) })),
    series,
    marks: series.reduce((n, s) => n + s.points.length, 0),
    plot,
    bandWidth,
    baseline: y(Math.min(Math.max(0, y.domain()[0] ?? 0), y.domain()[1] ?? 0)),
    dropped: data.rows.length - rows.length,
  };
}

/**
 * Why these columns can't be charted, or null. Every declared series is checked, drawn or not: a view that draws
 * fewer (a bar chart past the palette) checks the full list here first.
 */
export function chartProblem(data: TableData, opts: NonNullable<ViewDef['chart']>): string | null {
  const ys = Array.isArray(opts.y) ? opts.y : [opts.y];
  for (const c of [opts.x, ...ys]) if (!data.columns.includes(c)) return `the data has no column "${c}"`;
  // With no rows there are no values to judge: the view says the data is empty.
  for (const c of data.rows.length > 0 ? ys : []) {
    const ci = data.columns.indexOf(c);
    if (data.rows.every((r) => r[ci] === null || r[ci] === undefined)) return `column "${c}" has no values, so it can't be charted`;
    if (!data.numeric.includes(c)) return `column "${c}" isn't all numbers, so it can't be charted`;
  }
  return null;
}

const FOCUS_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown']);

/** The row read after a key, from the row read now (null: none yet), or undefined for a key that doesn't move it. */
export function focusStep(focus: number | null, key: string, rows: number): number | undefined {
  if (!FOCUS_KEYS.has(key) || rows === 0) return undefined;
  if (key === 'Home') return 0;
  if (key === 'End') return rows - 1;
  const at = focusAt(focus, rows);
  if (at === null) return 0;
  const page = Math.max(1, Math.round(rows / 10));
  const by = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'PageDown' ? page : -page;
  return Math.min(rows - 1, Math.max(0, at + by));
}

/** The row being read, kept inside the data: a reread can leave fewer rows. */
export function focusAt(focus: number | null, rows: number): number | null {
  return focus === null || rows === 0 ? null : Math.min(focus, rows - 1);
}
