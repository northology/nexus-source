import { describe, it, expect } from 'vitest';
import { addEntry, setStatus, readLog, upsertEntry, removeEntry, assertLogName } from '../core/logs.ts';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readSnapshot } from '../core/snapshot.ts';
import { exampleRepo, NOW } from './helpers.ts';

const entry = { name: 'pause-switch', text: 'Per-source pause switch', status: 'exploring', source: 'chat 11:33', time: NOW };

describe('logs', () => {
  it('adds an entry', () => {
    const root = exampleRepo();
    addEntry(root, 'relay-rebuild', 'questions', entry);
    expect(readLog(root, 'relay-rebuild', 'questions').entries.at(-1)).toEqual(entry);
  });
  it('refuses a duplicate name', () => {
    const root = exampleRepo();
    expect(() => addEntry(root, 'relay-rebuild', 'decisions', { ...entry, name: 'auto-retry', status: 'accepted' })).toThrow(/already in the decisions log/);
  });
  it('refuses a status from another log, listing the right ones', () => {
    expect(() => addEntry(exampleRepo(), 'relay-rebuild', 'issues', entry)).toThrow(/open, addressed, closed/);
  });
  it('refuses a coded name', () => {
    expect(() => addEntry(exampleRepo(), 'relay-rebuild', 'questions', { ...entry, name: 'q07' })).toThrow(/not a readable name/);
  });
  it('changes a status', () => {
    const root = exampleRepo();
    expect(setStatus(root, 'relay-rebuild', 'issues', 'range-replay-skip', 'addressed').status).toBe('addressed');
    expect(readLog(root, 'relay-rebuild', 'issues').entries[0]?.status).toBe('addressed');
  });
  it('reports a missing entry', () => {
    expect(() => setStatus(exampleRepo(), 'relay-rebuild', 'issues', 'no-such-issue', 'closed')).toThrow(/No entry "no-such-issue"/);
  });
  it('rejects an unknown log name', () => {
    expect(() => assertLogName('tasks')).toThrow(/decisions, issues, changes, questions, guardrails/);
  });
  it('upserts and removes without touching the input', () => {
    const file = { entries: [entry] };
    const updated = upsertEntry(file, { ...entry, status: 'research' });
    expect(updated.entries).toEqual([{ ...entry, status: 'research' }]);
    expect(file.entries[0]?.status).toBe('exploring');
    expect(removeEntry(updated, 'pause-switch').entries).toEqual([]);
  });
});

describe('guardrails log', () => {
  it('refuses status changes: state comes from gate answers', () => {
    const root = exampleRepo();
    expect(() => setStatus(root, 'relay-rebuild', 'guardrails', 'replay-read-only', 'withdrawn')).toThrow(/gate answers/);
  });
  it('reads a missing guardrails file as empty (builds from before guardrails)', () => {
    const root = exampleRepo();
    rmSync(join(root, '.build', 'relay-rebuild', 'logs', 'guardrails.json'));
    expect(readLog(root, 'relay-rebuild', 'guardrails')).toEqual({ entries: [] });
    const s = readSnapshot(root, 'relay-rebuild');
    expect(s.logs.guardrails).toEqual([]);
    expect(s.problems).toEqual([]);
  });
});
