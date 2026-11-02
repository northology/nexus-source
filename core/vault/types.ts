// The docs vault standard's shared shapes. See reference/vault.md.

export const DIVISIONS = ['dev', 'data', 'governance', 'documentation', 'design', 'superpowers'] as const;
export type Division = (typeof DIVISIONS)[number];

/** The vault contract this nexus checks. A vault's docs/_meta/contract.md names the one it follows. */
export const CONTRACT_VERSION = 3;

export type Level = 'block' | 'warn';

export type RuleId =
  | 'registry-invalid'
  | 'contract-newer'
  | 'contract-older'
  | 'frontmatter-invalid'
  | 'class-missing'
  | 'class-unknown'
  | 'folder-wrong'
  | 'top-level'
  | 'assets-note'
  | 'status-invalid'
  | 'source-missing'
  | 'source-duplicate'
  | 'component-missing'
  | 'component-unknown'
  | 'tag-unregistered'
  | 'property-missing'
  | 'tier-invalid'
  | 'scoped-paths-missing'
  | 'js-query'
  | 'link-unresolved'
  | 'link-short'
  | 'link-malformed'
  | 'property-unknown'
  | 'inline-field'
  | 'supersede-orphan'
  | 'stale-source'
  | 'generated-modified'
  | 'class-file-name'
  | 'archive-build-folder'
  | 'view-invalid'
  | 'view-file-name'
  | 'view-data-missing';

export interface Finding {
  rule: RuleId;
  level: Level;
  /** Repo-relative, forward slashes: docs/... */
  file: string;
  line?: number;
  message: string;
}

export function finding(rule: RuleId, level: Level, file: string, message: string, line?: number): Finding {
  return line === undefined ? { rule, level, file, message } : { rule, level, file, line, message };
}

export interface ClassDef {
  name: string;
  division: Division;
  folder: string;
  produced: 'authored' | 'generated' | 'log';
  thing: boolean;
  statuses: string[];
  archive: string[];
  required: string[];
  optional: string[];
  /** The class note, repo-relative. */
  file: string;
}

export type ViewType = 'table' | 'markdown' | 'chart' | 'gallery';

export interface ViewDef {
  name: string;
  title: string;
  type: ViewType;
  /** Repo-relative, outside docs/. */
  data: string;
  component?: string;
  table?: { columns?: string[]; sort?: { column: string; dir?: 'asc' | 'desc' } };
  chart?: { kind: 'bar' | 'line' | 'area' | 'scatter'; x: string; y: string | string[] };
  /** The note's body, trimmed. */
  description: string;
  /** The view note, repo-relative. */
  file: string;
}

export interface Registry {
  classes: Map<string, ClassDef>;
  tags: Set<string>;
  components: Set<string>;
  views: Map<string, ViewDef>;
  /** null when contract.md is missing or invalid (a registry finding says which). */
  contract: number | null;
}

export interface VaultReport {
  /** false when docs/_meta/classes/ doesn't exist: nothing was checked. */
  vault: boolean;
  notes: number;
  findings: Finding[];
  notices: string[];
}
