import { existsSync } from 'node:fs';
import { NexusError } from './errors.ts';
import { assertReadableName, duplicateNames } from './names.ts';
import { buildPath } from './paths.ts';
import { LOG_NAMES, LOG_STATUSES } from './schema-files.ts';
import { validate } from './schemas.ts';
import { readJson, writeJson } from './store.ts';
import type { LogEntry, LogFile, LogName } from './types.ts';

export function assertLogName(value: string): asserts value is LogName {
  if (!LOG_NAMES.includes(value as LogName)) throw new NexusError(`Log must be one of: ${LOG_NAMES.join(', ')}`);
}

export function readLog(root: string, build: string, log: LogName): LogFile {
  const file = buildPath(root, build, 'logs', `${log}.json`);
  // Builds started before guardrails existed have no guardrails.json: that is an empty log, not an error.
  if (log === 'guardrails' && !existsSync(file)) return { entries: [] };
  const data = readJson(file);
  const errors = validate(log, data);
  if (errors.length) throw new NexusError(`logs/${log}.json is invalid: ${errors.join('; ')}`);
  return data as LogFile;
}

export function writeLog(root: string, build: string, log: LogName, file: LogFile): void {
  const errors = validate(log, file);
  const dups = duplicateNames(file.entries);
  if (dups.length) errors.push(`duplicate name "${dups.join('", "')}"`);
  if (errors.length) throw new NexusError(`logs/${log}.json would be invalid: ${errors.join('; ')}`);
  writeJson(buildPath(root, build, 'logs', `${log}.json`), file);
}

export function upsertEntry(file: LogFile, entry: LogEntry): LogFile {
  const entries = [...file.entries];
  const i = entries.findIndex((e) => e.name === entry.name);
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  return { entries };
}

export function removeEntry(file: LogFile, name: string): LogFile {
  return { entries: file.entries.filter((e) => e.name !== name) };
}

function assertStatus(log: LogName, status: string): void {
  if (!LOG_STATUSES[log].includes(status)) {
    throw new NexusError(`Status for the ${log} log must be one of: ${LOG_STATUSES[log].join(', ')}`);
  }
}

export function addEntry(root: string, build: string, log: LogName, entry: LogEntry): void {
  assertLogName(log);
  assertReadableName(entry.name, 'entry name');
  assertStatus(log, entry.status);
  const file = readLog(root, build, log);
  if (file.entries.some((e) => e.name === entry.name)) throw new NexusError(`"${entry.name}" is already in the ${log} log`, 409);
  writeLog(root, build, log, upsertEntry(file, entry));
}

export function setStatus(root: string, build: string, log: LogName, name: string, status: string): LogEntry {
  assertLogName(log);
  if (log === 'guardrails') {
    throw new NexusError('Guardrail state comes from gate answers in the cockpit. To take back a proposal, use `nexus guardrail withdraw <name>`.');
  }
  assertStatus(log, status);
  const file = readLog(root, build, log);
  const entry = file.entries.find((e) => e.name === name);
  if (!entry) throw new NexusError(`No entry "${name}" in the ${log} log`, 404);
  entry.status = status;
  writeLog(root, build, log, file);
  return entry;
}
