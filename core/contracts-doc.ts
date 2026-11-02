import { LOG_NAMES, LOG_STATUSES, SCHEMA_FILES } from './schema-files.ts';

export const CONTRACTS_START = '<!-- generated:contracts:start -->';
export const CONTRACTS_END = '<!-- generated:contracts:end -->';

interface Prop {
  type?: string | string[];
  enum?: string[];
  const?: unknown;
  $ref?: string;
  anyOf?: Prop[];
  items?: Prop;
  description?: string;
  properties?: Record<string, Prop>;
  required?: string[];
  additionalProperties?: Prop | boolean;
  title?: string;
  definitions?: Record<string, Prop>;
}

/** A definition's name as words: fixRound reads "fix round". */
const words = (name: string): string => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/**
 * A local definition with no properties is a single value, not a record: it reads as its type and its `title`
 * ("commit id"), where one with properties reads "(fields below)".
 */
function definitionType(name: string, defs: Record<string, Prop>): string {
  const def = defs[name];
  if (def && !def.properties) return def.title ? `${String(def.type ?? 'value')} (${def.title})` : String(def.type ?? 'value');
  return `${words(name)} (fields below)`;
}

function typeOf(p: Prop, defs: Record<string, Prop> = {}): string {
  if (p.$ref?.endsWith('/name')) return 'readable name';
  if (p.$ref?.endsWith('/time')) return 'time';
  if (p.enum) return p.enum.map((v) => `\`${v}\``).join(' / ');
  if (p.const !== undefined) return `\`${JSON.stringify(p.const)}\``;
  const named = p.$ref?.match(/^#\/definitions\/(.+)$/)?.[1];
  if (named) return definitionType(named, defs);
  if (p.type === 'null') return 'null';
  if (p.anyOf) return p.anyOf.map((a) => typeOf(a, defs)).join(' or ');
  if (Array.isArray(p.type)) return p.type.join(' or ');
  if (p.type === 'array') {
    const ref = p.items?.$ref?.match(/^#\/definitions\/(.+)$/)?.[1];
    if (ref) return `list of ${definitionType(ref, defs)}`;
    return `list of ${p.items ? typeOf(p.items, defs) : 'values'}`;
  }
  if (p.type === 'object') {
    if (p.properties) return 'object (fields below)';
    if (typeof p.additionalProperties === 'object') return `map of name → ${typeOf(p.additionalProperties, defs)}`;
    return 'object';
  }
  return p.type ?? 'any';
}

/** `defs` is the schema's own definitions: a property that only references one takes the definition's description. */
function table(schema: Prop, defs: Record<string, Prop> = {}): string {
  const required = new Set(schema.required ?? []);
  const described = (p: Prop): string => {
    const named = p.$ref?.match(/^#\/definitions\/(.+)$/)?.[1];
    return p.description ?? (named ? defs[named]?.description : undefined) ?? '';
  };
  const rows = Object.entries(schema.properties ?? {}).map(
    ([key, p]) => `| \`${key}\` | ${typeOf(p, defs)} | ${required.has(key) ? 'yes' : 'no'} | ${described(p)} |`,
  );
  return ['| Field | Type | Required | Notes |', '|---|---|---|---|', ...rows].join('\n');
}

function at<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The schemas are missing ${what}`);
  return value;
}

export function renderContracts(): string {
  const s = SCHEMA_FILES as unknown as Record<string, Prop>;
  const build = at(s['build'], 'build');
  const logEntry = at(s['log-entry'], 'log-entry');
  const plan = at(s['plan'], 'plan');
  const planEntry = at(at(plan.properties?.['plans'], 'plan entries').items, 'plan entry');
  const planTask = at(at(planEntry.properties?.['tasks'], 'plan tasks').items, 'plan task');
  const planRecord = at(plan.definitions?.['record'], 'the plan record');
  const recordTask = at(planRecord.properties?.['tasks']?.additionalProperties, 'record tasks');
  if (typeof recordTask !== 'object') throw new Error('The schemas are missing record tasks');
  const recordFinal = at(planRecord.properties?.['final'], 'the record final counts');
  const fixRound = at(plan.definitions?.['fixRound'], 'the fix round');
  const phases = at(s['phases'], 'phases');
  const plannedPhase = at(at(phases.properties?.['phases'], 'planned phases').items, 'planned phase');
  const request = at(s['gate-request'], 'gate-request');
  const answers = at(s['gate-answers'], 'gate-answers');
  const item = at(at(request.properties?.['items'], 'gate items').items, 'gate item');
  const phaseItem = at(at(build.properties?.['phases'], 'build phases').items, 'phase record');
  const permit = at(request.properties?.['permit'], 'gate permit');
  const config = at(s['config'], 'config');
  const answersSchema = at(s['init-answers'], 'init-answers');
  const answerPermit = at(answers.properties?.['permit'], 'the stamped permit');
  const option = at(at(request.properties?.['options'], 'gate options').items, 'gate option');
  const view = at(s['view'], 'view');
  const viewTable = at(view.properties?.['table'], 'view table options');
  const viewSort = at(viewTable.properties?.['sort'], 'view table sort');
  const viewChart = at(view.properties?.['chart'], 'view chart options');
  return [
    CONTRACTS_START,
    '',
    '## build.json',
    '',
    build.description ?? '',
    '',
    table(build),
    '',
    'Each `gates` entry holds `opened` (time) and `read` (time, or null until `gate apply` runs).',
    '',
    'Each `phases` entry:',
    '',
    table(phaseItem),
    '',
    '## logs/<log>.json',
    '',
    'Each log file is `{ "entries": [ ... ] }`, and every entry has these fields:',
    '',
    table(logEntry),
    '',
    'Statuses per log, for a build\'s own record. A docs vault\'s repo-level statuses are set by its class notes (see vault.md):',
    '',
    '| Log | Statuses |',
    '|---|---|',
    ...LOG_NAMES.map((l) => `| \`${l}\` | ${LOG_STATUSES[l].map((v) => `\`${v}\``).join(' / ')} |`),
    '',
    'Guardrails also require `raisedBy`. Whether one is accepted or declined is never stored: it comes from the answers of gates with `"log": "guardrails"` (see gates.md).',
    '',
    '## gates/<gate>.json (written by the agent)',
    '',
    request.description ?? '',
    '',
    table(request),
    '',
    'Each item (mark-list, review):',
    '',
    table(item),
    '',
    'Each option (concept-pick):',
    '',
    table(option),
    '',
    'The permit (approve gates only):',
    '',
    table(permit),
    '',
    '## gates/<gate>.answers.json (written only by the cockpit)',
    '',
    answers.description ?? '',
    '',
    table(answers),
    '',
    'The stamped permit (approve gates with a permit only):',
    '',
    table(answerPermit),
    '',
    '## plan.json',
    '',
    plan.description ?? '',
    '',
    'Each entry in `plans`:',
    '',
    table(planEntry),
    '',
    'Each task:',
    '',
    table(planTask),
    '',
    'When `record` is set:',
    '',
    table(planRecord),
    '',
    'Each task in `record.tasks`:',
    '',
    table(recordTask),
    '',
    'Final review counts:',
    '',
    table(recordFinal),
    '',
    'Each fix round:',
    '',
    table(fixRound),
    '',
    '## phases.json (optional)',
    '',
    phases.description ?? '',
    '',
    'Each entry in `phases`:',
    '',
    table(plannedPhase),
    '',
    '## .nexus/config.json (in the repo, optional)',
    '',
    config.description ?? '',
    '',
    table(config),
    '',
    '## .nexus/init-answers.json (written by nexus init)',
    '',
    answersSchema.description ?? '',
    '',
    table(answersSchema),
    '',
    '## docs/_meta/views/<name>.md (a declared view)',
    '',
    `${view.description ?? ''} These fields are the note's frontmatter (see extending.md for a recipe per type).`,
    '',
    table(view),
    '',
    'Table options (`table`):',
    '',
    table(viewTable),
    '',
    'The starting sort (`table.sort`):',
    '',
    table(viewSort),
    '',
    'Chart options (`chart`):',
    '',
    table(viewChart),
    '',
    CONTRACTS_END,
  ].join('\n');
}

export function replaceGenerated(doc: string, generated: string): string {
  const a = doc.indexOf(CONTRACTS_START);
  const b = doc.indexOf(CONTRACTS_END);
  if (a < 0 || b < 0) throw new Error('reference/contracts.md is missing its generated markers');
  return doc.slice(0, a) + generated + doc.slice(b + CONTRACTS_END.length);
}
