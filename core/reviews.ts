import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { checkAnswers } from './answers.ts';
import { NexusError } from './errors.ts';
import type { GateInput } from './gates.ts';
import { inventoryEnv } from './governance/env.ts';
import { fullInventory, governanceInventory } from './governance/inventory.ts';
import type { Found, InventoryEnv, InventoryItem, InventoryProblem, ItemKind } from './governance/types.ts';
import { assertReadableName, duplicateNames } from './names.ts';
import { REVIEW_INDEX, readReviewIndex, reviewPath, reviewsDir, writeReviewIndex } from './review-files.ts';
import { validate } from './schemas.ts';
import { readJson, writeJson } from './store.ts';
import type { GateAnswers, GateRequest, Mark, ReviewState } from './types.ts';

export { REVIEWS_DIR, reviewPath } from './review-files.ts';
export type { ReviewState } from './types.ts';

/** Kinds a review can change. A generated file changes through its note, a guardrail at a guardrails gate. */
const NOT_REVIEWABLE: Partial<Record<ItemKind, string>> = {
  generated: 'a generated rule file changes through its source note in docs/governance/rules/',
  guardrail: 'a guardrail changes at a guardrails gate in its build',
};

const MEMORY_INDEX = 'MEMORY.md';
/** A review named this would write its request over the index. */
const RESERVED = REVIEW_INDEX.slice(0, -'.json'.length);

function assertNotReserved(name: unknown): void {
  if (name === RESERVED) throw new NexusError(`"${RESERVED}" is reserved for .nexus/reviews/${REVIEW_INDEX}; choose another name`);
}

/** The files a row's mark may change: the item's own, and for a memory file its folder's index, whose line goes with it. */
function filesFor(item: InventoryItem): string[] {
  if (item.kind !== 'memory' || posix.basename(item.location) === MEMORY_INDEX) return [item.location];
  return [item.location, posix.join(posix.dirname(item.location), MEMORY_INDEX)];
}

/** Own keys only: a row named like an object property (constructor) must not read a prototype value. */
function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function readRequest(root: string, name: string): GateRequest {
  assertReadableName(name, 'review name');
  assertNotReserved(name);
  const file = reviewPath(root, name);
  if (!existsSync(file)) throw new NexusError(`No review "${name}" in this repo`, 404);
  const data = readJson(file);
  const errors = validate('gate-request', data);
  if (errors.length) throw new NexusError(`.nexus/reviews/${name}.json is invalid: ${errors.join('; ')}`);
  const request = data as GateRequest;
  if (request.type !== 'review') throw new NexusError(`.nexus/reviews/${name}.json isn't a review`);
  return request;
}

export function openReview(root: string, input: GateInput, now: string, env: InventoryEnv): GateRequest {
  if (input.type !== 'review') throw new NexusError(`A review is a gate of type "review"; a ${input.type} gate opens in a build with \`nexus gate open\`.`);
  assertNotReserved(input.name);
  const request = { ...input, opened: input.opened ?? now } as GateRequest;
  const errors = validate('gate-request', request);
  if (errors.length) throw new NexusError(`Review request is invalid: ${errors.join('; ')}`);
  const dups = duplicateNames(request.items ?? []);
  if (dups.length) throw new NexusError(`Review rows must have unique names; repeated: ${dups.join(', ')}`);
  const items = new Map(fullInventory(root, env).items.map((i) => [i.id, i]));
  for (const row of request.items ?? []) {
    const item = items.get(row.item ?? '');
    if (!item) throw new NexusError(`Row "${row.name}" names no listed item (${row.item ?? 'no id'}). \`nexus governance list --json\` shows each item's id.`);
    const refused = NOT_REVIEWABLE[item.kind];
    if (refused) throw new NexusError(`Row "${row.name}" can't be reviewed: ${refused}.`);
    if (row.target !== item.location) throw new NexusError(`Row "${row.name}": target must be the item's location, ${item.location}`);
  }
  if (existsSync(reviewPath(root, request.name, true))) throw new NexusError(`Review "${request.name}" was already answered. Open a new review with a new name.`, 409);
  if (existsSync(reviewPath(root, request.name))) throw new NexusError(`A review named "${request.name}" is already open in this repo`, 409);
  // Read the index before writing anything, so an index that can't be read refuses the review and changes nothing.
  const index = readReviewIndex(root);
  const dir = reviewsDir(root);
  mkdirSync(dir, { recursive: true });
  // A review can name personal memory files, so the folder stays on this machine.
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '*\n');
  writeJson(reviewPath(root, request.name), request);
  index[request.name] = { opened: request.opened, read: null };
  writeReviewIndex(root, index);
  return request;
}

/**
 * Called by the server only: the one place nexus writes a review's answers. Targets come from a fresh inventory, built
 * on the server's walk below the repo when it passes one (so the request doesn't walk the repo itself).
 */
export function submitReviewAnswers(root: string, name: string, body: unknown, now: string, env: InventoryEnv = inventoryEnv(), walk?: { found: Found[]; problems: InventoryProblem[] }): GateAnswers {
  const request = readRequest(root, name);
  if (existsSync(reviewPath(root, name, true))) throw new NexusError(`Review "${name}" has already been answered`, 409);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new NexusError('Answers must be a JSON object');
  const { log: _log, texts: _texts, permit: _permit, targets: _targets, ...supplied } = body as Record<string, unknown>;
  const answers: Record<string, unknown> = { ...supplied, gate: name, submitted: now };
  answers['texts'] = Object.fromEntries((request.items ?? []).map((i) => [i.name, i.text]));
  const inventory = walk ? governanceInventory(root, env, { subfolders: walk.found, subfolderProblems: walk.problems }) : fullInventory(root, env);
  const items = new Map(inventory.items.map((i) => [i.id, i]));
  const targets: Record<string, string[]> = {};
  for (const row of request.items ?? []) {
    const item = items.get(row.item ?? '');
    if (!item) continue; // gone since it opened: marked, but nothing opens for it
    if (item.location !== row.target) {
      throw new NexusError(`Row "${row.name}"'s target no longer matches its item (${item.location}). Open the review again.`, 409);
    }
    // A kind a review can't change (only an edited request names one): marked, but nothing opens for it.
    if (NOT_REVIEWABLE[item.kind]) continue;
    targets[row.name] = filesFor(item);
  }
  if (Object.keys(targets).length) answers['targets'] = targets;
  const errors = validate('gate-answers', answers);
  if (errors.length) throw new NexusError(`Answers are invalid: ${errors.join('; ')}`);
  const problems = checkAnswers(request, answers as unknown as GateAnswers);
  if (problems.length) throw new NexusError(problems.join('; '));
  writeJson(reviewPath(root, name, true), answers);
  return answers as unknown as GateAnswers;
}

export function readReview(root: string, name: string): ReviewState {
  const request = readRequest(root, name);
  let answers: GateAnswers | null = null;
  const file = reviewPath(root, name, true);
  if (existsSync(file)) {
    const data = readJson(file);
    const errors = validate('gate-answers', data);
    if (errors.length) throw new NexusError(`.nexus/reviews/${name}.answers.json is invalid: ${errors.join('; ')}`);
    answers = data as GateAnswers;
  }
  const entry = own(readReviewIndex(root), name);
  return { request, answers, opened: entry?.opened ?? request.opened, read: entry?.read ?? null };
}

/** Every review in the repo, by name. One that can't be read is a problem naming its file, never a failure. */
export function listReviews(root: string, problems: string[] = []): ReviewState[] {
  const dir = reviewsDir(root);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.answers.json') && f !== 'index.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
  const out: ReviewState[] = [];
  for (const name of names) {
    try {
      out.push(readReview(root, name));
    } catch (e) {
      problems.push(`${name}.json: ${(e as Error).message}`);
    }
  }
  return out;
}

/** The reviews `applyReview` would take: answered, and not applied yet. One that can't be read is left out. */
export function unappliedReviews(root: string): ReviewState[] {
  return listReviews(root).filter((s) => s.answers?.marks !== undefined && s.read === null);
}

/**
 * Marks the review applied once the agent has made its changes: its permits close. Applying twice is refused. `targets`
 * holds each row's file as stamped at submission; a row with none (its item was gone, or not a kind a review can
 * change) has nothing to change.
 */
export function applyReview(root: string, name: string, now: string): { marks: Record<string, Mark>; notes: Record<string, string>; targets: Record<string, string> } {
  const state = readReview(root, name);
  if (!state.answers?.marks) throw new NexusError(`Review "${name}" hasn't been answered yet`, 404);
  if (state.read !== null) throw new NexusError(`Review "${name}" was already applied`, 409);
  const index = readReviewIndex(root);
  index[name] = { opened: state.opened, read: now };
  writeReviewIndex(root, index);
  const targets: Record<string, string> = {};
  for (const row of state.request.items ?? []) {
    const file = own(state.answers.targets, row.name)?.[0];
    if (file) targets[row.name] = file;
  }
  return { marks: state.answers.marks, notes: state.answers.notes ?? {}, targets };
}
