// The generated part of the Guidance commands page (reference/guide/commands.md), from the command table.
import { slugify } from '../cockpit/src/lib/markdown.ts';
import { COMMANDS, commandName, GROUPS } from './commands.ts';

export const GUIDE_START = '<!-- generated:commands:start -->';
export const GUIDE_END = '<!-- generated:commands:end -->';

/** A command's link in the cockpit: a route, so a copied address keeps the heading. */
export const commandHref = (name: string) => `#/guidance/commands?h=${slugify(name)}`;

/** The index (each group, each command a link to its entry), then each group's entries. */
export function guideCommands(): string {
  const index = GROUPS.map((g) => {
    const links = COMMANDS.filter((c) => c.group === g).map((c) => `[${commandName(c)}](${commandHref(commandName(c))})`);
    return `- **${g}:** ${links.join(' · ')}`;
  });
  const sections = GROUPS.map((g) => {
    const entries = COMMANDS.filter((c) => c.group === g).map((c) =>
      [`### ${commandName(c)}`, '', '```', `nexus ${c.usage}`, '```', '', c.detail, '', `**When:** ${c.when}`, '', '**Example:**', '', '```bash', c.example, '```'].join('\n'),
    );
    return [`## ${g}`, '', ...entries.flatMap((e) => [e, ''])].join('\n');
  });
  return [...index, '', ...sections].join('\n').trimEnd();
}

/** The page with its generated block replaced; the hand-written part above the markers is kept. */
export function replaceGuide(doc: string): string {
  const a = doc.indexOf(GUIDE_START);
  const b = doc.indexOf(GUIDE_END);
  if (a < 0 || b < 0) throw new Error('reference/guide/commands.md is missing its generated markers');
  return `${doc.slice(0, a)}${GUIDE_START}\n${guideCommands()}\n${doc.slice(b)}`;
}
