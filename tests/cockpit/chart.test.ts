import { describe, it, expect } from 'vitest';
import { chartModel, chartProblem, focusAt, focusStep, MAX_SVG_MARKS } from '../../cockpit/src/lib/chart.ts';
import { formatCell } from '../../cockpit/src/lib/table.ts';
import { PALETTE, seriesMarker, seriesStyle } from '../../cockpit/src/renderers/palette.ts';
import { tableFromCsv } from '../../core/views/data.ts';

const LAG = tableFromCsv('day,north,south\n1,4.2,6.1\n2,3.9,5.5\n3,5.1,\n');
const SIZE = { width: 800, height: 400 };

describe('chartModel', () => {
  it('uses a linear x for a numeric column, one series per y column, and leaves empty cells as gaps', () => {
    const m = chartModel(LAG, { kind: 'line', x: 'day', y: ['north', 'south'] }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect(m.xKind).toBe('linear');
    expect(m.series.map((s) => s.name)).toEqual(['north', 'south']);
    expect(m.series[1]?.points[2]?.y).toBeNull();
    expect(m.marks).toBe(6);
    const xs = m.series[0]?.points.map((p) => p.px) ?? [];
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
  });
  it('uses bands for a text x, and for any bar chart', () => {
    const t = tableFromCsv('region,requests\nNorth,412\nSouth,388\n');
    const m = chartModel(t, { kind: 'bar', x: 'region', y: 'requests' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect([m.xKind, m.xLabels, m.bandWidth > 0]).toEqual(['band', ['North', 'South'], true]);
  });
  it('names a missing or non-numeric column', () => {
    expect(chartModel(LAG, { kind: 'line', x: 'week', y: 'north' }, SIZE)).toEqual({ error: 'the data has no column "week"' });
    const t = tableFromCsv('a,b\n1,x\n');
    expect(chartModel(t, { kind: 'line', x: 'a', y: 'b' }, SIZE)).toEqual({ error: 'column "b" isn\'t all numbers, so it can\'t be charted' });
  });
  it('counts marks so a large chart switches to Canvas', () => {
    const rows = Array.from({ length: 600 }, (_, i) => `${i},${i},${i}`).join('\n');
    const m = chartModel(tableFromCsv(`x,a,b\n${rows}\n`), { kind: 'scatter', x: 'x', y: ['a', 'b'] }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect(m.marks).toBe(1200);
    expect(m.marks > MAX_SVG_MARKS).toBe(true);
  });
});

describe('chartModel edges', () => {
  it('orders a linear x by value, so a line never doubles back', () => {
    const m = chartModel(tableFromCsv('day,v\n3,30\n1,10\n2,20\n'), { kind: 'line', x: 'day', y: 'v' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect(m.xLabels).toEqual([1, 2, 3].map(formatCell));
    expect(m.series[0]?.points.map((p) => p.y)).toEqual([10, 20, 30]);
    const xs = m.series[0]?.points.map((p) => p.px) ?? [];
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
  it('ticks a whole-number x only at whole numbers', () => {
    const m = chartModel(tableFromCsv('day,v\n1,1\n2,2\n3,3\n4,4\n5,5\n'), { kind: 'line', x: 'day', y: 'v' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    // Labels read as the table shows numbers, in the runner's locale.
    expect(m.xTicks.map((t) => t.label)).toEqual([1, 2, 3, 4, 5].map(formatCell));
  });
  it('keeps the data order for bands', () => {
    const m = chartModel(tableFromCsv('region,requests\nSouth,1\nNorth,2\n'), { kind: 'bar', x: 'region', y: 'requests' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect(m.xLabels).toEqual(['South', 'North']);
  });
  it('leaves out a row with no x on a linear x, since it has no place', () => {
    const m = chartModel(tableFromCsv('day,v\n1,10\n,20\n3,30\n'), { kind: 'line', x: 'day', y: 'v' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect([m.xLabels, m.series[0]?.points.map((p) => p.y), m.marks]).toEqual([[1, 3].map(formatCell), [10, 30], 2]);
  });
  it('puts the baseline at zero, inside the plot, when values go below it', () => {
    const m = chartModel(tableFromCsv('k,v\na,-5\nb,10\n'), { kind: 'bar', x: 'k', y: 'v' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    const bottom = m.plot.top + m.plot.height;
    expect(m.baseline).toBeGreaterThan(m.plot.top);
    expect(m.baseline).toBeLessThan(bottom);
    const [neg, pos] = m.series[0]?.points ?? [];
    expect(neg?.py).toBeGreaterThan(m.baseline);
    expect(pos?.py).toBeLessThan(m.baseline);
  });
  it('keeps zero in view when every value is below it', () => {
    const m = chartModel(tableFromCsv('k,v\na,-5\nb,-10\n'), { kind: 'bar', x: 'k', y: 'v' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect(m.baseline).toBeCloseTo(m.plot.top);
  });
  it('takes zero into the y range only for bars and areas', () => {
    const t = tableFromCsv('day,v\n1,100\n2,110\n');
    const low = (kind: 'bar' | 'line' | 'area' | 'scatter') => {
      const m = chartModel(t, { kind, x: 'day', y: 'v' }, SIZE);
      if ('error' in m) throw new Error(m.error);
      return m.yTicks[0]?.label;
    };
    expect([low('bar'), low('area'), low('line'), low('scatter')]).toEqual([0, 0, 100, 100].map(formatCell));
  });
  it('counts the rows it leaves out', () => {
    const lin = chartModel(tableFromCsv('day,v\n1,10\n,20\n,25\n3,30\n'), { kind: 'line', x: 'day', y: 'v' }, SIZE);
    const band = chartModel(tableFromCsv('k,v\na,1\n,2\n'), { kind: 'bar', x: 'k', y: 'v' }, SIZE);
    if ('error' in lin || 'error' in band) throw new Error('no model');
    expect([lin.dropped, band.dropped]).toEqual([2, 0]);
  });
  it('says a y column with no values has none, rather than that it isn’t numbers', () => {
    const t = tableFromCsv('a,b\n1,\n2,\n');
    expect(chartModel(t, { kind: 'line', x: 'a', y: 'b' }, SIZE)).toEqual({ error: 'column "b" has no values, so it can\'t be charted' });
  });
  it('checks every declared series on its own, so a view can check the ones it won’t draw', () => {
    const t = tableFromCsv('x,a,b,c\n1,2,,z\n');
    expect(chartProblem(t, { kind: 'bar', x: 'x', y: ['a', 'gg'] })).toBe('the data has no column "gg"');
    expect(chartProblem(t, { kind: 'bar', x: 'x', y: ['a', 'b'] })).toBe('column "b" has no values, so it can\'t be charted');
    expect(chartProblem(t, { kind: 'bar', x: 'x', y: ['a', 'c'] })).toBe('column "c" isn\'t all numbers, so it can\'t be charted');
    expect(chartProblem(t, { kind: 'bar', x: 'x', y: 'a' })).toBeNull();
  });
  it('gives data with no rows an empty model, for the view to say so', () => {
    const m = chartModel(tableFromCsv('day,v\n'), { kind: 'line', x: 'day', y: 'v' }, SIZE);
    if ('error' in m) throw new Error(m.error);
    expect([m.xLabels, m.marks]).toEqual([[], 0]);
  });
  it('thins band labels to about one per 60px of plot', () => {
    const rows = Array.from({ length: 100 }, (_, i) => `s${i},${i}`).join('\n');
    const t = tableFromCsv(`k,v\n${rows}\n`);
    const ticks = (width: number) => {
      const m = chartModel(t, { kind: 'bar', x: 'k', y: 'v' }, { width, height: 400 });
      if ('error' in m) throw new Error(m.error);
      return { n: m.xTicks.length, slots: Math.floor(m.plot.width / 60) };
    };
    const [narrow, wide] = [ticks(400), ticks(1600)];
    expect(narrow.n).toBeLessThanOrEqual(narrow.slots);
    expect(wide.n).toBeLessThanOrEqual(wide.slots);
    expect(wide.n).toBeGreaterThan(narrow.n * 3);
  });
});

describe('reading a chart by keyboard', () => {
  it('steps a row with the arrows, to the ends with Home and End, and a tenth of the rows with the Page keys', () => {
    expect(focusStep(null, 'ArrowRight', 5)).toBe(0);
    expect(focusStep(null, 'ArrowLeft', 5)).toBe(0);
    expect(focusStep(4, 'ArrowRight', 5)).toBe(4);
    expect(focusStep(2, 'ArrowLeft', 5)).toBe(1);
    expect([focusStep(2, 'Home', 5), focusStep(2, 'End', 5)]).toEqual([0, 4]);
    expect([focusStep(0, 'PageDown', 50), focusStep(7, 'PageUp', 50), focusStep(48, 'PageDown', 50)]).toEqual([5, 2, 49]);
    expect(focusStep(null, 'PageDown', 3)).toBe(0);
    expect(focusStep(0, 'Enter', 5)).toBeUndefined();
  });
  it('keeps the read row inside the data when a reread leaves fewer rows', () => {
    expect([focusAt(9, 3), focusAt(null, 3), focusAt(0, 0), focusAt(1, 3)]).toEqual([2, null, null, 1]);
    expect(focusStep(9, 'ArrowLeft', 3)).toBe(1);
  });
});

/** Colour maths for the palette checks: sRGB to CIELAB (D65), and Machado 2009 severity-1 simulation in linear RGB. */
const lin = (hex: string) => (hex.match(/[0-9a-f]{2}/gi) ?? []).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const MACHADO = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const simulate = (m: number[][], c: number[]) => m.map((r) => Math.min(1, Math.max(0, (r[0] ?? 0) * (c[0] ?? 0) + (r[1] ?? 0) * (c[1] ?? 0) + (r[2] ?? 0) * (c[2] ?? 0))));
const lab = ([r = 0, g = 0, b = 0]: number[]) => {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deltaE = (a: number[], b: number[]) => Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

describe('palette', () => {
  const lum = (hex: string) => {
    const c = (hex.match(/[0-9a-f]{2}/gi) ?? []).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
  };
  it('clears 3:1 against the ground and the sheet in both themes', () => {
    for (const c of PALETTE.light) for (const g of ['#F5F5F3', '#FAFAF8']) expect(contrast(c, g), `${c} on ${g}`).toBeGreaterThanOrEqual(3);
    for (const c of PALETTE.dark) for (const g of ['#141414', '#191919']) expect(contrast(c, g), `${c} on ${g}`).toBeGreaterThanOrEqual(3);
  });
  it('keeps every pair apart in normal vision (ΔE ≥ 12) and under deuteranopia and protanopia (ΔE ≥ 8)', () => {
    expect(PALETTE.light.length).toBe(PALETTE.dark.length);
    const views: [string, (c: number[]) => number[], number][] = [
      ['normal', (c) => c, 12],
      ['deuteranopia', (c) => simulate(MACHADO.deuteranopia, c), 8],
      ['protanopia', (c) => simulate(MACHADO.protanopia, c), 8],
    ];
    for (const theme of ['light', 'dark'] as const) {
      const colors: readonly string[] = PALETTE[theme];
      for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
          const [a = '', b = ''] = [colors[i], colors[j]];
          for (const [name, see, min] of views) expect(deltaE(lab(see(lin(a))), lab(see(lin(b)))), `${theme} ${a} / ${b}, ${name}`).toBeGreaterThanOrEqual(min);
        }
      }
    }
  });
  it('repeats colours past the palette with a dash, and a new marker shape each time round', () => {
    const n = PALETTE.dark.length;
    expect(seriesStyle(0, 'light')).toEqual({ color: PALETTE.light[0], dash: null });
    expect(seriesStyle(n, 'dark')).toEqual({ color: PALETTE.dark[0], dash: '6 4' });
    expect([seriesMarker(0), seriesMarker(n - 1), seriesMarker(n), seriesMarker(2 * n)]).toEqual([0, 0, 1, 2]);
  });
});
