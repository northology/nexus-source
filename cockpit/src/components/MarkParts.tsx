import type { ReactNode } from 'react';
import type { GateItem, Mark } from '../../../core/types.ts';

export const TALLY_LABELS: Record<Mark, string> = { accepted: 'Accepted', research: 'Research', declined: 'Declined' };

/** Counts per mark, then the unmarked rows. A gate keeps its words; a review passes Keep, Adjust and Remove. */
export function Tally({ items, marks, labels = TALLY_LABELS }: { items: GateItem[]; marks: Record<string, Mark>; labels?: Record<Mark, string> }) {
  const c: Record<Mark, number> = { accepted: 0, research: 0, declined: 0 };
  // An accepted retire row retires its guardrail: it counts as a retirement, not as accepted.
  let retired = 0;
  for (const item of items) {
    const m = marks[item.name];
    if (m === 'accepted' && item.retire) retired += 1;
    else if (m) c[m] += 1;
  }
  const unmarked = items.length - c.accepted - c.research - c.declined - retired;
  return (
    <div className="tally">
      <span>
        {labels.accepted} <b className="mono">{c.accepted}</b>
      </span>
      {items.some((i) => i.retire) && (
        <span>
          Retire <b className="mono">{retired}</b>
        </span>
      )}
      <span>
        {labels.research} <b className="mono">{c.research}</b>
      </span>
      <span>
        {labels.declined} <b className="mono">{c.declined}</b>
      </span>
      <span>
        Unmarked <b className="mono">{unmarked}</b>
      </span>
    </div>
  );
}

/** `disabled` locks the note while an answer is on its way; a gate passes none, and its markup is unchanged. */
export function SubmitBar({ left, hint, note, onNote, disabled, children }: { left?: ReactNode; hint: string; note: string; onNote: (v: string) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <div className="submit">
      <div className="submit-left">
        {left}
        <label className="note-field">
          <span>Note to the agent (optional)</span>
          <textarea rows={2} maxLength={2000} value={note} disabled={disabled} onChange={(e) => onNote(e.target.value)} />
        </label>
      </div>
      <div className="send">
        <span className="hint">{hint}</span>
        {children}
      </div>
    </div>
  );
}
