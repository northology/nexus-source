// The governance inventory: the standing instructions an agent can load from a repo. What it doesn't list is in
// reference/cockpit.md.

import type { Harness } from '../harness.ts';

export type ItemKind = 'decision' | 'rule' | 'issue' | 'generated' | 'instructions' | 'rule-file' | 'memory' | 'guardrail';
export type LoadScope = 'always' | 'path-scoped' | 'on-demand' | 'build';
export type RecordStatus = 'recorded' | 'generated' | 'outside' | 'build';

export const SCOPE_ORDER: LoadScope[] = ['always', 'path-scoped', 'on-demand', 'build'];
export const SCOPE_TITLES: Record<LoadScope, string> = { always: 'Always loaded', 'path-scoped': 'Path-scoped', 'on-demand': 'On demand', build: 'This build' };

export interface InventoryItem {
  /** First 12 hex of sha256(kind + NUL + location): the only way a caller names an item. */
  id: string;
  kind: ItemKind;
  title: string;
  /** Repo-relative inside the repo, ~/ inside the home folder, absolute (forward slashes) elsewhere. */
  location: string;
  scope: LoadScope;
  paths?: string[];
  /** Set when it loads only in sessions launched from this folder. */
  launchedFrom?: string;
  /** Below the repo root: the folder it sits in, repo-relative. Claude Code loads it when it works there. */
  folder?: string;
  conditional?: string;
  record: RecordStatus;
  /** generated: the note it came from; an imported instruction file: the file that imports it. */
  source?: string;
  size: number;
  changed: string;
}

export interface InventoryProblem { location: string; message: string }

/** Claude Code's project-instructions setting, as core/governance/settings.ts reads it. */
export type InstructionFilesValue = 'claude-md-or-agents-md' | 'claude-md-and-agents-md' | 'claude-md' | 'managed-only';

export interface Inventory {
  root: string;
  vault: boolean;
  items: InventoryItem[];
  problems: InventoryProblem[];
  /** The harness this package was built for: it decides which files are listed. */
  harness: Harness;
  /**
   * Claude Code's project-instructions setting. `from`: the settings file it was read from, as a display path; null for
   * Claude Code's default. The whole setting is null under another harness, which has none.
   */
  setting: { value: InstructionFilesValue; from: string | null } | null;
}

/** NodeJS.Platform, spelled out: this file is shared with the cockpit, which has no Node types. */
export type OsPlatform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';

export interface InventoryEnv {
  home: string;
  /** CLAUDE_CONFIG_DIR, else <home>/.claude. */
  configDir: string;
  /** Where this OS keeps the managed-policy CLAUDE.md. */
  managedDir: string;
  /** The walk above the repo stops before this folder; null walks to the filesystem root. */
  ceiling: string | null;
  /** The OS whose path rules apply (win32 compares paths without letter case). */
  platform: OsPlatform;
  /** CLAUDE_CODE_PROJECT_DIR_NAME: names the repo's folder under <configDir>/projects/ in place of the derived key. */
  projectDirName?: string;
  /** CODEX_HOME: where Codex keeps its global AGENTS.md; unset means <home>/.codex. */
  codexHome?: string;
}

/** What a collector finds, before ids, locations and record status are settled. `file` is absolute. */
export interface Found {
  kind: ItemKind;
  title: string;
  file: string;
  scope: LoadScope;
  paths?: string[];
  launchedFrom?: string;
  /** Subfolder files: the folder they sit in (absolute). */
  folder?: string;
  conditional?: string;
  source?: string;
  /** Guardrails only: the entry name after `#` in the location. */
  anchor?: string;
  /** Guardrails only: the text and time, which live in a log, not a file of their own. */
  text?: string;
  time?: string;
}
