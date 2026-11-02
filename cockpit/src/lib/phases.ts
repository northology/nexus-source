import type { Build } from '../../../core/types.ts';
import type { Route } from './route.ts';

export const ALL_PHASES = 'all';
export interface PhaseInfo { current: string | null; names: string[] }

/** Builds made before phases read as one phase named after the build. */
export function phaseInfo(build: Build | null): PhaseInfo {
  if (!build) return { current: null, names: [] };
  const current = build.phase ?? build.name;
  return { current, names: build.phases?.map((p) => p.name) ?? [current] };
}

/** `phase=all` shows every phase, a known name shows that phase, anything else shows the current one. */
export function selectedPhase(route: Route, info: PhaseInfo): string | null {
  const p = route.params['phase'];
  if (p === ALL_PHASES) return null;
  if (p !== undefined && info.names.includes(p)) return p;
  return info.current;
}

/** Entries from before phases carry none, and show under every phase. */
export function inPhase(phase: string | undefined, selected: string | null): boolean {
  return selected === null || phase === undefined || phase === selected;
}

/**
 * A document belongs to the phase its phase folder names: documents/<kind>/<phase>/…, or <area>/<phase>/… in the
 * other areas. Only that position counts, so a phase named like a kind (specs) doesn't claim documents/specs/.
 * Documents in no phase folder show under every phase.
 */
export function fileInPhase(path: string, selected: string | null, names: string[]): boolean {
  if (selected === null) return true;
  const parts = path.split('/');
  const at = parts[0] === 'documents' ? 2 : 1;
  const folder = parts.length > at + 1 ? parts[at] : undefined;
  return folder === undefined || !names.includes(folder) || folder === selected;
}

/** "phase dashboard · 2 of 3" (just "phase ghost" when the phase is not in the list), or null when the only phase is named after the build and adds nothing. */
export function phaseLabel(info: PhaseInfo, buildName: string): string | null {
  if (!info.current || (info.names.length <= 1 && info.current === buildName)) return null;
  const at = info.names.indexOf(info.current);
  return at < 0 ? `phase ${info.current}` : `phase ${info.current} · ${at + 1} of ${info.names.length}`;
}
