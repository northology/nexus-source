import type { ReactNode } from 'react';
import type { InventoryItem } from '../../../core/governance/types.ts';
import type { ReviewState } from '../../../core/types.ts';
import { SubmitBar, Tally } from '../components/MarkParts.tsx';
import { ReviewMarks } from '../components/ReviewMarks.tsx';
import type { ReviewDraft } from '../hooks/useReviewDraft.ts';
import type { ReviewSubmit } from '../hooks/useReviewSubmit.ts';
import { goneRows, REVIEW_LABEL, reviewPhase, unmarked } from '../lib/reviews.ts';
import { formatTime } from '../lib/time.ts';

interface ReviewBannerProps {
  review: ReviewState;
  items: InventoryItem[];
  draft: ReviewDraft;
  /** Answered, or sent from this tab: RepoView's one value, which also locks the marks in the list and the reader. */
  readOnly: boolean;
  /** The answers are on their way: held in RepoView too, so every mark and note is locked until the send settles. */
  sending: boolean;
  /** RepoView's one send, shared with the Submit at the foot of the cards. */
  submit: ReviewSubmit;
  zone: string;
}

/**
 * The open review, above every Repo section but Views: what it asks, how many rows wait, the rows whose item left the
 * list, and Submit. The cockpit's one write here is the answers file; the agent makes the changes.
 */
export function ReviewBanner({ review, items, draft, readOnly, sending, submit, zone }: ReviewBannerProps) {
  const { send, error } = submit;
  const phase = reviewPhase(review);
  const rows = review.request.items ?? [];
  const left = unmarked(review, draft.marks);
  const gone = goneRows(review, items);

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

/**
 * The Submit at the foot of the review's cards, beside the marks it depends on: the tally, the hint and the same send
 * as the banner's. The note to the agent stays in the banner, so there is one field for it.
 */
export function ReviewSubmitBar({ review, draft, sending, submit }: { review: ReviewState; draft: ReviewDraft; sending: boolean; submit: ReviewSubmit }): ReactNode {
  const rows = review.request.items ?? [];
  const left = unmarked(review, draft.marks);
  return (
    <div className="repo-review-foot submit">
      <div className="submit-left">
        <Tally items={rows} marks={draft.marks} labels={REVIEW_LABEL} />
        {/* Shown here too, beside the Submit that was pressed; the banner's copy is the one announced. */}
        {submit.error && <p className="gate-error">{submit.error}</p>}
      </div>
      <div className="send">
        <span className="hint">{left > 0 ? 'Mark every row to submit' : 'Ready to submit'}</span>
        <button type="button" className="btn" disabled={left > 0 || sending} onClick={() => void submit.send()}>
          Submit review
        </button>
      </div>
    </div>
  );
}
