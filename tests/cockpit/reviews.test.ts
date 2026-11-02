import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '../../core/governance/types.ts';
import type { GateRequest } from '../../core/types.ts';
import type { ReviewState } from '../../core/reviews.ts';
import { changeDraft, currentReview, draftOf, filledNotes, goneRows, markRow, noteRow, openRowNote, panelNote, REVIEW_LABEL, REVIEW_MARKS, reviewPhase, rowFor, unmarked, type Drafts } from '../../cockpit/src/lib/reviews.ts';

const request = (name: string, items: { name: string; item: string }[]): GateRequest => ({
  name,
  type: 'review',
  title: `Review ${name}`,
  why: 'Tidy.',
  opened: '2026-10-10T15:00:00Z',
  items: items.map((r) => ({ ...r, text: `Row ${r.name}`, target: `/tmp/${r.name}.md` })),
});
const review = (name: string, opened: string, answers: ReviewState['answers'] = null, read: string | null = null): ReviewState => ({
  request: request(name, [{ name: 'one-row', item: 'aaaaaaaaaaaa' }, { name: 'two-row', item: 'bbbbbbbbbbbb' }]),
  answers,
  opened,
  read,
});
const item = (id: string): InventoryItem =>
  ({ id, kind: 'memory', title: id, location: `memory/${id}.md`, scope: 'on-demand', record: 'outside', size: 10, changed: '2026-10-10T15:00:00Z' }) as InventoryItem;

describe('review marks', () => {
  it('label the three gate marks Keep, Adjust and Remove, in that order', () => {
    expect(REVIEW_MARKS.map((m) => `${m.mark}:${m.label}`)).toEqual(['accepted:Keep', 'research:Adjust', 'declined:Remove']);
    expect(REVIEW_LABEL).toEqual({ accepted: 'Keep', research: 'Adjust', declined: 'Remove' });
  });
});

describe('which review the Repo view shows', () => {
  const sent = { gate: 'older', submitted: '2026-10-10T16:00:00Z', marks: { 'one-row': 'accepted' as const, 'two-row': 'declined' as const } };
  it('reads open, answered and applied as gates do', () => {
    expect(reviewPhase(review('older', '2026-10-10T15:00:00Z'))).toBe('open');
    expect(reviewPhase(review('older', '2026-10-10T15:00:00Z', sent))).toBe('answered');
    expect(reviewPhase(review('older', '2026-10-10T15:00:00Z', sent, '2026-10-10T16:05:00Z'))).toBe('applied');
  });
  it('picks the newest open review, else the newest one sent but not applied, else none', () => {
    const open = review('newer', '2026-10-10T17:00:00Z');
    const answered = review('older', '2026-10-10T15:00:00Z', sent);
    const applied = review('oldest', '2026-10-10T14:00:00Z', { ...sent, gate: 'oldest' }, '2026-10-10T16:10:00Z');
    expect(currentReview([answered, open, applied])?.request.name).toBe('newer');
    expect(currentReview([applied, answered])?.request.name).toBe('older');
    expect(currentReview([applied])).toBeNull();
    expect(currentReview([])).toBeNull();
  });
});

describe('rows and items', () => {
  const r = review('tidy', '2026-10-10T15:00:00Z');
  it('finds the row naming an item, and none for an item the review leaves alone', () => {
    expect(rowFor(r, 'aaaaaaaaaaaa')?.name).toBe('one-row');
    expect(rowFor(r, 'cccccccccccc')).toBeNull();
    expect(rowFor(null, 'aaaaaaaaaaaa')).toBeNull();
  });
  it('lists the rows whose item is no longer in the inventory', () => {
    expect(goneRows(r, [item('aaaaaaaaaaaa'), item('bbbbbbbbbbbb')])).toEqual([]);
    expect(goneRows(r, [item('aaaaaaaaaaaa')]).map((row) => row.name)).toEqual(['two-row']);
  });
  it('counts unmarked rows, and keeps only notes with words in them', () => {
    expect(unmarked(r, {})).toBe(2);
    expect(unmarked(r, { 'one-row': 'research' })).toBe(1);
    expect(filledNotes({ 'one-row': '  shorter  ', 'two-row': '   ' })).toEqual({ 'one-row': 'shorter' });
  });
});

describe('drafts, one per review', () => {
  const BLANK = { marks: {}, notes: {}, open: {}, note: '' };
  it('starts every review blank', () => {
    expect(draftOf({}, 'tidy')).toEqual(BLANK);
    expect(draftOf({}, null)).toEqual(BLANK);
  });
  it('keeps review A’s marks and notes while review B is the one showing, and B starts empty', () => {
    let drafts: Drafts = {};
    drafts = changeDraft(drafts, 'a', markRow('one-row', 'research'));
    drafts = changeDraft(drafts, 'a', noteRow('one-row', 'shorter'));
    drafts = changeDraft(drafts, 'a', panelNote('See the vault first.'));
    // B opens: it is blank, and marking it leaves A alone.
    expect(draftOf(drafts, 'b')).toEqual(BLANK);
    drafts = changeDraft(drafts, 'b', markRow('one-row', 'declined'));
    expect(draftOf(drafts, 'b').marks).toEqual({ 'one-row': 'declined' });
    expect(draftOf(drafts, 'b').notes).toEqual({});
    expect(draftOf(drafts, 'b').note).toBe('');
    // B is applied and A shows again, as it was left.
    expect(draftOf(drafts, 'a')).toEqual({ marks: { 'one-row': 'research' }, notes: { 'one-row': 'shorter' }, open: { 'one-row': true }, note: 'See the vault first.' });
  });
  it('holds nothing while no review shows', () => {
    expect(changeDraft({}, null, markRow('one-row', 'accepted'))).toEqual({});
  });
  it('opens a row’s note on Adjust or Remove unless it already has words, and never on Keep', () => {
    expect(markRow('r', 'accepted')(BLANK).open).toEqual({});
    expect(markRow('r', 'research')(BLANK).open).toEqual({ r: true });
    expect(markRow('r', 'declined')(BLANK).open).toEqual({ r: true });
    expect(markRow('r', 'declined')({ ...BLANK, notes: { r: 'why' } }).open).toEqual({});
    expect(openRowNote('r')(BLANK).open).toEqual({ r: true });
  });
  it('never reads a draft from the object’s own prototype', () => {
    expect(draftOf({}, 'constructor')).toEqual(BLANK);
    expect(draftOf(changeDraft({}, 'constructor', panelNote('x')), 'constructor').note).toBe('x');
  });
});
