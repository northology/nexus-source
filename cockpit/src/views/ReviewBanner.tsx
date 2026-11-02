import { useState } from 'react';
import type { InventoryItem } from '../../../core/governance/types.ts';
import type { ReviewState } from '../../../core/types.ts';
import { ApiError, type AnswerBody, type Client } from '../api/client.ts';
import { SubmitBar, Tally } from '../components/MarkParts.tsx';
import { ReviewMarks } from '../components/ReviewMarks.tsx';
import type { ReviewDraft } from '../hooks/useReviewDraft.ts';
import { filledNotes, goneRows, REVIEW_LABEL, reviewPhase, unmarked } from '../lib/reviews.ts';
import { formatTime } from '../lib/time.ts';

interface ReviewBannerProps {
  review: ReviewState;
  items: InventoryItem[];
  draft: ReviewDraft;
  client: Client;
  /** Answered, or sent from this tab: RepoView's one value, which also locks the marks in the list and the reader. */
  readOnly: boolean;
  /** The answers are on their way: held in RepoView too, so every mark and note is locked until the send settles. */
  sending: boolean;
  onSending: (sending: boolean) => void;
  /** The answers were accepted. */
  onSent: () => void;
  /** The send was refused because the review already has an answer. */
  onConflict: () => void;
  /** Reads the reviews again, after any send. */
  refresh: () => void;
  zone: string;
}

/**
 * The open review, above every Repo section but Views: what it asks, how many rows wait, the rows whose item left the
 * list, and Submit. The cockpit's one write here is the answers file; the agent makes the changes.
 */
export function ReviewBanner({ review, items, draft, client, readOnly, sending, onSending, onSent, onConflict, refresh, zone }: ReviewBannerProps) {
  const [error, setError] = useState<string | null>(null);
  const phase = reviewPhase(review);
  const rows = review.request.items ?? [];
  const left = unmarked(review, draft.marks);
  const gone = goneRows(review, items);

  async function send(): Promise<void> {
    // From here until it settles nothing can be marked or typed: what shows is what was sent.
    onSending(true);
    setError(null);
    const notes = filledNotes(draft.notes);
    const body: AnswerBody = { marks: draft.marks, ...(Object.keys(notes).length ? { notes } : {}), ...(draft.note.trim() ? { note: draft.note.trim() } : {}) };
    try {
      await client.postReviewAnswers(review.request.name, body);
      // Locks every mark at once, here and in the list, whether or not the next read lands: no second send.
      onSent();
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409;
      setError(conflict ? 'This review was already answered, perhaps in another tab. The recorded answer is shown.' : e instanceof Error ? e.message : String(e));
      if (conflict) onConflict();
    } finally {
      onSending(false);
      refresh();
    }
  }

  return (
    <section className="review-banner" aria-labelledby="review-title" data-state={phase}>
      <h2 id="review-title">{review.request.title}</h2>
      <p>{review.request.why}</p>
      <p className="review-status">
        {review.answers ? (
          <>
            Sent <span data-volatile>{formatTime(review.answers.submitted, zone)}</span>. The agent makes the changes on your next message.
          </>
        ) : readOnly ? (
          'Sent. The agent makes the changes on your next message.'
        ) : sending ? (
          'Sending…'
        ) : left > 0 ? (
          <span className="needs">
            {left} of {rows.length} to mark
          </span>
        ) : (
          'Every row marked; ready to submit'
        )}
      </p>
      {gone.length > 0 && (
        <div className="review-gone">
          <h3>No longer listed</h3>
          <p>These items left the list after the review opened. Mark them anyway: the agent says if there's nothing left to change.</p>
          <ul>
            {gone.map((row) => (
              <li key={row.name}>
                <span className="t">{row.text}</span>
                <ReviewMarks row={row} draft={draft} readOnly={readOnly || sending} saved={review.answers} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <SubmitBar left={<Tally items={rows} marks={draft.marks} labels={REVIEW_LABEL} />} hint={left > 0 ? 'Mark every row to submit' : 'Ready to submit'} note={draft.note} onNote={draft.setPanelNote} disabled={sending}>
          <button type="button" className="btn" disabled={left > 0 || sending} onClick={() => void send()}>
            Submit review
          </button>
        </SubmitBar>
      )}
    </section>
  );
}
