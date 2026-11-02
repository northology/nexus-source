// Table data from CSV and JSON. Pure: no node: imports, so the cockpit parses build files with the same code.
import type { Cell, TableData } from './types.ts';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export const MAX_ROWS = 10_000;
/** The largest data file the cockpit reads: a declared view's, and a build document's table. */
export const DATA_CAP = 5 * 1024 * 1024;

/**
 * RFC 4180 with a header row, read leniently: a quote inside an unquoted field is kept as a character, and text after a
 * closing quote joins the field (`"a"b` reads as `ab`). Blank lines are ignored, so in a one-column file a blank line
 * is no row. A row with a different field count is refused.
 */
export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const s = text.replace(/^\uFEFF/, '');
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  const endRecord = (): void => {
    fields.push(field);
    if (!(fields.length === 1 && fields[0] === '')) records.push({ line: start, fields });
    fields = [];
    field = '';
  };
  while (i < s.length) {
    const c = s[i] ?? '';
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else {
        if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++; // CRLF counts once
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else if (c === '\r' && s[i + 1] === '\n') {
      i++;
      continue;
    } else if (c === '\n' || c === '\r') {
      endRecord();
      line++;
      start = line;
    } else field += c;
    i++;
  }
  if (quoted) throw new ParseError(`line ${start} opens a quote that never closes`);
  if (field !== '' || fields.length > 0) endRecord();
  const [header, ...rest] = records;
  if (!header) return { columns: [], rows: [] };
  for (const r of rest) {
    if (r.fields.length !== header.fields.length) {
      const n = r.fields.length;
      throw new ParseError(`line ${r.line} has ${n} field${n === 1 ? '' : 's'}; the header has ${header.fields.length}`);
    }
  }
  return { columns: header.fields, rows: rest.map((r) => r.fields) };
}

// Plain decimals only (exponents count); hex, binary and separators like 1_000 stay text.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const isNumber = (v: string): boolean => DECIMAL.test(v.trim()) && Number.isFinite(Number(v.trim()));

function toTable(columns: string[], raw: (string | null)[][]): TableData {
  const flags = columns.map((_, c) => {
    const values = raw.map((r) => r[c]).filter((v): v is string => v !== null && v !== undefined && v.trim() !== '');
    // A leading zero (an id like 007) keeps the column text.
    return values.length > 0 && values.every((v) => isNumber(v) && !/^[+-]?0\d/.test(v.trim()));
  });
  const numeric = columns.filter((_, c) => flags[c]);
  const rows: Cell[][] = raw.slice(0, MAX_ROWS).map((r) =>
    columns.map((_, c) => {
      const v = r[c] ?? null;
      if (v === null || v.trim() === '') return null;
      if (!flags[c]) return v;
      const n = Number(v.trim());
      return n === 0 ? 0 : n; // -0 reads as 0
    }),
  );
  return { kind: 'table', columns, numeric, rows, total: raw.length };
}

export function tableFromCsv(text: string): TableData {
  const { columns, rows } = parseCsv(text);
  return toTable(columns, rows);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function tableFromJson(text: string): TableData {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new ParseError(`the JSON can't be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(value)) throw new ParseError('the JSON is not a list of rows: expected [ { ... }, ... ]');
  const columns: string[] = [];
  value.forEach((row, i) => {
    if (!isPlainObject(row)) throw new ParseError(`row ${i + 1} is not an object`);
    if (i < 100) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
  });
  const text_ = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return toTable(columns, (value as Record<string, unknown>[]).map((row) => columns.map((k) => text_(row[k]))));
}

export function tableFromText(path: string, text: string): TableData {
  const ext = (/\.[^./\\]+$/.exec(path)?.[0] ?? '').toLowerCase();
  if (ext === '.csv') return tableFromCsv(text);
  if (ext === '.json') return tableFromJson(text);
  throw new ParseError(`a table reads .csv or .json, not ${ext || 'a file with no extension'}`);
}

/** True for JSON whose top level is a non-empty list of objects: what the Documents section shows as a table. */
export function isRowArrayJson(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
  } catch {
    return false;
  }
}
