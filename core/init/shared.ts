// Add-only edits to the four files a repo may already have (guardrail init-add-only): never change or remove an
// existing line or key. Each returns the whole new text, or why it stops.

export type SharedStatus = 'create' | 'add' | 'present' | 'conflict';
export interface SharedResult { status: SharedStatus; text?: string; reason?: string }

export const BLOCK_START = '<!-- nexus:start -->';
export const BLOCK_END = '<!-- nexus:end -->';
/** Codex's generated rules section, inside the nexus block: docs generate owns what lies between, by its marker. */
export const RULES_START = '<!-- nexus:rules:start -->';
export const RULES_END = '<!-- nexus:rules:end -->';

/** A block with its rules section emptied, so a section docs generate has filled still reads as the same block. */
const withoutSection = (text: string): string => text.replace(/<!-- nexus:rules:start -->[\s\S]*?<!-- nexus:rules:end -->/, `${RULES_START}\n${RULES_END}`);

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');
const withEnd = (text: string, eol: string): string => (text === '' || text.endsWith('\n') ? text : `${text}${eol}`);

/** Lines (.gitignore, .ignore) appended when missing. */
export function addLines(current: string | null, lines: string[]): SharedResult {
  if (current === null) return { status: 'create', text: `${lines.join('\n')}\n` };
  const eol = eolOf(current);
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (!missing.length) return { status: 'present' };
  return { status: 'add', text: `${withEnd(current, eol)}${missing.join(eol)}${eol}` };
}

/** enabledPlugins["nexus@nexus"]: true in .claude/settings.json, keeping every other key, the indentation and a BOM. */
export function addSettings(current: string | null): SharedResult {
  if (current === null) return { status: 'create', text: `${JSON.stringify({ enabledPlugins: { 'nexus@nexus': true } }, null, 2)}\n` };
  const bom = current.startsWith('﻿') ? '﻿' : '';
  const raw = current.slice(bom.length);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'conflict', reason: "isn't valid JSON (comments aren't allowed), so init won't rewrite it; add \"enabledPlugins\": { \"nexus@nexus\": true } by hand" };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { status: 'conflict', reason: "isn't a JSON object" };
  const settings = data as Record<string, unknown>;
  const enabled = settings['enabledPlugins'] ?? {};
  if (typeof enabled !== 'object' || enabled === null || Array.isArray(enabled)) return { status: 'conflict', reason: "enabledPlugins isn't an object" };
  const plugins = enabled as Record<string, unknown>;
  if (plugins['nexus@nexus'] === true) return { status: 'present' };
  if (plugins['nexus@nexus'] !== undefined) {
    return { status: 'conflict', reason: `enabledPlugins["nexus@nexus"] is set to ${JSON.stringify(plugins['nexus@nexus'])}; init won't change it` };
  }
  const at = openings(raw);
  const text = settings['enabledPlugins'] === undefined
    ? insertMember(raw, at.root, '"enabledPlugins": { "nexus@nexus": true }')
    : insertMember(raw, at.enabled, '"nexus@nexus": true');
  return { status: 'add', text: `${bom}${text}` };
}

/** Just after the root object's `{`, and after the `{` of the top-level enabledPlugins (-1 when absent). raw is a JSON object. */
function openings(raw: string): { root: number; enabled: number } {
  let depth = 0;
  let root = -1;
  let enabled = -1;
  let start = -1;
  let inString = false;
  let escaped = false;
  let lastString = '';
  let key = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        inString = false;
        lastString = JSON.parse(raw.slice(start, i + 1)) as string;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      start = i;
    } else if (c === ':' && depth === 1) key = lastString;
    else if (c === ',' && depth === 1) key = '';
    else if (c === '{' || c === '[') {
      depth += 1;
      if (depth === 1) root = i + 1;
      else if (depth === 2 && c === '{' && key === 'enabledPlugins') enabled = i + 1;
    } else if (c === '}' || c === ']') depth -= 1;
  }
  return { root, enabled };
}

/**
 * The member as the object's first, right after its `{`: on a new line with the next member's indentation when the
 * object spans lines, so no existing line changes; inline otherwise. An empty object gets just the member.
 */
function insertMember(raw: string, at: number, member: string): string {
  const after = raw.slice(at);
  const gap = /^\s*/.exec(after)?.[0] ?? '';
  if (after.slice(gap.length).startsWith('}')) return `${raw.slice(0, at)} ${member} ${after.slice(gap.length)}`;
  if (gap.includes('\n')) {
    const eol = eolOf(raw);
    const indent = gap.slice(gap.lastIndexOf('\n') + 1);
    return `${raw.slice(0, at)}${eol}${indent}${member},${after}`;
  }
  return `${raw.slice(0, at)} ${member},${after}`;
}

/** The nexus block in CLAUDE.md, appended after a blank line. A different block already there is a conflict. */
export function addBlock(current: string | null, block: string): SharedResult {
  if (current === null) return { status: 'create', text: block };
  const eol = eolOf(current);
  const start = current.indexOf(BLOCK_START);
  if (start === -1) {
    const body = withEnd(current, eol);
    const gap = body === '' || body.endsWith(`${eol}${eol}`) ? '' : eol;
    return { status: 'add', text: `${body}${gap}${block.replace(/\r?\n/g, eol)}` };
  }
  const end = current.indexOf(BLOCK_END, start);
  if (end === -1) return { status: 'conflict', reason: `has ${BLOCK_START} with no ${BLOCK_END}` };
  const existing = withoutSection(current.slice(start, end + BLOCK_END.length).replace(/\r\n/g, '\n'));
  const wanted = withoutSection(block.replace(/\r\n/g, '\n').trimEnd());
  return existing === wanted ? { status: 'present' } : { status: 'conflict', reason: 'already has a nexus block with other content; init leaves it alone' };
}
