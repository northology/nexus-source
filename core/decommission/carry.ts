import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { NexusError } from '../errors.ts';
import { gitTry } from '../git.ts';
import { LEDGER_DIR, ledgerPlanPaths } from '../progress.ts';
import { readMarker } from '../vault/generated.ts';
import { scanBody } from '../vault/links.ts';
import { filesBelow } from './archive.ts';
import { archiveDir } from './paths.ts';

/** Files larger than this stay where they are: the archive keeps what was written, not what was produced. */
export const CARRY_LIMIT = 5 * 1024 * 1024;
export const SCRATCH = '.scratch';
/** Below the build's archive folder; a leading underscore keeps it from ever being a phase's folder. */
export const CARRIED = '_carried';

export interface Skipped { path: string; why: string }
/** `carried`: the repo paths written into the archive; `sources`: what they were carried from, removed after the commit. */
export interface Carry { carried: string[]; skipped: Skipped[]; sources: string[] }

const readOr = (file: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

/** The run workspaces whose ledger or plan-path marker names a plan inside this build's folder. */
function buildWorkspaces(root: string, build: string): string[] {
  const base = join(root, ...LEDGER_DIR);
  if (!existsSync(base)) return [];
  const prefix = `.build/${build}/`.toLowerCase();
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const marker = readOr(join(base, name, 'plan-path'));
      const plans = ledgerPlanPaths(readOr(join(base, name, 'progress.md')), marker || null, root);
      return plans.some((p) => p.startsWith(prefix));
    })
    .sort();
}

const OWN_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * A carried note as the vault takes it: a report of the build, its own text kept as written below. Its own
 * frontmatter becomes a yaml block, so its properties aren't checked as the vault's. A note the vault check would
 * block whatever its properties is carried as plain text instead. Returns the destination's name and its text.
 */
function carriedNote(text: string, dest: string, build: string): { dest: string; text: string } {
  const own = OWN_FRONTMATTER.exec(text);
  const rest = own ? text.slice(own[0].length) : text;
  // What the vault check would block in any note: a JavaScript query, a note in an assets/ folder, a generated file's copy.
  const blocked = scanBody(rest.split('\n'), 1).jsBlocks.length > 0 || dest.split('/').includes('assets') || readMarker(text) !== null;
  if (blocked) return { dest: `${dest}.txt`, text };
  const yaml = own ? `\`\`\`yaml\n${own[1] ?? ''}\n\`\`\`\n` : '';
  return { dest, text: `---\n${stringify({ class: 'report', component: 'shared', build })}---\n${yaml}${rest}` };
}

/**
 * Copies the build's notes/, the repo's .scratch/ and this build's Superpowers run workspaces into the build's archive
 * folder, so the handoffs and run records agents leave there reach the record instead of being lost with the build
 * folder or an ignored one. A file
 * git would still ignore at its new path (a key file, a dist/ folder) or one over CARRY_LIMIT is left where it is and
 * named. Hidden files are passed over. Nothing is removed here: the sources go once the commit exists.
 */
export function carryScratch(root: string, build: string): Carry {
  const base = `${archiveDir(build)}/${CARRIED}`;
  // `kept`: the build's own notes go with the build folder, which apply removes; only the scratch sources are removed here.
  const jobs: { source: string; dest: string; kept?: true }[] = [];
  const notes = `.build/${build}/notes`;
  for (const rel of filesBelow(join(root, notes))) jobs.push({ source: `${notes}/${rel}`, dest: `${base}/notes/${rel}`, kept: true });
  for (const rel of filesBelow(join(root, SCRATCH))) jobs.push({ source: `${SCRATCH}/${rel}`, dest: `${base}/scratch/${rel}` });
  for (const ws of buildWorkspaces(root, build)) {
    const from = [...LEDGER_DIR, ws].join('/');
    for (const rel of filesBelow(join(root, from))) jobs.push({ source: `${from}/${rel}`, dest: `${base}/superpowers/${ws}/${rel}` });
  }
  const skipped: Skipped[] = [];
  const written = new Map<string, string>();
  const kept = new Set(jobs.filter((j) => j.kept).map((j) => j.source));
  for (const { source, dest } of jobs) {
    const file = join(root, source);
    if (statSync(file).size > CARRY_LIMIT) {
      skipped.push({ path: source, why: `over ${CARRY_LIMIT / 1024 / 1024} MB` });
      continue;
    }
    const note = dest.toLowerCase().endsWith('.md') ? carriedNote(readFileSync(file, 'utf8'), dest, build) : null;
    const to = note?.dest ?? dest;
    mkdirSync(dirname(join(root, to)), { recursive: true });
    if (note) writeFileSync(join(root, to), note.text);
    else copyFileSync(file, join(root, to));
    written.set(to, source);
  }
  if (written.size) {
    // The repo's own ignore rules still hold below the archive: what they match goes back out, and stays at its source.
    const listed = gitTry(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', base], { raw: true });
    if (!listed.ok) throw new NexusError(`git ls-files failed: ${listed.err}`);
    const ignored = listed.out.split('\0').filter(Boolean);
    for (const path of ignored) {
      const source = written.get(path);
      if (source === undefined) continue;
      rmSync(join(root, path), { force: true });
      written.delete(path);
      skipped.push({ path: source, why: 'git ignores it' });
    }
  }
  const carried = [...written.keys()].sort();
  const sources = carried.map((p) => written.get(p) ?? '').filter((s) => s !== '' && !kept.has(s));
  return { carried, skipped: skipped.sort((a, b) => a.path.localeCompare(b.path)), sources };
}

/** Removes the folders below `dir` that are empty, and `dir` itself when `self` is set and it ends up empty. */
function pruneEmpty(dir: string, self: boolean): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) pruneEmpty(join(dir, e.name), true);
  if (self && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
}

/**
 * Removes what was carried once the decommission commit holds it, then the folders that left empty: .scratch/ itself
 * stays, a carried run workspace goes. A file something holds open is left; returns the paths that couldn't go.
 */
export function removeCarried(root: string, sources: string[]): string[] {
  const left: string[] = [];
  for (const source of sources) {
    try {
      rmSync(join(root, source), { force: true });
    } catch {
      left.push(source);
    }
  }
  try {
    pruneEmpty(join(root, SCRATCH), false);
    const workspaces = new Set(sources.filter((s) => !s.startsWith(`${SCRATCH}/`)).map((s) => s.split('/').slice(0, LEDGER_DIR.length + 1).join('/')));
    for (const ws of workspaces) pruneEmpty(join(root, ws), true);
  } catch {
    // an emptied folder something holds open stays for the next clean-up
  }
  return left;
}
