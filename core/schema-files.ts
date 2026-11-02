import defs from '../schemas/defs.schema.json' with { type: 'json' };
import logEntry from '../schemas/log-entry.schema.json' with { type: 'json' };
import build from '../schemas/build.schema.json' with { type: 'json' };
import decisions from '../schemas/decisions.schema.json' with { type: 'json' };
import issues from '../schemas/issues.schema.json' with { type: 'json' };
import changes from '../schemas/changes.schema.json' with { type: 'json' };
import questions from '../schemas/questions.schema.json' with { type: 'json' };
import guardrails from '../schemas/guardrails.schema.json' with { type: 'json' };
import gateRequest from '../schemas/gate-request.schema.json' with { type: 'json' };
import gateAnswers from '../schemas/gate-answers.schema.json' with { type: 'json' };
import plan from '../schemas/plan.schema.json' with { type: 'json' };
import phases from '../schemas/phases.schema.json' with { type: 'json' };
import config from '../schemas/config.schema.json' with { type: 'json' };
import vaultClass from '../schemas/class.schema.json' with { type: 'json' };
import vaultTags from '../schemas/tags.schema.json' with { type: 'json' };
import vaultComponents from '../schemas/components.schema.json' with { type: 'json' };
import vaultContract from '../schemas/contract.schema.json' with { type: 'json' };
import view from '../schemas/view.schema.json' with { type: 'json' };
import initAnswers from '../schemas/init-answers.schema.json' with { type: 'json' };
import obsidianPins from '../schemas/obsidian-pins.schema.json' with { type: 'json' };
import type { LogName } from './types.ts';

export const SCHEMA_FILES = {
  defs,
  'log-entry': logEntry,
  build,
  decisions,
  issues,
  changes,
  questions,
  guardrails,
  'gate-request': gateRequest,
  'gate-answers': gateAnswers,
  plan,
  phases,
  config,
  class: vaultClass,
  tags: vaultTags,
  components: vaultComponents,
  contract: vaultContract,
  view,
  'init-answers': initAnswers,
  'obsidian-pins': obsidianPins,
};

export const LOG_NAMES: LogName[] = ['decisions', 'issues', 'changes', 'questions', 'guardrails'];

function statusesOf(schema: unknown): string[] {
  const s = schema as {
    properties: { entries: { items: { allOf: Array<{ properties?: { status?: { enum?: string[] } } }> } } };
  };
  const values = s.properties.entries.items.allOf[1]?.properties?.status?.enum;
  if (!values) throw new Error('A log schema is missing its status enum');
  return values;
}

export const LOG_STATUSES: Record<LogName, string[]> = {
  decisions: statusesOf(decisions),
  issues: statusesOf(issues),
  changes: statusesOf(changes),
  questions: statusesOf(questions),
  guardrails: statusesOf(guardrails),
};
