import type { Frontmatter } from './frontmatter.ts';
import { linkState, scanBody, TYPED_LINKS, typedLinkValues } from './links.ts';
import { archiveFolder } from './registry.ts';
import { finding, type ClassDef, type Finding, type Level, type Registry, type RuleId } from './types.ts';

export interface Note {
  /** Repo-relative: docs/... */
  file: string;
  /** docs-relative, forward slashes. */
  rel: string;
  fm: Frontmatter;
}

/** Properties every note may carry, beyond its class's required and optional ones. Obsidian's own included. */
export const UNIVERSAL = ['class', 'component', 'source', 'status', 'build', 'tags', ...TYPED_LINKS, 'aliases', 'cssclasses'];

const under = (path: string, folder: string): boolean => path.startsWith(`${folder}/`);
const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

export function noteClass(n: Note, reg: Registry): ClassDef | undefined {
  const name = n.fm.data?.['class'];
  return typeof name === 'string' ? reg.classes.get(name) : undefined;
}

/** The rules one note can be judged on alone. Vault-wide rules (duplicate sources, orphaned supersedes) are in check.ts. */
export function checkNote(n: Note, reg: Registry, docs: string): Finding[] {
  const out: Finding[] = [];
  const at = (key: string): number | undefined => n.fm.keyLines.get(key);
  const add = (rule: RuleId, level: Level, message: string, line?: number): void => {
    out.push(finding(rule, level, n.file, message, line));
  };

  if (n.fm.error) {
    add('frontmatter-invalid', 'block', `the frontmatter can't be read: ${n.fm.error}`, 1);
    return out;
  }
  const data = n.fm.data ?? {};
  if (!present(data['class'])) {
    add('class-missing', 'block', 'the note has no class property; every note in the vault names its class', 1);
    return out;
  }
  const cls = noteClass(n, reg);
  if (!cls) {
    add('class-unknown', 'block', `class "${String(data['class'])}" isn't defined in docs/_meta/classes/`, at('class'));
    return out;
  }

  const archived = cls.archive.length > 0 && under(n.rel, archiveFolder(cls));
  if (!archived) {
    const owner = [...reg.classes.values()].find((o) => o.folder.length > cls.folder.length && under(o.folder, cls.folder) && under(n.rel, o.folder));
    if (!under(n.rel, cls.folder)) add('folder-wrong', 'block', `a ${cls.name} note belongs under docs/${cls.folder}/`, at('class'));
    else if (owner) add('folder-wrong', 'block', `docs/${owner.folder}/ holds ${owner.name} notes; move this ${cls.name} note to docs/${cls.folder}/ outside it`, at('class'));
  }

  const status = data['status'];
  if (cls.statuses.length === 0 && cls.archive.length === 0) {
    if (present(status)) add('status-invalid', 'block', `${cls.name} notes carry no status`, at('status'));
  } else {
    const allowed = archived ? cls.archive : cls.statuses;
    if (typeof status !== 'string' || !allowed.includes(status)) {
      const move = !archived && typeof status === 'string' && cls.archive.includes(status) ? ` (${status} notes move to docs/${archiveFolder(cls)}/)` : '';
      const what = present(status) ? `status "${String(status)}" isn't allowed here` : `a ${cls.name} note needs a status`;
      add('status-invalid', 'block', `${what}; use ${allowed.join(', ')}${move}`, at('status'));
    }
  }

  const source = data['source'];
  if (cls.thing && (typeof source !== 'string' || source.trim() === '')) {
    add('source-missing', 'block', `${cls.name} notes describe something that exists; add source: naming it`, at('source') ?? at('class'));
  }

  const component = data['component'];
  const choices = [...reg.components, 'shared'].join(', ');
  if (!present(component)) {
    if (reg.components.size > 0) add('component-missing', 'block', `name the note's component: ${choices}`, at('class'));
  } else if (component !== 'shared' && !(typeof component === 'string' && reg.components.has(component))) {
    add('component-unknown', 'block', `component "${String(component)}" isn't listed in docs/_meta/components.md; use ${choices}`, at('component'));
  }
  // A build record lists every component its build touched; each must be a listed one.
  const listed = data['components'];
  for (const c of !present(listed) ? [] : Array.isArray(listed) ? listed : [listed]) {
    if (!(typeof c === 'string' && reg.components.has(c))) {
      add('component-unknown', 'block', `components names "${String(c)}", which isn't listed in docs/_meta/components.md; use ${[...reg.components].join(', ') || 'a listed component'}`, at('components'));
    }
  }

  const tags = data['tags'];
  const tagList: unknown[] = !present(tags) ? [] : Array.isArray(tags) ? tags : [tags];
  for (const t of tagList) {
    const tag = typeof t === 'string' ? t.replace(/^#/, '') : String(t);
    if (!reg.tags.has(tag)) add('tag-unregistered', 'block', `tag "${tag}" isn't in docs/_meta/tags.md; register it there first`, at('tags'));
  }

  for (const key of cls.required) {
    if (!present(data[key])) add('property-missing', 'block', `${cls.name} notes need ${key}`, at('class'));
  }

  if (under(n.rel, 'superpowers/archive')) {
    const parts = n.rel.split('/');
    const folder = parts.length > 3 ? parts[2] : undefined;
    const build = data['build'];
    if (folder === undefined) {
      add('archive-build-folder', 'block', 'archived superpowers notes sit in a folder named for their build: superpowers/archive/<build>/', at('class'));
    } else if (typeof build === 'string' && build !== folder) {
      add('archive-build-folder', 'block', `this note is filed under superpowers/archive/${folder}/ but names build "${build}"; move it to superpowers/archive/${build}/ or fix build:`, at('build'));
    }
  }

  const tier = data['tier'];
  if (present(tier) && tier !== 'always' && tier !== 'scoped') add('tier-invalid', 'block', `tier is always or scoped, not "${String(tier)}"`, at('tier'));
  if (tier === 'scoped') {
    const paths = data['paths'];
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== 'string' || p === '')) {
      add('scoped-paths-missing', 'block', 'a scoped rule needs paths: a list of the paths it applies to, e.g. paths: ["data/pipelines/**"]', at('tier'));
    }
  }

  const known = new Set([...UNIVERSAL, ...cls.required, ...cls.optional]);
  for (const key of Object.keys(data)) {
    if (!known.has(key)) add('property-unknown', 'warn', `property "${key}" isn't part of the ${cls.name} class; add it to the class's optional list or remove it`, at(key));
  }

  const judge = (inner: string, line: number | undefined): void => {
    const state = linkState(docs, inner);
    if (state === 'short') add('link-short', 'warn', `[[${inner}]] isn't a full vault path; links use the path from docs/, e.g. [[dev/systems/name]]`, line);
    if (state === 'unresolved') add('link-unresolved', 'warn', `[[${inner}]] doesn't resolve to a file in docs/`, line);
  };
  for (const key of TYPED_LINKS) {
    const { links, malformed } = typedLinkValues(data[key]);
    if (malformed > 0) add('link-malformed', 'warn', `${key} holds values that aren't quoted wikilinks; write them as "[[path/from/docs]]"`, at(key));
    for (const inner of links) judge(inner, at(key));
  }

  const scan = scanBody(n.fm.body, n.fm.bodyLine);
  for (const line of scan.jsBlocks) add('js-query', 'block', 'JavaScript query blocks (dataviewjs, datacorejs) are not allowed in repo notes', line);
  for (const link of scan.links) judge(link.target, link.line);
  for (const line of scan.inlineFields) add('inline-field', 'warn', 'Dataview inline fields (key:: value) are not part of the property contract; use frontmatter', line);
  return out;
}
