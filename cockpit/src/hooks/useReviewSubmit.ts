import { useEffect, useState } from 'react';
import type { ReviewState } from '../../../core/types.ts';
import { ApiError, type AnswerBody, type Client } from '../api/client.ts';
import { filledNotes } from '../lib/reviews.ts';
import type { ReviewDraft } from './useReviewDraft.ts';

export interface ReviewSubmit {
  /** Sends the draft's marks and notes as the review's answers. */
  send(): Promise<void>;
  /** Why the last send failed; cleared by the next send or another review. */
  error: string | null;
}

interface Callbacks {
  onSending: (sending: boolean) => void;
  /** The answers were accepted. */
  onSent: () => void;
  /** The send was refused because the review already has an answer. */
  onConflict: () => void;
  /** Reads the reviews again, after any send. */
  refresh: () => void;
}

/**
 * The open review's one send, shared by the banner's Submit and the one at the foot of its cards, so the two can't
 * drift. The cockpit's one write here is the answers file; the agent makes the changes.
 */
export function useReviewSubmit(review: ReviewState | null, draft: ReviewDraft, client: Client, { onSending, onSent, onConflict, refresh }: Callbacks): ReviewSubmit {
  const [error, setError] = useState<string | null>(null);
  const name = review?.request.name ?? null;
  // One review's error never shows on the next.
  useEffect(() => setError(null), [name]);

  async function send(): Promise<void> {
    if (name === null) return;
    // From here until it settles nothing can be marked or typed: what shows is what was sent.
    onSending(true);
    setError(null);
    const notes = filledNotes(draft.notes);
    const body: AnswerBody = { marks: draft.marks, ...(Object.keys(notes).length ? { notes } : {}), ...(draft.note.trim() ? { note: draft.note.trim() } : {}) };
    try {
      await client.postReviewAnswers(name, body);
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

  return { send, error };
}
