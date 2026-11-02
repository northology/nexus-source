import type { GateAnswers, GateRequest } from './types.ts';

/** Problems with answers that the schema can't see: they must fit their gate. */
export function checkAnswers(request: GateRequest, answers: GateAnswers): string[] {
  const out: string[] = [];
  if (answers.gate !== request.name) out.push(`answers are for gate "${answers.gate}", not "${request.name}"`);
  if (answers.notes && Object.keys(answers.notes).length) {
    if (request.type !== 'mark-list' && request.type !== 'review') out.push('row notes are only for mark-list and review gates');
    else {
      const rows = (request.items ?? []).map((i) => i.name);
      const unknown = Object.keys(answers.notes).filter((n) => !rows.includes(n));
      if (unknown.length) out.push(`notes for rows that are not in the gate: ${unknown.join(', ')}`);
    }
  }
  if (request.type !== 'concept-pick' && (answers.choices !== undefined || answers.none !== undefined)) {
    out.push('choices and none are only for concept-pick gates');
  }
  if (request.type === 'mark-list' || request.type === 'review') {
    const marks = answers.marks;
    if (!marks) return [...out, `a ${request.type} gate needs marks`];
    const names = (request.items ?? []).map((i) => i.name);
    const missing = names.filter((n) => !Object.hasOwn(marks, n));
    const unknown = Object.keys(marks).filter((n) => !names.includes(n));
    if (missing.length) out.push(`every row must be marked; missing: ${missing.join(', ')}`);
    if (unknown.length) out.push(`marks for items that are not in the gate: ${unknown.join(', ')}`);
  } else if (request.type === 'concept-pick') {
    const names = (request.options ?? []).map((o) => o.name);
    const given = [answers.choice !== undefined, answers.choices !== undefined, answers.none === true].filter(Boolean).length;
    if (given !== 1) out.push('a concept-pick gate needs exactly one of a choice, choices to combine, or none');
    else if (answers.choice !== undefined && !names.includes(answers.choice)) out.push(`"${answers.choice}" is not one of the options`);
    else if (answers.choices) {
      const unknown = answers.choices.filter((c) => !names.includes(c));
      if (unknown.length) out.push(`not options in this gate: ${unknown.join(', ')}`);
    } else if (answers.none && !answers.note?.trim()) out.push('"none of these" needs a note saying what was missing');
  } else if (!answers.decision) {
    out.push('an approve gate needs a decision');
  }
  return out;
}
