import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { NexusError } from '../errors.ts';
import { buildPath } from '../paths.ts';
import { readFrontmatter } from '../vault/frontmatter.ts';
import { archiveDir, reportDraft } from './paths.ts';

/** The build's document folders and the class each one's notes take in the archive. */
const KINDS: [folder: string, cls: string][] = [['specs', 'spec'], ['plans', 'plan'], ['reports', 'report'], ['audits', 'report']];

/** Every file below `dir`, as paths relative to it; names starting with a dot are passed over. */
function filesBelow(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? filesBelow(join(dir, e.name), `${rel}${e.name}/`) : e.isFile() ? [`${rel}${e.name}`] : []));
}

/** A note with its class and build set, and a component when it names none; its other properties and body stay. */
function archivedNote(text: string, cls: string, build: string, from: string): string {
  const fm = readFrontmatter(text);
  if (fm.error) throw new NexusError(`${from}: ${fm.error}`);
  const props = { component: 'shared', ...(fm.data ?? {}), class: cls, build };
  return `---\n${stringify(props)}---\n${fm.body.join('\n')}`;
}

/**
 * Copies the build's specs, plans, reports and audits into the vault's archive, keeping each one's path below its
 * folder (so a phase's documents stay together), with the files beside them. Returns the repo paths written.
 */
export function archiveDocuments(root: string, build: string): string[] {
  const from = new Map<string, string>();
  const jobs: { source: string; rel: string; cls: string }[] = [];
  for (const [folder, cls] of KINDS) {
    for (const rel of filesBelow(buildPath(root, build, 'documents', folder))) {
      const source = `documents/${folder}/${rel}`;
      // The final report becomes the build's record instead (build-record.ts).
      if (source === reportDraft(build)) continue;
      const other = from.get(rel.toLowerCase());
      if (other) throw new NexusError(`${other} and ${source} would both archive to ${archiveDir(build)}/${rel}: rename one`);
      from.set(rel.toLowerCase(), source);
      jobs.push({ source, rel, cls });
    }
  }
  return jobs.map(({ source, rel, cls }) => {
    const path = `${archiveDir(build)}/${rel}`;
    const abs = join(root, path);
    const file = buildPath(root, build, ...source.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    if (rel.toLowerCase().endsWith('.md')) writeFileSync(abs, archivedNote(readFileSync(file, 'utf8'), cls, build, source));
    else copyFileSync(file, abs);
    return path;
  });
}
