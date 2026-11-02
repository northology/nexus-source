import { join } from 'node:path';
import { cachedText } from '../text-cache.ts';
import { linkProblem } from './env.ts';
import type { InstructionFilesValue, InventoryEnv } from './types.ts';

// Claude Code's "Project instructions" setting (/config): which of CLAUDE.md and AGENTS.md it loads. Its docs: set
// under pluginConfigs["cc-plugin-agents-md@builtin"].options.instructionFiles (agents-md@builtin before v2.1.285, and
// later versions read either), in managed settings, the user's settings or a --settings file; ignored in project and
// local settings files.

export type InstructionFiles = InstructionFilesValue;
export const INSTRUCTION_FILES: readonly InstructionFiles[] = ['claude-md-or-agents-md', 'claude-md-and-agents-md', 'claude-md', 'managed-only'];
export const DEFAULT_INSTRUCTION_FILES: InstructionFiles = 'claude-md-or-agents-md';
export const PLUGIN_IDS = ['cc-plugin-agents-md@builtin', 'agents-md@builtin'] as const;

export const notLoaded = (value: InstructionFiles): string => `not loaded: the project-instructions setting is ${value}`;

/** A settings file's JSON object; null when it is missing, unreadable, not an object, or reached through a refused link from `base`. */
export function readSettingsObject(file: string, base: string): Record<string, unknown> | null {
  if (linkProblem(file, base) !== null) return null;
  try {
    const v: unknown = JSON.parse(cachedText(file));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const objectAt = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** An own key's value (settings files are untrusted JSON: an inherited key such as `constructor` is never read). */
const own = (o: Record<string, unknown> | null, key: string): unknown => (o !== null && Object.hasOwn(o, key) ? o[key] : undefined);

/** The setting's value and the file it came from: managed settings first, then the user's; the default when neither sets it. */
export function instructionFilesSetting(env: InventoryEnv): { value: InstructionFiles; from: string | null } {
  const files: [string, string][] = [
    [join(env.managedDir, 'managed-settings.json'), env.managedDir],
    [join(env.configDir, 'settings.json'), env.configDir],
  ];
  for (const [file, base] of files) {
    const configs = objectAt(own(readSettingsObject(file, base), 'pluginConfigs'));
    for (const id of PLUGIN_IDS) {
      const v = own(objectAt(own(objectAt(own(configs, id)), 'options')), 'instructionFiles');
      if (typeof v === 'string' && (INSTRUCTION_FILES as readonly string[]).includes(v)) return { value: v as InstructionFiles, from: file };
    }
  }
  return { value: DEFAULT_INSTRUCTION_FILES, from: null };
}
