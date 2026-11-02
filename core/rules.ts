import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readConfig } from './config.ts';
import { NexusError } from './errors.ts';
import type { RuleFile } from './types.ts';

const isMarkdownPath = (p: string): boolean => /\.md$/i.test(p);
const resolveRule = (root: string, p: string): string => (isAbsolute(p) ? p : resolve(root, p));

/** A stat that throws (EACCES, ELOOP) reads as missing, the same as ENOENT, so one bad path can't break the snapshot. */
function isFile(file: string): boolean {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

/** `<modified>-<size>` of a file, so a reader can tell it changed; null when it can't be read. */
export function revisionOf(file: string): string | null {
  try {
    const s = statSync(file, { throwIfNoEntry: false });
    return s?.isFile() ? `${s.mtimeMs}-${s.size}` : null;
  } catch {
    return null;
  }
}

/** The static rules files the repo config lists. nexus reads them for the cockpit and never writes them. */
export function ruleFiles(root: string): { rules: RuleFile[]; problem: string | null } {
  const { config, problem } = readConfig(root);
  const rules = config.staticRules.map((path, index): RuleFile => {
    const file = resolveRule(root, path);
    const missing = !isFile(file);
    // The config schema takes only `.md` entries, and readConfig drops a config that breaks it.
    return { index, path, problem: missing ? 'missing' : null, revision: missing ? null : revisionOf(file) };
  });
  return { rules, problem };
}

/** Only files the config lists, by position, and only markdown: the cockpit can't name a path. */
export function ruleText(root: string, index: number): string {
  const path = readConfig(root).config.staticRules[index];
  if (path === undefined || !isMarkdownPath(path)) throw new NexusError('No static rules file at that position', 404);
  const file = resolveRule(root, path);
  if (!isFile(file)) throw new NexusError(`${path} is missing`, 404);
  return readFileSync(file, 'utf8');
}
