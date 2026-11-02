import { readBuild } from './build.ts';
import { fenceTracker } from './fences.ts';
import { readLog, upsertEntry, writeLog } from './logs.ts';
import { currentPhase } from './phases.ts';
import type { LogEntry } from './types.ts';

export interface LedgerItem { log: 'decisions' | 'issues'; text: string; where: string | null }

/** One ledger line read as an item, or null when it holds none. */
function itemOf(line: string): LedgerItem | null {
  const body = line.replace(/^[-*]\s*/, '');
  const where = /^(Task \d+|Final):\s*/.exec(body);
  const rest = (where ? body.slice(where[0].length) : body).trimStart();
  const minor = /^minor \(deferred\):\s*(.+)$/.exec(rest);
  if (minor?.[1]) return { log: 'issues', text: minor[1].trim(), where: where?.[1] ?? null };
  const leadingRuling = /^Ruling(?:\s*\([^)]*\))?:\s*/.exec(rest);
  if (leadingRuling) return { log: 'decisions', text: rest.slice(leadingRuling[0].length).trim(), where: where?.[1] ?? null };
  if (/Ruling(?:\s*\([^)]*\))?:/.test(rest)) return { log: 'decisions', text: rest, where: where?.[1] ?? null };
  return null;
}

/**
 * Reads a Superpowers execution ledger (progress.md): `Ruling:` lines and `minor (deferred):` lines, as the
 * subagent-driven-development and executing-plans skills write them. A line indented two or more spaces directly
 * after an item continues it. Tables, headings and code fences are skipped.
 */
export function parseLedger(text: string): LedgerItem[] {
  const out: LedgerItem[] = [];
  const inFence = fenceTracker();
  let last: LedgerItem | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (inFence(raw)) {
      last = null;
      continue;
    }
    const line = raw.trim();
    if (line.startsWith('|') || line.startsWith('#')) {
      last = null;
      continue;
    }
    const item = line ? itemOf(line) : null;
    if (item) {
      out.push(item);
      last = item;
    } else if (last && /^ {2,}\S/.test(raw)) {
      last.text = `${last.text} ${line}`;
    } else last = null;
  }
  return out;
}

/** A readable name from free text: the prefix keeps it valid whatever the text holds. */
export function nameFromText(prefix: string, text: string, taken: Set<string>): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6);
  let base = [prefix, ...words].join('-');
  while (base.length > 56 && base.includes('-')) base = base.slice(0, base.lastIndexOf('-'));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

/** Adds each ruling to decisions and each deferred minor to issues, in the current phase. Text already logged is skipped. */
export function importLedger(root: string, build: string, text: string, now: string, taskFor: (where: string | null) => string | null = () => null): { rulings: number; minors: number; skipped: number } {
  const phase = currentPhase(readBuild(root, build));
  let decisions = readLog(root, build, 'decisions');
  let issues = readLog(root, build, 'issues');
  const taken = new Set([...decisions.entries, ...issues.entries].map((e) => e.name));
  const result = { rulings: 0, minors: 0, skipped: 0 };
  let decisionsModified = false;
  let issuesModified = false;
  for (const item of parseLedger(text)) {
    const isRuling = item.log === 'decisions';
    const file = isRuling ? decisions : issues;
    // Already imported in this phase. The same text recurring in a later phase is that phase's own record; an entry
    // from before phases carries none and counts for every phase, so it isn't imported again.
    if (file.entries.some((e) => e.text === item.text && (e.phase === undefined || e.phase === phase))) {
      result.skipped++;
      continue;
    }
    const prefix = isRuling ? 'ruling' : 'review';
    const name = nameFromText(prefix, item.text, taken);
    taken.add(name);
    const task = taskFor(item.where);
    const entry: LogEntry = { name, text: item.text, status: isRuling ? 'accepted' : 'open', source: item.where ? `${prefix} · ${item.where}` : prefix, time: now, phase, ...(task ? { task } : {}) };
    if (isRuling) {
      decisions = upsertEntry(decisions, entry);
      result.rulings++;
      decisionsModified = true;
    } else {
      issues = upsertEntry(issues, entry);
      result.minors++;
      issuesModified = true;
    }
  }
  if (decisionsModified) writeLog(root, build, 'decisions', decisions);
  if (issuesModified) writeLog(root, build, 'issues', issues);
  return result;
}
