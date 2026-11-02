import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { area as d3area, line as d3line, symbol as d3symbol, symbolCross, symbolDiamond, symbolSquare, symbolStar, symbolTriangle, symbolWye } from 'd3-shape';
import type { TableData } from '../../../core/views/types.ts';
import type { ViewDef } from '../../../core/vault/types.ts';
import { chartModel, chartProblem, focusAt, focusStep, MAX_SVG_MARKS, type ChartModel } from '../lib/chart.ts';
import type { Theme } from '../lib/prefs.ts';
import { formatCell } from '../lib/table.ts';
import { PALETTE, seriesMarker, seriesStyle } from './palette.ts';

type Options = NonNullable<ViewDef['chart']>;
type Kind = Options['kind'];
type Point = ChartModel['series'][number]['points'][number];

const HEIGHT = 420;
const KIND_NAME: Record<Kind, string> = { bar: 'Bar', line: 'Line', area: 'Area', scatter: 'Scatter' };
/** Scatter markers past the first time round the palette (the first is a circle of radius 3). */
const SHAPES = [symbolDiamond, symbolSquare, symbolTriangle, symbolCross, symbolStar, symbolWye];
const MARKER_AREA = 40;

/** A scatter series' marker as a path centred on 0,0, or null for the plain circle. d3 makes the path; React draws it. */
function markerPath(i: number): string | null {
  const round = seriesMarker(i);
  if (round === 0) return null;
  return d3symbol(SHAPES[(round - 1) % SHAPES.length] ?? symbolDiamond, MARKER_AREA)() ?? null;
}

/** "a", "a and b", "a, b and c". */
function listOf(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * A chart view. React draws every mark; d3 only does the maths (lib/chart.ts and the path generators). Up to
 * MAX_SVG_MARKS marks are SVG, more go on a Canvas under the same axes. The arrow keys, Home, End and the Page keys
 * read the values at each x into a live readout. Past the palette, lines are dashed and scatter markers change shape;
 * a bar chart draws as many series as there are colours and names the rest. Rows left out are named under the chart.
 */
export function ChartView({ data, options, theme }: { data: TableData; options: Options; theme: Theme }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(900);
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A bar chart draws as many series as the palette has colours.
  const [drawn, hidden] = useMemo(() => {
    const ys = Array.isArray(options.y) ? options.y : [options.y];
    const limit = options.kind === 'bar' ? PALETTE.light.length : ys.length;
    return [{ ...options, y: ys.slice(0, limit) }, ys.slice(limit)] as const;
  }, [options]);
  // Every declared series is checked, drawn or not; only the drawn ones are modelled.
  const model = useMemo(() => {
    const problem = chartProblem(data, options);
    return problem !== null ? { error: problem } : chartModel(data, drawn, { width, height: HEIGHT });
  }, [data, options, drawn, width]);
  const useCanvas = !('error' in model) && model.marks > MAX_SVG_MARKS;
  useEffect(() => {
    if ('error' in model || !useCanvas || !canvas.current) return;
    drawMarks(canvas.current, model, options.kind, theme, width);
  }, [model, useCanvas, options.kind, theme, width]);
  if ('error' in model) return <p className="view-note">This chart can’t be drawn: {model.error}.</p>;
  const rows = model.xLabels.length;
  if (rows === 0) return <p className="view-note">The data has no rows to chart.</p>;
  const at = focusAt(focus, rows);
  const onKey = (e: KeyboardEvent) => {
    const next = focusStep(focus, e.key, rows);
    if (next === undefined) return;
    e.preventDefault();
    setFocus(next);
  };
  const notes: string[] = [];
  if (data.total > data.rows.length) notes.push(`Charts the first ${data.rows.length.toLocaleString()} of ${data.total.toLocaleString()} rows.`);
  if (model.dropped > 0) notes.push(model.dropped === 1 ? `1 row has no ${options.x} and isn’t drawn.` : `${model.dropped.toLocaleString()} rows have no ${options.x} and aren’t drawn.`);
  if (hidden.length > 0) notes.push(`A bar chart shows ${PALETTE.light.length} series at most: ${listOf(hidden)} ${hidden.length === 1 ? 'isn’t' : 'aren’t'} drawn.`);
  const names = model.series.map((s) => s.name);
  const valueAt = (s: ChartModel['series'][number], row: number) => {
    const v = s.points[row]?.y ?? null;
    return v === null ? 'no value' : formatCell(v);
  };
  const readout = at === null ? 'Use the arrow keys to read the values.' : `${options.x} ${model.xLabels[at] ?? ''}: ${model.series.map((s) => `${s.name} ${valueAt(s, at)}`).join(', ')}`;
  const cursor = at === null ? null : model.series[0]?.points[at]?.px;
  return (
    <div className="chart-view" ref={box}>
      <div className="chart-frame" tabIndex={0} role="group" aria-label={`${KIND_NAME[options.kind]} chart of ${names.join(', ')} by ${options.x}`} onKeyDown={onKey}>
        <svg width={width} height={HEIGHT} aria-hidden="true">
          {model.yTicks.map((t) => (
            <g key={t.label} className="tick">
              <line x1={model.plot.left} x2={model.plot.left + model.plot.width} y1={t.py} y2={t.py} />
              <text x={model.plot.left - 8} y={t.py} dy="0.32em" textAnchor="end">
                {t.label}
              </text>
            </g>
          ))}
          {model.xTicks.map((t) => (
            <text key={`${t.label}-${t.px}`} className="xlabel" x={t.px} y={model.plot.top + model.plot.height + 20} textAnchor="middle">
              {t.label}
            </text>
          ))}
          {!useCanvas && model.series.map((s, i) => <Series key={s.name} s={s} i={i} n={model.series.length} kind={options.kind} model={model} theme={theme} />)}
          {cursor !== undefined && cursor !== null && <line className="cursor" x1={cursor} x2={cursor} y1={model.plot.top} y2={model.plot.top + model.plot.height} />}
        </svg>
        {useCanvas && <canvas ref={canvas} className="chart-canvas" aria-hidden="true" />}
      </div>
      {model.series.length > 1 && (
        <ul className="legend">
          {model.series.map((s, i) => {
            const st = seriesStyle(i, theme);
            const marker = markerPath(i);
            return (
              <li key={s.name}>
                <svg width="22" height="10" aria-hidden="true">
                  {options.kind !== 'scatter' ? (
                    <line x1="0" x2="22" y1="5" y2="5" stroke={st.color} strokeWidth="2.5" strokeDasharray={st.dash ?? undefined} />
                  ) : marker === null ? (
                    <circle cx="11" cy="5" r="3" fill={st.color} />
                  ) : (
                    <path className="marker" d={marker} transform="translate(11 5)" fill={st.color} />
                  )}
                </svg>
                {s.name}
              </li>
            );
          })}
        </ul>
      )}
      <p className="chart-readout mono" role="status">
        {readout}
      </p>
      {notes.length > 0 && <p className="view-note">{notes.join(' ')}</p>}
    </div>
  );
}

function Series({ s, i, n, kind, model, theme }: { s: ChartModel['series'][number]; i: number; n: number; kind: Kind; model: ChartModel; theme: Theme }) {
  const st = seriesStyle(i, theme);
  if (kind === 'bar') {
    const w = model.bandWidth / n;
    const base = model.baseline;
    return <g>{s.points.map((p, row) => (p.y === null ? null : <rect key={row} x={p.px - model.bandWidth / 2 + i * w} y={Math.min(p.py, base)} width={Math.max(1, w - 1)} height={Math.abs(base - p.py)} fill={st.color} />))}</g>;
  }
  if (kind === 'scatter') {
    const marker = markerPath(i);
    return (
      <g>
        {s.points.map((p, row) =>
          p.y === null ? null : marker === null ? <circle key={row} cx={p.px} cy={p.py} r={3} fill={st.color} /> : <path key={row} className="marker" d={marker} transform={`translate(${p.px} ${p.py})`} fill={st.color} />,
        )}
      </g>
    );
  }
  const gen = d3line<Point>().defined((p) => p.y !== null).x((p) => p.px).y((p) => p.py);
  const fill = kind === 'area' ? d3area<Point>().defined((p) => p.y !== null).x((p) => p.px).y0(model.baseline).y1((p) => p.py)(s.points) : null;
  return (
    <g>
      {fill && <path d={fill} fill={st.color} fillOpacity={0.18} />}
      <path d={gen(s.points) ?? ''} fill="none" stroke={st.color} strokeWidth={2} strokeDasharray={st.dash ?? undefined} />
    </g>
  );
}

/** The same marks as Series, on a Canvas, for charts too large for SVG. */
function drawMarks(el: HTMLCanvasElement, model: ChartModel, kind: Kind, theme: Theme, width: number): void {
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const ratio = window.devicePixelRatio || 1;
  // Setting the size clears the canvas and resets its transform.
  el.width = width * ratio;
  el.height = HEIGHT * ratio;
  el.style.width = `${width}px`;
  el.style.height = `${HEIGHT}px`;
  ctx.scale(ratio, ratio);
  const n = model.series.length;
  model.series.forEach((s, i) => {
    const st = seriesStyle(i, theme);
    ctx.strokeStyle = st.color;
    ctx.fillStyle = st.color;
    ctx.setLineDash(st.dash ? st.dash.split(' ').map(Number) : []);
    if (kind === 'line' || kind === 'area') {
      const runs: Point[][] = [];
      let run: Point[] = [];
      for (const p of s.points) {
        if (p.y === null) {
          if (run.length > 0) runs.push(run);
          run = [];
        } else run.push(p);
      }
      if (run.length > 0) runs.push(run);
      for (const r of runs) {
        ctx.beginPath();
        r.forEach((p, k) => (k === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py)));
        ctx.lineWidth = 2;
        ctx.stroke();
        const first = r[0];
        const last = r[r.length - 1];
        if (kind === 'area' && first && last) {
          ctx.lineTo(last.px, model.baseline);
          ctx.lineTo(first.px, model.baseline);
          ctx.closePath();
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    } else if (kind === 'bar') {
      const w = model.bandWidth / n;
      for (const p of s.points) if (p.y !== null) ctx.fillRect(p.px - model.bandWidth / 2 + i * w, Math.min(p.py, model.baseline), Math.max(1, w - 1), Math.abs(model.baseline - p.py));
    } else {
      const marker = markerPath(i);
      if (marker === null) {
        ctx.beginPath();
        for (const p of s.points) {
          if (p.y === null) continue;
          ctx.moveTo(p.px + 3, p.py);
          ctx.arc(p.px, p.py, 3, 0, 2 * Math.PI);
        }
        ctx.fill();
      } else {
        const shape = new Path2D(marker);
        for (const p of s.points) {
          if (p.y === null) continue;
          ctx.save();
          ctx.translate(p.px, p.py);
          ctx.fill(shape);
          ctx.restore();
        }
      }
    }
  });
}
