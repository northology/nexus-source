import type { InventoryItem } from '../../../core/governance/types.ts';
import type { GateItem, Mark, ReviewState } from '../../../core/types.ts';

/** A review stores the gate's three marks; the Repo view names them for what they do to a file. */
export const REVIEW_MARKS: readonly { mark: Mark; label: string }[] = [
  { mark: 'accepted', label: 'Keep' },
  { mark: 'research', label: 'Adjust' },
  { mark: 'declined', label: 'Remove' },
];
export const REVIEW_LABEL: Record<Mark, string> = { accepted: 'Keep', research: 'Adjust', declined: 'Remove' };

/** open: waiting for the user; answered: sent, waiting for the agent; applied: the agent has run `nexus review apply`. */
export type ReviewPhase = 'open' | 'answered' | 'applied';

export function reviewPhase(r: ReviewState): ReviewPhase {
  if (!r.answers) return 'open';
  return r.read !== null && Date.parse(r.answers.submitted) <= Date.parse(r.read) ? 'applied' : 'answered';
}

/** The review the Repo view shows: the newest open one, else the newest sent but not yet applied. */
export function currentReview(reviews: ReviewState[]): ReviewState | null {
  const newest = [...reviews].sort((a, b) => Date.parse(b.opened) - Date.parse(a.opened));
  return newest.find((r) => reviewPhase(r) === 'open') ?? newest.find((r) => reviewPhase(r) === 'answered') ?? null;
}

export function rowFor(review: ReviewState | null, itemId: string): GateItem | null {
  return review?.request.items?.find((row) => row.item === itemId) ?? null;
}

/** Rows whose item left the inventory after the review opened (a memory pruned, a file deleted). */
export function goneRows(review: ReviewState, items: InventoryItem[]): GateItem[] {
  const ids = new Set(items.map((i) => i.id));
  return (review.request.items ?? []).filter((row) => row.item === undefined || !ids.has(row.item));
}

export function unmarked(review: ReviewState, marks: Record<string, Mark>): number {
  return (review.request.items ?? []).filter((row) => !marks[row.name]).length;
}

/** The user's unsent marks and notes on one review: row marks, row notes, which notes are open, and the panel note. */
export interface DraftState { marks: Record<string, Mark>; notes: Record<string, string>; open: Record<string, boolean>; note: string }
/** One draft per review name, so a second review opening never loses or borrows the first one's marks. */
export type Drafts = Record<string, DraftState>;
type DraftChange = (d: DraftState) => DraftState;

const blankDraft = (): DraftState => ({ marks: {}, notes: {}, open: {}, note: '' });

/** The draft for a review, blank until something is marked; `null` is no review showing. */
export function draftOf(drafts: Drafts, name: string | null): DraftState {
  return name !== null && Object.hasOwn(drafts, name) ? (drafts[name] ?? blankDraft()) : blankDraft();
}

/** The drafts with one review's draft changed; with no review showing there is nothing to change. */
export function changeDraft(drafts: Drafts, name: string | null, change: DraftChange): Drafts {
  return name === null ? drafts : { ...drafts, [name]: change(draftOf(drafts, name)) };
}

export const markRow = (row: string, m: Mark): DraftChange => (d) => ({
  ...d,
  marks: { ...d.marks, [row]: m },
  // Adjust or Remove usually wants a word of why: open its note, never require it.
  open: m !== 'accepted' && !(d.notes[row] ?? '').trim() ? { ...d.open, [row]: true } : d.open,
});
export const noteRow = (row: string, text: string): DraftChange => (d) => ({ ...d, notes: { ...d.notes, [row]: text } });
export const openRowNote = (row: string): DraftChange => (d) => ({ ...d, open: { ...d.open, [row]: true } });
export const panelNote = (text: string): DraftChange => (d) => ({ ...d, note: text });

/** Row notes with words in them, trimmed: an empty note box sends nothing. */
export function filledNotes(notes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(notes)
      .map(([row, text]) => [row, text.trim()] as const)
      .filter(([, text]) => text !== ''),
  );
}
