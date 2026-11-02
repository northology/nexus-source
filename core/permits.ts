import { existsSync, readdirSync } from 'node:fs';
import { checkAnswers } from './answers.ts';
import { readBuild } from './build.ts';
import { NexusError } from './errors.ts';
import { gatePath } from './gates.ts';
import { buildPath, listBuilds } from './paths.ts';
import { validate, type SchemaKind } from './schemas.ts';
import { type ReviewIndex, readReviewIndex, reviewPath, reviewsDir } from './review-files.ts';
import { readJson } from './store.ts';
import type { GateAnswers, GateRequest } from './types.ts';

export const PERMIT_MINUTES = 30;
export interface OpenPermit { build: string; gate: string; target: string; change: string; until: string }

function readValid<T>(file: string, kind: SchemaKind): T | null {
  try {
    const data = readJson(file);
    return validate(kind, data).length ? null : (data as T);
  } catch {
    return null;
  }
}

/**
 * Permits the user approved in the cockpit that are still open: approved permit gates in builds, and answered reviews'
 * Adjust and Remove rows. Each holds while its gate or review is unapplied and the answer is under PERMIT_MINUTES old.
 * The target, the change and the time bound all come from the cockpit-written answers file (the server stamps the
 * permit there at submission), so nothing the agent writes afterwards can widen or redirect them. Anything unreadable
 * grants nothing.
 */
export function openPermits(root: string, now: Date): OpenPermit[] {
  const out: OpenPermit[] = [];
  for (const build of listBuilds(root)) {
    const dir = buildPath(root, build, 'gates');
    if (!existsSync(dir)) continue;
    let reads: Record<string, string | null>;
    try {
      reads = Object.fromEntries(Object.entries(readBuild(root, build).gates).map(([k, v]) => [k, v.read]));
    } catch {
      continue;
    }
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch (e) {
      throw new NexusError(`Can't read ${dir}: ${(e as Error).message}`);
    }
    for (const f of files.filter((n) => n.endsWith('.answers.json'))) {
      const gate = f.slice(0, -'.answers.json'.length);
      const request = readValid<GateRequest>(gatePath(root, build, gate), 'gate-request');
      const answers = readValid<GateAnswers>(gatePath(root, build, gate, true), 'gate-answers');
      if (!request?.permit || !answers?.permit || request.type !== 'approve' || answers.decision !== 'approve') continue;
      if (checkAnswers(request, answers).length) continue;
      const submitted = Date.parse(answers.submitted);
      // A time that isn't real, or is still to come, can't start a 30-minute window.
      if (Number.isNaN(submitted) || submitted > now.getTime()) continue;
      const read = reads[gate] ?? null;
      if (read !== null && Date.parse(read) >= submitted) continue;
      const until = submitted + PERMIT_MINUTES * 60_000;
      if (now.getTime() >= until) continue;
      out.push({ build, gate, target: answers.permit.target, change: answers.permit.change, until: new Date(until).toISOString() });
    }
  }
  out.push(...reviewPermits(root, now));
  return out;
}

/** Own keys only: a row named like an object property (constructor) must not read a prototype value. */
function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * A review's permits: each Adjust (research) or Remove (declined) row's files, as the server stamped them in the
 * answers file, open for PERMIT_MINUTES from submission until `nexus review apply` marks the review read. The request
 * file isn't walled, so nothing is taken from it but the row names checkAnswers matches the marks against.
 */
function reviewPermits(root: string, now: Date): OpenPermit[] {
  const dir = reviewsDir(root);
  if (!existsSync(dir)) return [];
  let index: ReviewIndex;
  try {
    index = readReviewIndex(root);
  } catch {
    return [];
  }
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: OpenPermit[] = [];
  for (const f of files.filter((n) => n.endsWith('.answers.json'))) {
    const name = f.slice(0, -'.answers.json'.length);
    const request = readValid<GateRequest>(reviewPath(root, name), 'gate-request');
    const answers = readValid<GateAnswers>(reviewPath(root, name, true), 'gate-answers');
    if (request?.type !== 'review' || !answers?.marks || !answers.targets) continue;
    if (checkAnswers(request, answers).length) continue;
    const submitted = Date.parse(answers.submitted);
    if (Number.isNaN(submitted) || submitted > now.getTime()) continue;
    // Fail closed: a review the index doesn't list (its entry or the whole index deleted), or one whose read time
    // isn't a time before the answer, grants nothing, so removing the index can't reopen an applied review.
    const entry = own(index, name);
    if (!entry) continue;
    if (entry.read !== null && !(Date.parse(entry.read) < submitted)) continue;
    const until = submitted + PERMIT_MINUTES * 60_000;
    if (now.getTime() >= until) continue;
    for (const row of request.items ?? []) {
      const mark = own(answers.marks, row.name);
      if (mark !== 'research' && mark !== 'declined') continue;
      const change = mark === 'declined' ? `Remove (review "${name}", row ${row.name})` : `Adjust: ${own(answers.notes, row.name) ?? 'see the row'} (review "${name}", row ${row.name})`;
      for (const target of own(answers.targets, row.name) ?? []) out.push({ build: '', gate: `review:${name}`, target, change, until: new Date(until).toISOString() });
    }
  }
  return out;
}
