import type { Cell, TableData } from '../../../core/views/types.ts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** At most this many rows are drawn; sorting and search still cover every row. */
export const RENDER_CAP = 1_000;

/** A sort held by column name (and which column of that name), so it stays on its column when columns move. */
export interface ColumnSort { column: string; nth: number; dir: 'asc' | 'desc' }

/**
 * How cells read: a number in full and ungrouped, as in the data (0.0004, 51.044731, 2026), with the locale's decimal
 * mark; text as it is; an empty cell blank. No locale means the browser's own.
 */
export function cellFormat(locale?: string): (v: Cell) => string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 20, useGrouping: false });
  return (v) => (v === null ? '' : typeof v === 'number' ? number.format(v) : v);
}

/** Cells as the cockpit shows them, in the browser's locale. */
export const formatCell = cellFormat();

export function sortRows(rows: Cell[][], index: number, dir: 'asc' | 'desc'): Cell[][] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[index] ?? null;
    const y = b[index] ?? null;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return collator.compare(String(x), String(y)) * sign;
  });
}

/** Rows with a cell, as shown, that holds `q`; only the columns at `indexes` (all, when not given) are searched. */
export function filterRows(rows: Cell[][], q: string, indexes?: number[]): Cell[][] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return rows;
  const holds = (c: Cell | undefined) => c !== undefined && c !== null && formatCell(c).toLowerCase().includes(needle);
  return rows.filter((r) => (indexes ? indexes.some((i) => holds(r[i])) : r.some(holds)));
}

/** The index of the `nth` column (from 0) with this name, or -1. */
export function columnIndex(columns: string[], column: string, nth = 0): number {
  let seen = 0;
  for (let i = 0; i < columns.length; i++) {
    if (columns[i] !== column) continue;
    if (seen === nth) return i;
    seen++;
  }
  return -1;
}

/** Which column of its name the column at `index` is: 0 for the first. */
export function nthOf(columns: string[], index: number): number {
  return columns.slice(0, index).filter((c) => c === columns[index]).length;
}

/** The declared columns in order; a name given twice takes the data's next column of that name. */
export function pickColumns(data: TableData, wanted: string[] | undefined): { columns: string[]; indexes: number[]; missing: string[] } {
  if (!wanted) return { columns: data.columns, indexes: data.columns.map((_, i) => i), missing: [] };
  const columns: string[] = [];
  const indexes: number[] = [];
  const missing: string[] = [];
  const used = new Map<string, number>();
  for (const c of wanted) {
    const nth = used.get(c) ?? 0;
    used.set(c, nth + 1);
    const index = columnIndex(data.columns, c, nth);
    if (index < 0) {
      missing.push(c);
    } else {
      columns.push(c);
      indexes.push(index);
    }
  }
  return { columns, indexes, missing };
}
