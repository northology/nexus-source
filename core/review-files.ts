import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NexusError } from './errors.ts';
import { isReadableName } from './names.ts';
import { readJson, writeJson } from './store.ts';

// Where a repo keeps its reviews, and the index of when each opened and was applied. Kept apart from core/reviews.ts so
// the guard (permits) can read reviews without loading the inventory.

export const REVIEWS_DIR = ['.nexus', 'reviews'] as const;
export const REVIEW_INDEX = 'index.json';
export type ReviewIndex = Record<string, { opened: string; read: string | null }>;

export function reviewsDir(root: string): string {
  return join(root, ...REVIEWS_DIR);
}

/** The nearest folder at or above start that holds .nexus/reviews/, or null: the repo whose reviews a session can reach. */
export function findReviewsRoot(start: string): string | null {
  for (let dir = start; ; ) {
    try {
      if (statSync(reviewsDir(dir)).isDirectory()) return dir;
    } catch {
      // not here: keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function reviewPath(root: string, name: string, answers = false): string {
  return join(reviewsDir(root), `${name}${answers ? '.answers' : ''}.json`);
}

/** The index; {} when it doesn't exist yet. An index that isn't the expected shape is refused, never guessed at. */
export function readReviewIndex(root: string): ReviewIndex {
  const file = join(reviewsDir(root), REVIEW_INDEX);
  if (!existsSync(file)) return {};
  const data = readJson(file);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new NexusError('.nexus/reviews/index.json is invalid: not an object');
  const out: ReviewIndex = {};
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    // A review name is a readable name, so a key like __proto__ is refused rather than set as the index's prototype.
    if (!isReadableName(name)) throw new NexusError(`.nexus/reviews/index.json is invalid: "${name}" is not a review name`);
    const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    const opened = v?.['opened'];
    const read = v?.['read'];
    if (typeof opened !== 'string' || !(typeof read === 'string' || read === null)) throw new NexusError(`.nexus/reviews/index.json is invalid at "${name}"`);
    out[name] = { opened, read };
  }
  return out;
}

export function writeReviewIndex(root: string, index: ReviewIndex): void {
  writeJson(join(reviewsDir(root), REVIEW_INDEX), index);
}
