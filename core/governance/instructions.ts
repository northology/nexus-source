import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { cachedText } from '../text-cache.ts';
import { fileFacts, fold, foldersAbove } from './env.ts';
import { DEFAULT_INSTRUCTION_FILES, notLoaded, type InstructionFiles } from './settings.ts';
import type { Found, InventoryEnv, InventoryProblem } from './types.ts';

/**
 * With the default project-instructions setting, Claude Code reads an AGENTS.md only when no CLAUDE.md,
 * .claude/CLAUDE.md or CLAUDE.local.md is in the launch folder or above; launched from the repo, that is known here, so
 * an AGENTS.md it won't load says so, and one it will load carries no note.
 */
export const AGENTS_NOTE = "Claude Code doesn't load it here: this repo or a folder above has a CLAUDE.md";
const CLAUDE_FILES = ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')];
const MAX_HOPS = 4;

const lf = (text: string): string => text.replace(/\r\n?/g, '\n');
/** Fenced blocks (fence indented up to 3 spaces); one left open runs to the end of the text. */
function withoutFences(text: string): string {
  const out: string[] = [];
  let open: string | null = null;
  for (const line of text.split('\n')) {
    if (open !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close !== undefined && close[0] === open[0] && close.length >= open.length) open = null;
      continue;
    }
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // A backtick opener with another backtick later on the line is inline code, not a fence (tilde info strings may hold anything).
    if (m?.[1] !== undefined && !(m[1][0] === '`' && (m[2] ?? '').includes('`'))) open = m[1];
    else out.push(line);
  }
  return out.join('\n');
}

/** A note's first `# ` heading outside fenced blocks, else its file name. */
export function titleOf(text: string, file: string): string {
  const body = withoutFences(lf(text).replace(/^---\n[\s\S]*?\n---\n/, ''));
  return /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body)?.[1] ?? basename(file);
}

/** The @path imports in a CLAUDE.md, in order: outside fenced blocks and code spans, never an email. */
export function importsOf(text: string): string[] {
  const plain = withoutFences(lf(text)).replace(/`[^`\n]*`/g, '');
  return [...plain.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[^\s@`]+?)(?=[\s.,;:!?)]*(?:\s|$))/g)].map((m) => m[1] ?? '').filter((p) => p !== '');
}

function readText(file: string): string {
  try {
    return cachedText(file);
  } catch {
    return '';
  }
}

/**
 * Instruction files: CLAUDE.md-type files at the repo, folders above, user and managed level; AGENTS.md; imports.
 * `setting` is Claude Code's project-instructions setting, which decides the notes.
 */
export function instructionItems(root: string, env: InventoryEnv, problems: InventoryProblem[], setting: InstructionFiles = DEFAULT_INSTRUCTION_FILES): Found[] {
  const found: Found[] = [];
  const seen = new Map<string, Found>();
  const texts = new Map<string, string>();
  const agents = new Set<Found>();
  /** True when the file is newly listed, or an AGENTS.md item an import now names (which then takes the importer's loaded state). */
  const add = (file: string, within: string | null, extra: Partial<Found> = {}, guard: string | null = within): boolean => {
    const key = resolve(file);
    const folded = fold(key, env.platform);
    const existing = seen.get(folded);
    if (existing !== undefined) {
      if (extra.source === undefined || !agents.has(existing) || existing.source !== undefined) return false;
      existing.source = extra.source;
      // An import loads it, unless the importer itself isn't loaded (managed-only).
      if (extra.conditional === undefined) delete existing.conditional;
      else existing.conditional = extra.conditional;
      return true;
    }
    const facts = fileFacts(file, within, guard);
    if (facts === null) return false;
    if ('problem' in facts) {
      problems.push({ location: file, message: facts.problem });
      return false;
    }
    const text = readText(file);
    texts.set(folded, text);
    const item: Found = { kind: 'instructions', title: titleOf(text, file), file: key, scope: 'always', ...extra };
    seen.set(folded, item);
    found.push(item);
    return true;
  };
  const off = setting === 'managed-only' ? notLoaded(setting) : null;
  const folders = [root, ...foldersAbove(root, env.ceiling, env.platform)];
  for (const dir of folders) for (const name of CLAUDE_FILES) add(join(dir, name), dir, off ? { conditional: off } : {});
  const inFolders = found.length;
  add(join(env.configDir, 'CLAUDE.md'), env.configDir, off ? { conditional: off } : {});
  add(join(env.managedDir, 'CLAUDE.md'), env.managedDir);
  const claudeFiles = [...found];
  const agentsNote =
    setting === 'claude-md' || setting === 'managed-only' ? notLoaded(setting) : setting === 'claude-md-and-agents-md' ? null : inFolders > 0 ? AGENTS_NOTE : null;
  for (const dir of folders) {
    const before = found.length;
    add(join(dir, 'AGENTS.md'), dir, agentsNote ? { conditional: agentsNote } : {});
    const item = found[before];
    if (found.length > before && item !== undefined) agents.add(item);
  }

  // Imports, breadth first, up to four hops, each file once (the first listing wins). Under managed-only the managed
  // CLAUDE.md is walked on its own first, so a file it imports (within the hops) is listed as loaded even when a repo
  // file imports it too, and names the managed file as its importer. Not covered: a CLAUDE.md-type file the managed one
  // imports is already listed by then and keeps its note.
  const walk = (starts: string[]): void => {
    let frontier = starts;
    for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const from of frontier) {
        for (const p of importsOf(texts.get(fold(from, env.platform)) ?? '')) {
          // The link walk starts at the folder the path is read from (home, the importer's), or for an absolute path at
          // its root after its text is judged, so a network or device path named by an import is never touched.
          const [target, guard] = p.startsWith('~/') ? [join(env.home, p.slice(2)), env.home] : isAbsolute(p) ? [p, null] : [resolve(dirname(from), p), dirname(from)];
          // Under managed-only, what a file that isn't loaded imports isn't loaded either.
          const importer = seen.get(fold(from, env.platform));
          const inherited = off !== null && importer?.conditional === off ? { conditional: off } : {};
          if (add(target, null, { source: from, ...inherited }, guard)) next.push(resolve(target));
        }
      }
      frontier = next;
    }
  };
  const managedKey = fold(resolve(join(env.managedDir, 'CLAUDE.md')), env.platform);
  const managed = off !== null ? claudeFiles.filter((f) => fold(f.file, env.platform) === managedKey) : [];
  walk(managed.map((f) => f.file));
  walk(claudeFiles.filter((f) => !managed.includes(f)).map((f) => f.file));
  return found;
}
