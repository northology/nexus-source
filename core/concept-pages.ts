import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { topicOf } from './concept-text.ts';
import { NexusError } from './errors.ts';
import { BUILD_DIR } from './paths.ts';
import type { GateRequest } from './types.ts';

export interface OpenedPage { page: string; title: string; gate: string }

/** Gate requests in a build, read leniently: one odd file must not take the wall down. */
function requests(root: string, build: string): Partial<GateRequest>[] {
  const dir = join(root, BUILD_DIR, build, 'gates');
  if (!existsSync(dir)) return [];
  const out: Partial<GateRequest>[] = [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (e) {
    // The folder itself can't be read: say so, rather than name no pages (which would lower the wall on them).
    throw new NexusError(`Can't read ${dir}: ${(e as Error).message}`);
  }
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.answers.json')) continue;
    try {
      const r: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (typeof r === 'object' && r !== null && !Array.isArray(r)) out.push(r as Partial<GateRequest>);
    } catch {
      // unreadable: names no pages
    }
  }
  return out;
}

/** Concept pages some gate already shows the user. A page is never changed once its round opens. */
export function openedPages(root: string, build: string): OpenedPage[] {
  return requests(root, build).flatMap((r) =>
    (Array.isArray(r.options) ? r.options : [])
      .filter((o) => typeof o?.page === 'string')
      .map((o) => ({ page: o.page, title: String(r.title ?? r.name ?? ''), gate: String(r.name ?? '') })),
  );
}

/** The build's concept topics, sorted. */
export function buildTopics(root: string, build: string): string[] {
  const topics = requests(root, build)
    .filter((r): r is GateRequest => r.type === 'concept-pick' && typeof r.name === 'string')
    .map(topicOf);
  return [...new Set(topics)].sort();
}
