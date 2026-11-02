import type { GateAnswers, GateItem } from '../../../core/types.ts';
import type { ReviewDraft } from '../hooks/useReviewDraft.ts';
import { REVIEW_MARKS } from '../lib/reviews.ts';

interface ReviewMarksProps { row: GateItem; draft: ReviewDraft; readOnly: boolean; saved: GateAnswers | null }

/**
 * Keep, Adjust and Remove for one review row, with its note. Once the review is sent, the recorded marks and notes
 * show, read-only; while it is on its way, or sent but not yet read back, the draft's do, as they were sent. The same
 * row can show in the list and the reader at once; both read and write one draft.
 */
export function ReviewMarks({ row, draft, readOnly, saved }: ReviewMarksProps) {
  const mark = (saved?.marks ?? draft.marks)[row.name];
  const savedNote = saved ? saved.notes?.[row.name] : (draft.notes[row.name] ?? '').trim();
  return (
    <div className="review-line">
      <span className="review-acts" role="group" aria-label={`Review: ${row.text}`}>
        {REVIEW_MARKS.map(({ mark: m, label }) => (
          <button key={m} type="button" className="review-act" aria-pressed={mark === m} disabled={readOnly} onClick={() => draft.mark(row.name, m)}>
            {label}
          </button>
        ))}
      </span>
      {readOnly ? (
        savedNote ? <small className="row-note">Note: {savedNote}</small> : null
      ) : draft.open[row.name] ? (
        <textarea className="row-note-field" aria-label={`Note on: ${row.text}`} rows={2} maxLength={2000} value={draft.notes[row.name] ?? ''} onChange={(e) => draft.setNote(row.name, e.target.value)} />
      ) : (
        <button type="button" className="note-link" aria-label={`Add note on: ${row.text}`} onClick={() => draft.openNote(row.name)}>
          add note
        </button>
      )}
    </div>
  );
}
