import type { LogName, Mark } from '../../../core/types.ts';

/**
 * Line-form state: solid = accepted/live, dashed = exploring/pending, half = research, faint + struck = declined
 * or settled. "needs" (signal red) is reserved for things waiting on the user and is never a log status.
 */
export type MarkKind = 'solid' | 'half' | 'dashed' | 'faint' | 'needs';

export interface StatusStyle {
  status: string;
  mark: MarkKind;
  struck: boolean;
  shownByDefault: boolean;
}

const s = (status: string, mark: MarkKind, struck: boolean, shownByDefault: boolean): StatusStyle => ({ status, mark, struck, shownByDefault });

export const LOG_STYLES: Record<LogName, StatusStyle[]> = {
  decisions: [s('accepted', 'solid', false, true), s('declined', 'faint', true, false)],
  issues: [s('open', 'dashed', false, true), s('addressed', 'half', false, false), s('closed', 'faint', false, false)],
  changes: [s('applied', 'solid', false, true), s('reverted', 'faint', true, false)],
  questions: [s('exploring', 'dashed', false, true), s('research', 'half', false, true), s('answered', 'solid', false, false)],
  guardrails: [s('proposed', 'dashed', false, true), s('withdrawn', 'faint', true, false)],
};

export function styleOf(log: LogName, status: string): StatusStyle {
  return LOG_STYLES[log].find((x) => x.status === status) ?? s(status, 'dashed', false, true);
}

export function defaultShown(log: LogName): string[] {
  return LOG_STYLES[log].filter((x) => x.shownByDefault).map((x) => x.status);
}

export const GATE_MARKS: readonly Mark[] = ['accepted', 'research', 'declined'];

/**
 * Whether marking a row opens its note: research and decline usually want a word of why (never required). On a
 * decommission gate a decline only leaves the guardrail with the build, so it doesn't.
 */
export function opensNote(step: string | undefined, mark: Mark): boolean {
  if (mark === 'accepted') return false;
  return !(step === 'decommission' && mark === 'declined');
}

/** The Guardrails view shows each guardrail's derived state, which comes from gate answers. */
export const GUARDRAIL_STYLES: StatusStyle[] = [
  s('accepted', 'solid', false, true),
  s('proposed', 'dashed', false, true),
  s('declined', 'faint', true, false),
  s('withdrawn', 'faint', true, false),
  s('retired', 'faint', true, false),
];
