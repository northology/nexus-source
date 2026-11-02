import { useState } from 'react';
import type { Mark, ReviewState } from '../../../core/types.ts';
import { changeDraft, draftOf, markRow, noteRow, openRowNote, panelNote, type Drafts, type DraftState } from '../lib/reviews.ts';

export interface ReviewDraft extends DraftState {
  name: string | null;
  mark(row: string, m: Mark): void;
  setNote(row: string, text: string): void;
  openNote(row: string): void;
  setPanelNote(text: string): void;
}

/**
 * The user's marks and notes on the review that shows, held while they move between Repo sections (RepoView stays
 * mounted in Repo mode). Each review has a draft of its own, by name: if a newer review opens and is then applied,
 * the earlier one's marks and notes come back as they were left, and nothing carries from one review to another.
 */
export function useReviewDraft(review: ReviewState | null): ReviewDraft {
  const name = review?.request.name ?? null;
  const [drafts, setDrafts] = useState<Drafts>({});
  const update = (change: (d: DraftState) => DraftState) => setDrafts((prev) => changeDraft(prev, name, change));
  return {
    ...draftOf(drafts, name),
    name,
    mark: (row, m) => update(markRow(row, m)),
    setNote: (row, text) => update(noteRow(row, text)),
    openNote: (row) => update(openRowNote(row)),
    setPanelNote: (text) => update(panelNote(text)),
  };
}
