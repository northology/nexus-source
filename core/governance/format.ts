import { SCOPE_ORDER, SCOPE_TITLES } from './types.ts';
import type { Inventory, InventoryItem } from './types.ts';
import { formatSize } from './size.ts';

export { formatSize } from './size.ts';
export { SCOPE_TITLES } from './types.ts';
const RECORD_WORDS = { recorded: 'recorded', generated: 'generated', outside: 'outside', build: 'build' } as const;

function line(i: InventoryItem): string {
  const notes = [
    ...(i.paths ? [`paths ${i.paths.join(', ')}`] : []),
    ...(i.launchedFrom ? [`only when launched from ${i.launchedFrom}`] : []),
    ...(i.conditional ? [i.conditional] : []),
    ...(i.source ? [i.kind === 'generated' ? `generated from ${i.source}` : `imported by ${i.source}`] : []),
  ];
  return `  ${RECORD_WORDS[i.record].padEnd(9)} ${[i.title, i.location, formatSize(i.size), ...notes].join(' · ')}`;
}

/** The inventory with only what is outside the record; problems stay. */
export function outsideOnly(inv: Inventory): Inventory {
  return { ...inv, items: inv.items.filter((i) => i.record === 'outside') };
}

/** The line `governance list` ends with: the project-instructions setting, and where it was read. */
export function formatSetting(setting: NonNullable<Inventory['setting']>): string {
  const where = setting.from ? `from ${setting.from}` : "Claude Code's default; a --settings file given at launch isn't visible here";
  return `Project instructions setting: ${setting.value} (${where})`;
}

/** The inventory as `governance list` prints it: grouped by scope, then a count line. */
export function formatInventory(inv: Inventory, opts: { outside?: boolean } = {}): string[] {
  const items = opts.outside ? outsideOnly(inv).items : inv.items;
  const out: string[] = [];
  for (const scope of SCOPE_ORDER) {
    const group = items.filter((i) => i.scope === scope);
    if (group.length === 0) continue;
    out.push(SCOPE_TITLES[scope], ...group.map(line));
  }
  const n = (r: InventoryItem['record']) => inv.items.filter((i) => i.record === r).length;
  for (const p of inv.problems) out.push(`  problem   ${p.location}: ${p.message}`);
  out.push(`${inv.items.length} standing instructions: ${n('recorded')} recorded, ${n('generated')} generated, ${n('outside')} outside the record, ${n('build')} this build${opts.outside ? ` (showing the ${items.length} outside the record)` : ''}`);
  return out;
}
