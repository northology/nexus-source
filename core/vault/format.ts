import type { VaultReport } from './types.ts';

/** Findings grouped by file (already sorted by checkVault), then notices and a count. */
export function formatReport(r: VaultReport): string[] {
  if (!r.vault) return [...r.notices];
  const lines: string[] = [];
  let current = '';
  for (const f of r.findings) {
    if (f.file !== current) {
      lines.push(f.file);
      current = f.file;
    }
    lines.push(`  ${f.level.padEnd(5)}  ${f.rule}${f.line === undefined ? '' : `  line ${f.line}`}: ${f.message}`);
  }
  const blocks = r.findings.filter((f) => f.level === 'block').length;
  lines.push(...r.notices, `${r.notes} notes checked: ${blocks} blocking, ${r.findings.length - blocks} warnings`);
  return lines;
}

export function exitCode(r: VaultReport): number {
  return r.findings.some((f) => f.level === 'block') ? 1 : 0;
}
