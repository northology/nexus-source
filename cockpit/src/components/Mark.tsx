import type { MarkKind } from '../lib/marks.ts';

/** A status drawn as line form; see lib/marks.ts for which status gets which kind. */
export function Mark({ kind }: { kind: MarkKind }) {
  return (
    <svg className={`mk mk-${kind}`} viewBox="0 0 10 14" aria-hidden="true">
      <line x1="5" y1={kind === 'half' ? 7 : 0} x2="5" y2="14" />
    </svg>
  );
}
