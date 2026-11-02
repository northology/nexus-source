import { describe, it, expect } from 'vitest';
import { isRowArrayJson, MAX_ROWS, parseCsv, ParseError, tableFromCsv, tableFromJson, tableFromText } from '../core/views/data.ts';

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, newlines in quotes, CRLF and a BOM', () => {
    const text = '\uFEFFname,note\r\n"Smith, J","said ""hi"""\r\n"two\nlines",x\r\n';
    expect(parseCsv(text)).toEqual({ columns: ['name', 'note'], rows: [['Smith, J', 'said "hi"'], ['two\nlines', 'x']] });
  });
  it('ignores a trailing blank line and reads an empty file as no columns', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual({ columns: ['a', 'b'], rows: [['1', '2']] });
    expect(parseCsv('')).toEqual({ columns: [], rows: [] });
  });
  it('names the line of a ragged row', () => {
    expect(() => parseCsv('a,b\n1,2\n3\n')).toThrow(new ParseError('line 3 has 1 field; the header has 2'));
    expect(() => parseCsv('a,b\n"open\n')).toThrow(ParseError);
  });
});

describe('tables', () => {
  it('makes a column numeric when every non-empty value is a finite number', () => {
    expect(tableFromCsv('region,requests,code\nA,12,007\nB,,x\nC,3.5,9\n')).toEqual({
      kind: 'table', columns: ['region', 'requests', 'code'], numeric: ['requests'], total: 3,
      rows: [['A', 12, '007'], ['B', null, 'x'], ['C', 3.5, '9']],
    });
  });
  it('reads a JSON array of objects, taking columns in order of appearance', () => {
    expect(tableFromJson('[{"a":1,"b":"x"},{"c":true,"a":2},{"b":null}]')).toEqual({
      kind: 'table', columns: ['a', 'b', 'c'], numeric: ['a'], total: 3,
      rows: [[1, 'x', null], [2, null, 'true'], [null, null, null]],
    });
  });
  it('refuses JSON that is not an array of objects, naming the problem', () => {
    expect(() => tableFromJson('{"a":1}')).toThrow(new ParseError('the JSON is not a list of rows: expected [ { ... }, ... ]'));
    expect(() => tableFromJson('[1,2]')).toThrow(new ParseError('row 1 is not an object'));
    expect(() => tableFromJson('[{"a":')).toThrow(ParseError);
  });
  it('keeps the first 10,000 rows and the total', () => {
    const csv = `n\n${Array.from({ length: MAX_ROWS + 5 }, (_, i) => i).join('\n')}\n`;
    const t = tableFromCsv(csv);
    expect([t.rows.length, t.total]).toEqual([MAX_ROWS, MAX_ROWS + 5]);
  });
  it('picks the parser by extension', () => {
    expect(tableFromText('x.CSV', 'a\n1\n').columns).toEqual(['a']);
    expect(tableFromText('x.json', '[{"a":1}]').columns).toEqual(['a']);
    expect(() => tableFromText('x.txt', '')).toThrow(new ParseError('a table reads .csv or .json, not .txt'));
  });
  it('tells a row-array JSON from other JSON', () => {
    expect([isRowArrayJson('[{"a":1}]'), isRowArrayJson('[]'), isRowArrayJson('{"a":1}'), isRowArrayJson('nope')]).toEqual([true, false, false, false]);
  });
  it('reads a row list with a BOM as rows, as tableFromJson does', () => {
    expect(isRowArrayJson('\uFEFF[{"a":1}]')).toBe(true);
  });
});

describe('review fixes', () => {
  it('maps numeric flags per column index, so repeated and empty headers work', () => {
    expect(tableFromCsv('a,a\nx,1\ny,2\n')).toEqual({ kind: 'table', columns: ['a', 'a'], numeric: ['a'], total: 2, rows: [['x', 1], ['y', 2]] });
    expect(tableFromCsv(',,\n1,x,2\n')).toEqual({ kind: 'table', columns: ['', '', ''], numeric: ['', ''], total: 1, rows: [[1, 'x', 2]] });
  });
  it('reads numbers by a strict decimal grammar', () => {
    const col = (v: string) => tableFromCsv(`n\n${v}\n`);
    expect(col('0x1F').numeric).toEqual([]);
    expect(col('0b11').numeric).toEqual([]);
    expect(col('1_000').numeric).toEqual([]);
    expect(col('-007').numeric).toEqual([]);
    expect(col('1e3').rows).toEqual([[1000]]);
    expect(col('+5').rows).toEqual([[5]]);
    expect(col('.5').rows).toEqual([[0.5]]);
    expect(Object.is(col('-0').rows[0]?.[0], 0)).toBe(true);
  });
  it('reads malformed quotes leniently', () => {
    expect(parseCsv('h1,h2\n"a"b,c\n').rows).toEqual([['ab', 'c']]);
    expect(parseCsv('h1,h2\na"b,c\n').rows).toEqual([['a"b', 'c']]);
  });
  it('stops taking JSON columns after row 100', () => {
    const rows = Array.from({ length: 101 }, (_, i) => (i === 100 ? { a: 1, z: 2 } : { a: 1 }));
    expect(tableFromJson(JSON.stringify(rows)).columns).toEqual(['a']);
  });
  it('treats a whitespace-only cell as empty and a blank line in a one-column CSV as no row', () => {
    expect(tableFromCsv('a,b\nx,   \n').rows).toEqual([['x', null]]);
    expect(parseCsv('a\n1\n\n2\n').rows).toEqual([['1'], ['2']]);
  });
  it('counts a lone CR inside a quoted field as a line', () => {
    expect(() => parseCsv('a,b\n"x\ry",1\n3\n')).toThrow(new ParseError('line 4 has 1 field; the header has 2'));
  });
  it('reads a BOM on JSON, and a JSON column mixing numbers and strings as text', () => {
    expect(tableFromJson('﻿[{"a":1}]').columns).toEqual(['a']);
    expect(tableFromJson('[{"a":1},{"a":"x"}]')).toEqual({ kind: 'table', columns: ['a'], numeric: [], total: 2, rows: [['1'], ['x']] });
  });
});
