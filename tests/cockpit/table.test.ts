import { describe, it, expect } from 'vitest';
import { cellFormat, columnIndex, filterRows, formatCell, nthOf, pickColumns, sortRows } from '../../cockpit/src/lib/table.ts';
import type { TableData } from '../../core/views/types.ts';

const rows = [['North', 412], ['south', null], ['East', 97], ['item 10', 5], ['item 9', 6]];

describe('table logic', () => {
  it('sorts numbers numerically and text naturally, with empty cells last both ways', () => {
    expect(sortRows(rows, 1, 'asc').map((r) => r[1])).toEqual([5, 6, 97, 412, null]);
    expect(sortRows(rows, 1, 'desc').map((r) => r[1])).toEqual([412, 97, 6, 5, null]);
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['East', 'item 9', 'item 10', 'North', 'south']);
  });
  it('filters on any cell, ignoring case', () => {
    expect(filterRows(rows, 'NOR')).toEqual([['North', 412]]);
    expect(filterRows(rows, '97')).toEqual([['East', 97]]);
  });
  it('picks and orders the declared columns, naming any the data lacks', () => {
    const data: TableData = { kind: 'table', columns: ['a', 'b', 'c'], numeric: [], rows: [], total: 0 };
    expect(pickColumns(data, ['c', 'a', 'z'])).toEqual({ columns: ['c', 'a'], indexes: [2, 0], missing: ['z'] });
    expect(pickColumns(data, undefined)).toEqual({ columns: ['a', 'b', 'c'], indexes: [0, 1, 2], missing: [] });
  });
});

describe('table logic: sorting edge cases', () => {
  it('keeps data order for ties, in both directions', () => {
    const tied = [['a', 1], ['b', 1], ['c', 0], ['d', 1]];
    expect(sortRows(tied, 1, 'asc').map((r) => r[0])).toEqual(['c', 'a', 'b', 'd']);
    expect(sortRows(tied, 1, 'desc').map((r) => r[0])).toEqual(['a', 'b', 'd', 'c']);
  });
  it('sorts text descending, naturally', () => {
    expect(sortRows(rows, 0, 'desc').map((r) => r[0])).toEqual(['south', 'North', 'item 10', 'item 9', 'East']);
  });
  it('puts empty cells in a text column last both ways', () => {
    const text = [['b'], [null], ['a'], [null], ['c']];
    expect(sortRows(text, 0, 'asc').map((r) => r[0])).toEqual(['a', 'b', 'c', null, null]);
    expect(sortRows(text, 0, 'desc').map((r) => r[0])).toEqual(['c', 'b', 'a', null, null]);
  });
});

describe('table logic: columns by name', () => {
  it('finds the nth column of a name, and which occurrence a column is', () => {
    expect(columnIndex(['id', 'region', 'requests'], 'requests')).toBe(2);
    expect(columnIndex(['a', 'b', 'a'], 'a', 1)).toBe(2);
    expect(columnIndex(['a', 'b', 'a'], 'a', 2)).toBe(-1);
    expect(columnIndex(['a', 'b'], 'z')).toBe(-1);
    expect(nthOf(['a', 'b', 'a'], 2)).toBe(1);
    expect(nthOf(['a', 'b', 'a'], 0)).toBe(0);
  });
  it('maps repeated column names to their own columns', () => {
    const data: TableData = { kind: 'table', columns: ['a', 'b', 'a'], numeric: [], rows: [], total: 0 };
    expect(pickColumns(data, ['a', 'a'])).toEqual({ columns: ['a', 'a'], indexes: [0, 2], missing: [] });
    expect(pickColumns(data, ['b', 'a'])).toEqual({ columns: ['b', 'a'], indexes: [1, 0], missing: [] });
    expect(pickColumns(data, ['a', 'a', 'a'])).toEqual({ columns: ['a', 'a'], indexes: [0, 2], missing: ['a'] });
  });
});

describe('table logic: cells as shown', () => {
  it('shows a number in full, without grouping, in the given locale', () => {
    const en = cellFormat('en-CA');
    expect(en(0.0004)).toBe('0.0004');
    expect(en(51.044731)).toBe('51.044731');
    expect(en(2026)).toBe('2026');
    expect(en(1234567)).toBe('1234567');
    expect(en(0.0000001)).toBe('0.0000001');
    expect(en(null)).toBe('');
    expect(en('North')).toBe('North');
    // The decimal mark is the locale's on purpose; grouping stays off everywhere.
    const de = cellFormat('de-DE');
    expect(de(0.0004)).toBe('0,0004');
    expect(de(1234567)).toBe('1234567');
  });
  it('formats cells in the browser’s own locale by default', () => {
    const own = cellFormat(new Intl.NumberFormat().resolvedOptions().locale);
    for (const v of [0.0004, 51.044731, 2026, 1234567, null, 'North']) expect(formatCell(v)).toBe(own(v));
  });
  it('searches the cells as shown, and only the columns shown', () => {
    const shown = [['tiny', 0.0000001], ['big', 2026]];
    expect(filterRows(shown, formatCell(0.0000001))).toEqual([['tiny', 0.0000001]]);
    expect(filterRows(shown, '1e-7')).toEqual([]);
    expect(filterRows(rows, 'nor', [1])).toEqual([]);
    expect(filterRows(rows, '412', [1])).toEqual([['North', 412]]);
  });
});
