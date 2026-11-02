// The names a decommission uses. See reference/vault.md, "Decommission".

/** The repo's decision and issue logs: one record each, every entry carrying the build it came from. */
export const DECISIONS_LOG = 'docs/governance/decisions.json';
export const ISSUES_LOG = 'docs/governance/issues.json';
export const RULE_NOTES = 'docs/governance/rules';
/** Written by `nexus new` beside the builds; a decommission takes it into the record commit when it isn't committed. */
export const BUILD_ATTRIBUTES = '.build/.gitattributes';

export function decommissionGateName(build: string): string {
  return `decommission-${build}`;
}

const roundOf = (name: string, build: string): number => {
  const m = new RegExp(`^decommission-${build.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-([2-9]|[1-9][0-9]+))?$`).exec(name);
  return m ? Number(m[1] ?? 1) : 0;
};

/** Whether a gate is one of the build's decommission rounds: decommission-<build>, or -2, -3, … once sent back. */
export function isDecommissionGate(name: string, build: string): boolean {
  return roundOf(name, build) > 0;
}

/** The round that counts among the gates opened: the latest, or the first name when none is open yet. */
export function currentDecommissionGate(gates: string[], build: string): string {
  return gates.reduce((best, g) => (roundOf(g, build) > roundOf(best, build) ? g : best), decommissionGateName(build));
}

/** Where a build's documents are archived in the vault. */
export function archiveDir(build: string): string {
  return `docs/superpowers/archive/${build}`;
}

/** The final report as the agent drafts it, relative to the build folder: the decommission gate's document. */
export function reportDraft(build: string): string {
  return `documents/reports/${build} final report.md`;
}

/** Where the final report lands: outside the archive, as the build's record, one per build. */
export function buildRecordPath(build: string): string {
  return `docs/governance/builds/${build}.md`;
}
