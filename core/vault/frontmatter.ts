import { parseDocument } from 'yaml';

export interface Frontmatter {
  /** The properties; null when the note has none, or when they can't be read (error says why). */
  data: Record<string, unknown> | null;
  error: string | null;
  /** The body lines after the frontmatter, line endings normalized. */
  body: string[];
  /** The 1-based file line of body[0]. */
  bodyLine: number;
  /** The 1-based file line of each top-level property key. */
  keyLines: Map<string, number>;
}

const KEY = /^([^\s:#-][^:]*?)\s*:/;

/** A note's frontmatter. Never throws: anything unreadable comes back as error. */
export function readFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const keyLines = new Map<string, number>();
  if (lines[0] !== '---') return { data: null, error: null, body: lines, bodyLine: 1, keyLines };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { data: null, error: 'the frontmatter has no closing ---', body: [], bodyLine: lines.length + 1, keyLines };
  const raw = lines.slice(1, end);
  raw.forEach((line, i) => {
    const key = KEY.exec(line)?.[1];
    if (key && !keyLines.has(key)) keyLines.set(key, i + 2);
  });
  const body = lines.slice(end + 1);
  const bodyLine = end + 2;
  const doc = parseDocument(raw.join('\n'));
  if (doc.errors.length > 0) {
    return { data: null, error: (doc.errors[0]?.message ?? 'invalid YAML').split('\n')[0] ?? 'invalid YAML', body, bodyLine, keyLines };
  }
  const value: unknown = doc.toJS();
  if (value === null || value === undefined) return { data: {}, error: null, body, bodyLine, keyLines };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { data: null, error: 'the frontmatter is not a set of properties', body, bodyLine, keyLines };
  }
  return { data: value as Record<string, unknown>, error: null, body, bodyLine, keyLines };
}
