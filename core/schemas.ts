import AjvModule from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { SCHEMA_FILES } from './schema-files.ts';

export type SchemaKind =
  | 'build'
  | 'decisions'
  | 'issues'
  | 'changes'
  | 'questions'
  | 'guardrails'
  | 'gate-request'
  | 'gate-answers'
  | 'plan'
  | 'phases'
  | 'config'
  | 'class'
  | 'tags'
  | 'components'
  | 'contract'
  | 'view'
  | 'init-answers'
  | 'obsidian-pins';

const Ajv = AjvModule.default;
let compiled: Record<SchemaKind, ValidateFunction> | null = null;

/** Compiled on first use, not at import: the guard hook loads this module on every tool call and rarely validates. */
function validators(): Record<SchemaKind, ValidateFunction> {
  if (compiled) return compiled;
  const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  ajv.addSchema(SCHEMA_FILES.defs);
  ajv.addSchema(SCHEMA_FILES['log-entry']);
  compiled = {
    build: ajv.compile(SCHEMA_FILES.build),
    decisions: ajv.compile(SCHEMA_FILES.decisions),
    issues: ajv.compile(SCHEMA_FILES.issues),
    changes: ajv.compile(SCHEMA_FILES.changes),
    questions: ajv.compile(SCHEMA_FILES.questions),
    guardrails: ajv.compile(SCHEMA_FILES.guardrails),
    'gate-request': ajv.compile(SCHEMA_FILES['gate-request']),
    'gate-answers': ajv.compile(SCHEMA_FILES['gate-answers']),
    plan: ajv.compile(SCHEMA_FILES.plan),
    phases: ajv.compile(SCHEMA_FILES.phases),
    config: ajv.compile(SCHEMA_FILES.config),
    class: ajv.compile(SCHEMA_FILES.class),
    tags: ajv.compile(SCHEMA_FILES.tags),
    components: ajv.compile(SCHEMA_FILES.components),
    contract: ajv.compile(SCHEMA_FILES.contract),
    view: ajv.compile(SCHEMA_FILES.view),
    'init-answers': ajv.compile(SCHEMA_FILES['init-answers']),
    'obsidian-pins': ajv.compile(SCHEMA_FILES['obsidian-pins']),
  };
  return compiled;
}

/** Returns readable problems; an empty array means the data is valid. */
export function validate(kind: SchemaKind, data: unknown): string[] {
  const fn = validators()[kind];
  return fn(data) ? [] : describeErrors(fn.errors);
}

function describeErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? [])
    .filter((e) => e.keyword !== 'if')
    .map((e) => {
      const where = e.instancePath || '(top level)';
      let extra = '';
      if (e.keyword === 'enum') extra = ` (${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')})`;
      if (e.keyword === 'additionalProperties') extra = ` ("${(e.params as { additionalProperty: string }).additionalProperty}")`;
      return `${where} ${e.message ?? 'is invalid'}${extra}`;
    });
}
