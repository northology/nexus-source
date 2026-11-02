import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NexusError } from '../errors.ts';
import { readLog } from '../logs.ts';
import { readJson, writeJson } from '../store.ts';
import type { LogEntry } from '../types.ts';
import { DECISIONS_LOG, ISSUES_LOG } from './paths.ts';

type Entry = Record<string, unknown>;

function readEntries(root: string, path: string): Entry[] {
  const file = join(root, path);
  if (!existsSync(file)) return [];
  const data = readJson(file);
  const entries = typeof data === 'object' && data !== null ? (data as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(entries)) throw new NexusError(`${path} isn't a log: it must be { "entries": [...] }`);
  return entries as Entry[];
}

/** Replaces this build's entries in a repo log and keeps every other build's; no file is made for nothing. */
function merge(root: string, path: string, build: string, entries: LogEntry[]): number {
  const others = readEntries(root, path).filter((e) => e['build'] !== build);
  if (!entries.length && !existsSync(join(root, path))) return 0;
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeJson(join(root, path), { entries: [...others, ...entries.map((e) => ({ build, ...e }))] });
  return entries.length;
}

/**
 * Moves the build's record into the repo's: the decisions of note the agent picked (approvals and the rest stay in the
 * build's record) into the decision log, every open issue into the issues log. Run again, it writes the same thing.
 */
export function writeRecords(root: string, build: string, decisions: LogEntry[]): { decisions: number; issues: number } {
  const issues = readLog(root, build, 'issues').entries.filter((e) => e.status === 'open');
  return { decisions: merge(root, DECISIONS_LOG, build, decisions), issues: merge(root, ISSUES_LOG, build, issues) };
}
