import { describe, it, expect } from 'vitest';
import { checkAnswers } from '../core/answers.ts';
import type { GateRequest } from '../core/types.ts';

const base = { name: 'look', title: 'Pick', why: 'Pick one.', opened: '2026-10-02T12:30:00-06:00' };
const pick: GateRequest = {
  ...base,
  type: 'concept-pick',
  options: ['a', 'b', 'c'].map((n) => ({ name: n, label: n.toUpperCase(), page: `concepts/${n}.html` })),
};
const markList: GateRequest = { ...base, type: 'mark-list', items: [{ name: 'row', text: 'Row' }] };
const ans = (rest: object) => ({ gate: 'look', submitted: '2026-10-02T12:40:00-06:00', ...rest });

describe('checkAnswers on a concept-pick', () => {
  it('accepts a choice, a combine and a noted none', () => {
    expect(checkAnswers(pick, ans({ choice: 'a' }))).toEqual([]);
    expect(checkAnswers(pick, ans({ choices: ['a', 'c'] }))).toEqual([]);
    expect(checkAnswers(pick, ans({ none: true, note: 'too cold' }))).toEqual([]);
  });
  it('names combined options that are not in the gate', () => {
    expect(checkAnswers(pick, ans({ choices: ['a', 'x'] }))).toEqual(['not options in this gate: x']);
  });
  it('needs a note for none', () => {
    const msg = '"none of these" needs a note saying what was missing';
    expect(checkAnswers(pick, ans({ none: true }))).toEqual([msg]);
    expect(checkAnswers(pick, ans({ none: true, note: '   ' }))).toEqual([msg]);
  });
  it('needs exactly one answer', () => {
    const msg = 'a concept-pick gate needs exactly one of a choice, choices to combine, or none';
    expect(checkAnswers(pick, ans({}))).toEqual([msg]);
    expect(checkAnswers(pick, ans({ choice: 'a', none: true, note: 'x' }))).toEqual([msg]);
  });
  it('rejects a choice that is not an option', () => {
    expect(checkAnswers(pick, ans({ choice: 'z' }))).toEqual(['"z" is not one of the options']);
  });
});

describe('checkAnswers on other gates', () => {
  it('refuses choices and none on a mark-list', () => {
    const problems = checkAnswers(markList, ans({ marks: { row: 'accepted' }, choices: ['a', 'b'] }));
    expect(problems).toContain('choices and none are only for concept-pick gates');
  });
  it('needs a mark of its own for a row named like an object property', () => {
    const named = (name: string): GateRequest => ({ ...base, type: 'mark-list', items: [{ name, text: 'Row' }] });
    expect(checkAnswers(named('constructor'), ans({ marks: {} }))).toEqual(['every row must be marked; missing: constructor']);
    expect(checkAnswers(named('toString'), ans({ marks: {} }))).toEqual(['every row must be marked; missing: toString']);
  });
});
