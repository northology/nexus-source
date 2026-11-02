import { existsSync, readdirSync, type readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkRefusal, refusalText } from '../fs-guard.ts';
import { validate } from '../schemas.ts';
import { cachedRead, cachedText } from '../text-cache.ts';
import { readFrontmatter } from './frontmatter.ts';
import { finding, type ClassDef, type Division, type Finding, type Registry, type ViewDef } from './types.ts';

export const META = '_meta';
export const VIEWS_DIR = 'views';

/** A docs/ folder is a vault when it has _meta/classes/. */
export function isVault(docs: string): boolean {
  return existsSync(join(docs, META, 'classes'));
}

/** Where a governance class's archive statuses sit. */
export function archiveFolder(c: ClassDef): string {
  const tail = c.folder === c.division ? '' : c.folder.slice(c.division.length + 1);
  return tail ? `governance/archive/${tail}` : 'governance/archive';
}

function classProblem(c: ClassDef, known: Map<string, ClassDef>): string | null {
  const earlier = known.get(c.name);
  if (earlier) return `class "${c.name}" is already defined in ${earlier.file}`;
  if (c.folder !== c.division && !c.folder.startsWith(`${c.division}/`)) return `folder "${c.folder}" isn't inside its division "${c.division}/"`;
  if (c.folder.split('/').includes('assets')) return `folder "${c.folder}" is inside an assets/ folder, which holds files, not notes`;
  if (c.folder === 'governance/archive' || c.folder.startsWith('governance/archive/')) {
    return `folder "${c.folder}" is the governance archive, which classes reach through their archive statuses`;
  }
  if (c.archive.length > 0 && c.division !== 'governance') return 'only governance classes have archive statuses: the archive is governance/archive/';
  const both = c.statuses.find((s) => c.archive.includes(s));
  if (both) return `status "${both}" is both live and archive`;
  return null;
}

function readMetaFile(docs: string, name: string, kind: 'tags' | 'components' | 'contract', findings: Finding[]): Record<string, unknown> | null {
  const path = join(docs, META, name);
  const file = `docs/${META}/${name}`;
  const refused = linkRefusal(docs, path);
  if (refused !== null) {
    findings.push(finding('registry-invalid', 'block', file, refusalText(refused), 1));
    return null;
  }
  if (!existsSync(path)) return null;
  const fm = readFrontmatter(cachedText(path));
  if (fm.error || !fm.data) {
    findings.push(finding('registry-invalid', 'block', file, `the frontmatter can't be read: ${fm.error ?? 'it has none'}`, 1));
    return null;
  }
  const problems = validate(kind, fm.data);
  if (problems.length) {
    findings.push(finding('registry-invalid', 'block', file, `${name} is invalid: ${problems.join('; ')}`, 1));
    return null;
  }
  return fm.data;
}

function viewProblem(d: ViewDef, components: Set<string>): string | null {
  // Windows ignores trailing dots and spaces, and macOS/Windows ignore case, so compare a normalised first segment.
  const parts = d.data.replace(/\\/g, '/').split('/').map((s) => (s.trimEnd() === '..' ? '..' : s.replace(/[. ]+$/, ''))).filter((s) => s !== '' && s !== '.');
  const first = parts[0]?.toLowerCase();
  if (/^([A-Za-z]:|[\\/])/.test(d.data)) return 'data is a path from the repo root, not an absolute path';
  if (parts.includes('..')) return "data can't leave the repo: no .. segments";
  if (first === 'docs') return "data sits inside docs/: a view's data lives outside the vault";
  if (first === '.git') return "data can't be inside .git/";
  if (d.table && d.type !== 'table') return 'table options apply only to a table view';
  if (d.chart && d.type !== 'chart') return 'chart options apply only to a chart view';
  if (d.type === 'chart' && !d.chart) return 'a chart view names its columns: chart: { kind: bar, x: <column>, y: <column or list> }';
  if (d.component !== undefined && !components.has(d.component)) return `component "${d.component}" isn't registered in docs/_meta/components.md`;
  return null;
}

function readViews(docs: string, components: Set<string>, findings: Finding[], read: typeof readFileSync): Map<string, ViewDef> {
  const views = new Map<string, ViewDef>();
  const dir = join(docs, META, VIEWS_DIR);
  const refused = linkRefusal(docs, dir);
  if (refused !== null) {
    findings.push(finding('view-invalid', 'block', `docs/${META}/${VIEWS_DIR}`, refusalText(refused), 1));
    return views;
  }
  if (!existsSync(dir)) return views;
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name);
  for (const name of names.sort()) {
    const file = `docs/${META}/${VIEWS_DIR}/${name}`;
    const bad = (why: string): void => {
      findings.push(finding('view-invalid', 'block', file, why, 1));
    };
    let text: string;
    try {
      text = read(join(dir, name), 'utf8');
    } catch (e) {
      // An unreadable note (EBUSY, EPERM...) is this view's finding; the other views and the registry still read.
      bad(`can't be read: ${(e as { code?: unknown }).code ?? 'unknown'}`);
      continue;
    }
    const fm = readFrontmatter(text);
    if (fm.error || !fm.data) {
      bad(`the view note's frontmatter can't be read: ${fm.error ?? 'it has none'}`);
      continue;
    }
    if (fm.data['type'] === 'canvas') {
      bad("canvas isn't a view type: JSON Canvas boards live in the vault, where Obsidian shows them");
      continue;
    }
    const problems = validate('view', fm.data);
    if (problems.length) {
      bad(`the view note is invalid: ${problems.join('; ')}`);
      continue;
    }
    const def = { ...(fm.data as Omit<ViewDef, 'description' | 'file'>), description: fm.body.join('\n').trim(), file };
    const why = viewProblem(def, components);
    if (why) {
      bad(why);
      continue;
    }
    const earlier = views.get(def.name);
    if (earlier) {
      bad(`view "${def.name}" is already declared in ${earlier.file}`);
      continue;
    }
    views.set(def.name, def);
    if (name !== `${def.name}.md`) findings.push(finding('view-file-name', 'block', file, `the view is named "${def.name}", so its note is ${def.name}.md; rename the file`, 1));
    // The data path's links are checked before anything follows them: a network or device link is named, never followed.
    const refused = linkRefusal(join(docs, '..'), join(docs, '..', def.data));
    if (refused !== null) findings.push(finding('view-data-missing', 'warn', file, `${def.data} ${refusalText(refused)}; the view refuses it`, fm.keyLines.get('data')));
    else if (!existsSync(join(docs, '..', def.data))) findings.push(finding('view-data-missing', 'warn', file, `${def.data} doesn't exist yet; the view shows an empty state until it does`, fm.keyLines.get('data')));
  }
  return views;
}

/**
 * docs/_meta/ as a Registry. A class note that can't be used is left out, with a registry-invalid finding. Notes are
 * read through the text cache (core/text-cache.ts), so an unchanged note isn't read again; `read` reads the view notes
 * and is injectable so an unreadable note can be tested.
 */
export function readRegistry(docs: string, read: typeof readFileSync = cachedRead): { registry: Registry; findings: Finding[] } {
  const findings: Finding[] = [];
  const classes = new Map<string, ClassDef>();
  const dir = join(docs, META, 'classes');
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name);
  for (const name of names.sort()) {
    const file = `docs/${META}/classes/${name}`;
    const bad = (why: string): void => {
      findings.push(finding('registry-invalid', 'block', file, why, 1));
    };
    const fm = readFrontmatter(cachedText(join(dir, name)));
    if (fm.error || !fm.data) {
      bad(`the class note's frontmatter can't be read: ${fm.error ?? 'it has none'}`);
      continue;
    }
    const problems = validate('class', fm.data);
    if (problems.length) {
      bad(`the class note is invalid: ${problems.join('; ')}`);
      continue;
    }
    const d = fm.data as {
      name: string; division: Division; folder: string; produced: ClassDef['produced']; thing: boolean;
      statuses: string[]; archive: string[]; required: string[]; optional: string[];
    };
    const def: ClassDef = {
      name: d.name, division: d.division, folder: d.folder, produced: d.produced, thing: d.thing,
      statuses: d.statuses, archive: d.archive, required: d.required, optional: d.optional, file,
    };
    const why = classProblem(def, classes);
    if (why) {
      bad(why);
      continue;
    }
    classes.set(def.name, def);
    if (name !== `${def.name}.md`) {
      findings.push(finding('class-file-name', 'block', file, `the class is named "${def.name}", so its note is ${def.name}.md; rename the file`, 1));
    }
  }
  const tags = readMetaFile(docs, 'tags.md', 'tags', findings);
  const components = readMetaFile(docs, 'components.md', 'components', findings);
  const componentSet = new Set((components?.['components'] as string[] | undefined) ?? []);
  const views = readViews(docs, componentSet, findings, read);
  let contract: number | null = null;
  // A refused link is readMetaFile's finding; only a contract that is really absent is "missing".
  if (linkRefusal(docs, join(docs, META, 'contract.md')) === null && !existsSync(join(docs, META, 'contract.md'))) {
    findings.push(finding('registry-invalid', 'block', `docs/${META}/contract.md`, 'docs/_meta/contract.md is missing; it names the contract version the vault follows'));
  } else {
    const c = readMetaFile(docs, 'contract.md', 'contract', findings);
    if (c) contract = c['contract'] as number;
  }
  return {
    registry: {
      classes,
      tags: new Set((tags?.['vocabulary'] as string[] | undefined) ?? []),
      components: componentSet,
      views,
      contract,
    },
    findings,
  };
}
