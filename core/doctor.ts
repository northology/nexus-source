import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NexusError } from './errors.ts';
import { currentHarness, HARNESS_NAMES, type Harness } from './harness.ts';

/** One version's wording of an anchor; `file` when that version moved it out of the anchor's own file. */
export interface AnchorText { version: string; text: string; file?: string }
/** `text` is one wording, or a list of each Superpowers version's wording when they differ. */
export interface Anchor { file: string; text: string | AnchorText[]; breaks: string }

/** An anchor's wordings; a plain string is one wording with no version. */
export function anchorTexts(a: Anchor): AnchorText[] {
  return typeof a.text === 'string' ? [{ version: '', text: a.text }] : a.text;
}

/** A non-blank string: whitespace alone would match nearly any file. */
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The anchor's alternatives list, or why it isn't one: non-empty, each entry with version and text, no version twice. */
function alternativesProblem(text: unknown): string | null {
  if (!Array.isArray(text)) return 'text must be a string or a list of { version, text }';
  if (text.length === 0) return 'its list of wordings is empty';
  const seen = new Set<string>();
  for (const [i, x] of text.entries()) {
    if (typeof x !== 'object' || x === null) return `wording ${i + 1} must be an object`;
    const o = x as Partial<Record<keyof AnchorText, unknown>>;
    // An empty text would match any file, so it's as good as missing.
    if (!filled(o.version) || !filled(o.text) || (o.file !== undefined && !filled(o.file))) return `wording ${i + 1} needs version and text (and file, if given, is a path)`;
    if (seen.has(o.version)) return `version ${o.version} is listed twice`;
    seen.add(o.version);
  }
  return null;
}

const START = '<!-- anchors:start -->';
const END = '<!-- anchors:end -->';

/** The anchors block of reference/superpowers.md: the one list that both the document and the check use. */
export function anchorsFrom(doc: string): Anchor[] {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error('reference/superpowers.md is missing its anchors block');
  const json = doc.slice(a + START.length, b).replace(/```json|```/g, '').trim();
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error('The anchors block must be a JSON array');
  return data.map((x, i) => {
    if (typeof x !== 'object' || x === null) throw new Error(`anchor ${i + 1} must be an object`);
    const o = x as Partial<Record<keyof Anchor, unknown>>;
    if (typeof o.file !== 'string' || o.text === undefined || (typeof o.text === 'string' && !filled(o.text)) || typeof o.breaks !== 'string') throw new Error('Each anchor needs file, text and breaks');
    if (typeof o.text === 'string') return { file: o.file, text: o.text, breaks: o.breaks };
    const problem = alternativesProblem(o.text);
    if (problem) throw new Error(`Anchor in ${o.file}: ${problem}`);
    return { file: o.file, text: o.text as AnchorText[], breaks: o.breaks };
  });
}

/** The anchors from a reference file on disk. A file that is missing or malformed is reported as a plain error, not a stack trace. */
export function readAnchors(file: string): Anchor[] {
  try {
    return anchorsFrom(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new NexusError(`Could not read the Superpowers anchors from ${file}: ${(e as Error).message}`, 404);
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Where each harness keeps an installed Superpowers, as `doctor superpowers` names it when it finds none. */
export function superpowersWhere(harness: Harness): string {
  if (harness === 'codex') return '$CODEX_HOME/plugins/cache/*/superpowers/ (~/.codex by default)';
  if (harness === 'antigravity') return '~/.gemini/config/plugins/superpowers/';
  return '~/.claude/plugins/cache/*/superpowers/';
}

/**
 * The installed Superpowers the harness loads. Claude Code and Codex keep each version in a plugin cache, by
 * marketplace: the newest wins. Antigravity installs a plugin into one folder, with no version in its path (spiked on
 * agy 1.4.12: ~/.gemini/config/plugins/<name>/).
 */
export function findSuperpowers(home: string, harness: Harness = currentHarness(), env: { codexHome?: string } = {}): string | null {
  if (harness === 'antigravity') {
    const dir = join(home, '.gemini', 'config', 'plugins', 'superpowers');
    return existsSync(dir) ? dir : null;
  }
  const cache = harness === 'codex' ? join(env.codexHome ?? join(home, '.codex'), 'plugins', 'cache') : join(home, '.claude', 'plugins', 'cache');
  if (!existsSync(cache)) return null;
  const found: { dir: string; version: string }[] = [];
  for (const market of readdirSync(cache, { withFileTypes: true })) {
    if (!market.isDirectory()) continue;
    const base = join(cache, market.name, 'superpowers');
    if (!existsSync(base)) continue;
    for (const v of readdirSync(base, { withFileTypes: true })) {
      if (v.isDirectory() && /^\d+(\.\d+)*$/.test(v.name)) found.push({ dir: join(base, v.name), version: v.name });
    }
  }
  found.sort((x, y) => compareVersions(y.version, x.version));
  return found[0]?.dir ?? null;
}

/** Each anchor, whether it's in the installed Superpowers, and which wording matched (null when none did). */
export function checkAnchors(dir: string, anchors: Anchor[]): { anchor: Anchor; ok: boolean; matched: AnchorText | null }[] {
  const read = (rel: string): string | null => {
    const file = join(dir, rel);
    return existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  };
  return anchors.map((anchor) => {
    const matched = anchorTexts(anchor).find((t) => read(t.file ?? anchor.file)?.includes(t.text)) ?? null;
    return { anchor, ok: matched !== null, matched };
  });
}

/**
 * The first line of `doctor guard`: the harness this package was built for and how far its wall holds there
 * (guardrail wall-honest-per-harness; sources in the phase-9 cross-harness research note).
 */
export function wallStrength(harness: Harness): string {
  const name = HARNESS_NAMES[harness];
  if (harness === 'codex') {
    return `Harness: ${name}. The wall is a PreToolUse hook, which Codex calls a guardrail, not an enforcement boundary: until you trust nexus's hooks in /hooks it doesn't run and writes go through. When the hook fails (an error, any exit code, a timeout or unreadable output) the tool call continues, so writes go through then too (codex-cli 0.162.0); nexus refuses only with an explicit deny, the one answer Codex holds to.`;
  }
  if (harness === 'antigravity') {
    return `Harness: ${name}. The wall is a PreToolUse hook. Antigravity's docs say a failing hook is ignored, so writes go through; on agy 1.4.12 a failing hook blocked the write instead, so nexus answers with an explicit deny and relies on neither. If the plugin's hooks don't load, writes go through.`;
  }
  return `Harness: ${name}. The wall is a PreToolUse hook; while a build is in progress, a hook that can't run refuses the write.`;
}
