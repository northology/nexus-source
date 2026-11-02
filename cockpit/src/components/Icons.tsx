import type { Mark } from '../../../core/types.ts';

/** The three gate-mark icons, authored for the cockpit (from the approved mockup). */
export function MarkIcon({ kind }: { kind: Mark }) {
  if (kind === 'accepted') {
    return (
      <svg viewBox="0 0 14 14" aria-hidden="true">
        <polyline points="2.5 7.5 5.6 10.5 11.5 3.5" />
      </svg>
    );
  }
  if (kind === 'declined') {
    return (
      <svg viewBox="0 0 14 14" aria-hidden="true">
        <line x1="3" y1="3" x2="11" y2="11" />
        <line x1="11" y1="3" x2="3" y2="11" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M4.6 4.9a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.5" />
      <line x1="7" y1="11.6" x2="7" y2="11.7" />
    </svg>
  );
}
