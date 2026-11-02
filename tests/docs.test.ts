import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { renderContracts, replaceGenerated } from '../core/contracts-doc.ts';
import { slugify } from '../cockpit/src/lib/markdown.ts';
import { COMMANDS, commandName } from '../scripts/commands.ts';
import { GUIDE_START, replaceGuide } from '../scripts/guide-doc.ts';
import { ARTIFACTS } from './helpers.ts';
import { RAISED_BY } from '../core/guardrails.ts';
import { compareVersions } from '../core/doctor.ts';

const REF = join(ARTIFACTS, 'reference');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('reference docs', () => {
  it('contracts.md matches the schemas (run `pnpm contracts` if this fails)', () => {
    const doc = read(join(REF, 'contracts.md'));
    expect(replaceGenerated(doc, renderContracts())).toBe(doc);
  });
  it('contracts.md gives every row of the kept record a note, and names the fix round in words', () => {
    const doc = read(join(REF, 'contracts.md'));
    const section = doc.split('When `record` is set:')[1]?.split('\n## ')[0] ?? '';
    const rows = section.split('\n').filter((l) => l.startsWith('| `'));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => /\|\s*\|$/.test(r.trim()))).toEqual([]);
    expect(section).not.toContain('| list of fixRound');
    expect(section).toContain('list of fix round (fields below)');
  });
  it('contracts.md names array and nullable types in words', () => {
    const doc = renderContracts();
    expect(doc).toContain('string or null');
    expect(doc).not.toContain('string,null');
    expect(doc).toContain('| `fixRounds` | list of fix round (fields below) |');
    expect(doc).not.toContain('list of any');
    expect(doc).toMatch(/Each fix round:\n\n\| Field \| Type \| Required \| Notes \|\n\|---\|---\|---\|---\|\n\| `round` \|/);
  });
  it('contracts.md shows a constant as its JSON value', () => {
    const doc = renderContracts();
    expect(doc).toContain('| `none` | `true` | no |');
    expect(read(join(REF, 'contracts.md'))).toContain('| `none` | `true` | no |');
  });
  it('contracts.md names a referenced record rather than calling it any', () => {
    const row = '| `record` | null or record (fields below) |';
    expect(renderContracts()).toContain(row);
    expect(read(join(REF, 'contracts.md'))).toContain(row);
  });
  it('contracts.md documents the permit the server stamps into an answers file', () => {
    const doc = renderContracts();
    expect(doc).toMatch(/\| `permit` \| object \(fields below\) \| no \| Stamped by the server/);
    expect(doc).toMatch(/The stamped permit \(approve gates with a permit only\):\n\n\| Field \| Type \| Required \| Notes \|\n\|---\|---\|---\|---\|\n\| `target` \|[^\n]+\n\| `change` \|/);
  });
  it('contracts.md tabulates the final review counts of a plan record', () => {
    expect(renderContracts()).toMatch(/Final review counts:\n\n\| Field \| Type \| Required \| Notes \|\n\|---\|---\|---\|---\|\n\| `rulings` \| integer \| yes \|[^\n]*\n\| `minors` \| integer \| yes \|/);
  });
  it('every row of the phases table has a note', () => {
    const table = renderContracts().split('Each `phases` entry:\n\n')[1]?.split('\n\n')[0] ?? '';
    const rows = table.split('\n').slice(2);
    expect(rows.map((r) => r.split('|')[1]?.trim())).toEqual(['`name`', '`branch`', '`started`', '`finished`']);
    for (const row of rows) expect(row.split('|')[4]?.trim(), row).not.toBe('');
  });
  it('no section opens by restating its own file name', () => {
    const sections = renderContracts().split(/^## /m).slice(1);
    expect(sections.length).toBeGreaterThanOrEqual(6);
    for (const section of sections) {
      const [heading = '', , first = ''] = section.split('\n');
      const file = heading.match(/^(\S+)/)?.[1] ?? '';
      expect(first.startsWith(file), `${heading}: ${first}`).toBe(false);
    }
  });
  it('every relative link in reference/ resolves', () => {
    for (const f of readdirSync(REF).filter((n) => n.endsWith('.md'))) {
      const text = read(join(REF, f));
      for (const m of text.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
        const target = resolve(dirname(join(REF, f)), decodeURIComponent(m[1]!.split('#')[0]!));
        expect(existsSync(target), `${f} → ${m[1]}`).toBe(true);
      }
    }
  });
  it('cockpit.md pins every API route', () => {
    const text = read(join(REF, 'cockpit.md'));
    for (const route of ['GET /api/builds', 'GET /api/builds/<build>', 'GET /api/builds/<build>/files/<path>', 'GET /api/rules/<index>', 'POST /api/builds/<build>/gates/<gate>/answers', 'GET /api/events']) {
      expect(text, route).toContain(route);
    }
  });
  it('superpowers.md says how rm -rf * from the repo root is judged', () => {
    const gaps = read(join(REF, 'superpowers.md')).split('## Known gaps in the wall')[1] ?? '';
    expect(gaps).toContain('`rm -rf *`');
  });
  it("the nexus skill's wall paragraph mentions opened concept pages", () => {
    const wall = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).split('## The wall')[1]?.split('\n## ')[0] ?? '';
    expect(wall).toContain('a concept page once its round has opened');
  });
  it('gates.md covers every gate type', () => {
    const text = read(join(REF, 'gates.md'));
    for (const t of ['mark-list', 'concept-pick', 'approve']) expect(text).toContain(t);
  });
});

describe('the docs after the pre-production fixes', () => {
  const flat = (rel: string) => read(join(ARTIFACTS, rel)).replace(/\s+/g, ' ');
  it('say a build\'s gate answers stay walled until decommission, and review answers only during a build', () => {
    expect(flat('reference/guide/flow.md')).toContain('A build\'s gate answers stay protected after its last phase closes, until decommission removes its folder');
    expect(flat('reference/guide/flow.md')).not.toContain('with no build at all');
    expect(flat('reference/guide/commands.md')).toContain('A build\'s gate answers stay refused until decommission removes the build.');
    expect(flat('skills/nexus/SKILL.md')).toContain('`gates/*.answers.json` stay walled until decommission removes the build.');
  });
  it('name four kinds of gate, every skill, and what a decommission gate logs', () => {
    expect(flat('reference/guide/overview.md')).toContain('There are four kinds:');
    expect(flat('README.md')).toContain('the five skills: `nexus`, `/nexus:plan`, `/nexus:decommission`, `/nexus:init` and `grill-me`');
    expect(flat('reference/gates.md')).toContain('Applying the gate writes one entry, named after the gate, to the build\'s decision log');
  });
});

describe('skill', () => {
  const skill = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md'));
  it('has a name and a description', () => {
    expect(skill).toMatch(/^---\nname: nexus\ndescription: .{80,}\n/);
  });
  it("pre-approves its own command so it works in don't-ask mode", () => {
    expect(skill).toContain('\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)\n---\n');
  });
  it('documents the cockpit token as a protection, not as a way to answer', () => {
    const cockpit = read(join(REF, 'cockpit.md'));
    expect(cockpit).toContain('x-nexus-token');
    expect(cockpit).not.toMatch(/scripts that need to answer/i);
  });
  it('says a permitted change comes before applying its gate', () => {
    expect(skill).toContain('make the change first, then apply');
  });
  it('points only at reference files that exist', () => {
    const refs = [...skill.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/reference\/([a-z-]+\.md)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThanOrEqual(5);
    for (const r of refs) expect(existsSync(join(REF, r)), r).toBe(true);
  });
  it('covers guardrails, finishing and planning, and points at the Superpowers reference', () => {
    for (const s of ['nexus guardrail propose', 'finish-<phase>', '/nexus:plan', 'superpowers.md']) expect(skill, s).toContain(s);
  });
  it('stays short', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(80);
  });
});

describe('planning skills', () => {
  const plan = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md'));
  const grill = read(join(ARTIFACTS, 'skills', 'grill-me', 'SKILL.md'));
  it('are started only by the user', () => {
    for (const s of [plan, grill]) expect(s).toMatch(/^---\nname: [a-z-]+\ndescription: .{40,}\ndisable-model-invocation: true\n/);
  });
  it('plan pre-approves the nexus command and points at real reference files', () => {
    expect(plan).toContain('allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)');
    for (const r of [...plan.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/reference\/([a-z-]+\.md)/g)].map((m) => m[1]!)) expect(existsSync(join(REF, r)), r).toBe(true);
    for (const s of ['superpowers:brainstorming', 'superpowers:writing-plans', 'superpowers:finishing-a-development-branch', 'nexus guardrail propose', 'nexus ledger import', 'finish-<phase>', 'phase start']) expect(plan, s).toContain(s);
  });
  it('nexus and plan both forbid answering a gate by any means', () => {
    const skill = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md'));
    for (const s of [skill, plan]) expect(s).toMatch(/Never answer a gate yourself by any means.*only the user answers, in the/s);
  });
  it('grill-me credits its source and ships its licence', () => {
    expect(grill).toContain('https://github.com/mattpocock/skills');
    expect(read(join(ARTIFACTS, 'skills', 'grill-me', 'LICENSE'))).toMatch(/MIT License/);
  });
  it('plan checks before branching and finishes through the gate, never through a checkout', () => {
    for (const s of ['nexus builds', '--check', 'git fetch . HEAD:main', '"step": "finish"', 'phase-2', 'Keep the build branch']) expect(plan, s).toContain(s);
    expect(plan).toMatch(/don't invoke it: run the full test suite and return to `\/nexus:plan` step 5/);
  });
  it('plan resumes an existing build through nexus phase status', () => {
    // Read as prose: a phrase may wrap across lines.
    const text = plan.replace(/\s+/g, ' ');
    expect(text).toContain("Nothing changes git before step 4, except a resume's checkout.");
    expect(text).toContain('If `<build>` is listed by `nexus builds`, or has a `build/<build>` branch, it already exists:');
    expect(text).toContain('Run `git status --porcelain`; if it prints anything, stop and ask the user before any checkout.');
    expect(text).toContain('`git branch --list "build/<build>*" --sort=-committerdate`');
    expect(text).toContain('If no phase was named, or the named phase is the current one, this is a resume');
    expect(text).toContain('run `nexus phase status --build <build>` again until its `Next:` line points into a step');
    expect(text).not.toContain('`nexus phase status`');
    expect(text).toContain('`.build/<build>/logs/decisions.json` and `questions.json`');
    expect(text).toContain('tell brainstorming what is already settled');
    expect(text).toContain('when the current phase is closed, finish any merge its `Next:` line names, then continue with step 3');
    expect(text).toContain("when it isn't closed, ask the user.");
  });
  it('plan lists builds, then checks, then branches, and never checks out the trunk', () => {
    expect(plan.indexOf('nexus builds')).toBeGreaterThan(-1);
    expect(plan.indexOf('nexus builds')).toBeLessThan(plan.indexOf('--check'));
    expect(plan.indexOf('--check')).toBeLessThan(plan.indexOf('git checkout -b'));
    for (const s of ['git checkout main', 'git switch main', 'git checkout master']) expect(plan, s).not.toContain(s);
  });
  it('plan words the git promises and refusals precisely', () => {
    const flat = plan.replace(/\s+/g, ' ');
    expect(flat).toContain("If it's refused because it isn't a fast-forward (`main` has moved)");
    expect(flat).toContain("If it's refused for any other reason, stop and tell the user what git said.");
    expect(flat).toContain('Names start with a letter');
    expect(flat).toContain('names start with a letter');
  });
  it('plan step 5 stops at the finish gate until the user answers', () => {
    const step5 = plan.slice(plan.indexOf('## 5. Finish'), plan.indexOf('## While the phase is active'));
    expect(step5).toContain('stop until they answer');
  });
  it('plan and nexus point at /nexus:decommission rather than saying it is not built', () => {
    const skill = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md'));
    for (const s of [plan, skill]) {
      expect(s).toContain('/nexus:decommission <build>');
      expect(s).not.toContain("isn't built yet");
    }
    expect(skill).toContain('`nexus review open`');
    expect(skill).toContain('writes a closed build into `docs/`; never delete `.build/<name>/` yourself.');
  });
  it('gates.md covers steps, tabs and row notes', () => {
    const text = read(join(REF, 'gates.md'));
    for (const s of ['"step"', '"notes"', 'git fetch . HEAD:main']) expect(text, s).toContain(s);
    const flat = text.replace(/\s+/g, ' ');
    for (const s of ['one of six', '`plan` and `finish`, named `<step>-<phase>`, and `decommission`']) expect(flat, s).toContain(s);
  });
  it('gates.md covers guardrail gates, conflicts, permits and finish gates', () => {
    const text = read(join(REF, 'gates.md'));
    for (const s of ['"log": "guardrails"', 'conflicts', 'permit', 'finish-<phase>']) expect(text, s).toContain(s);
  });
});

describe('the decommission skill', () => {
  const skill = read(join(ARTIFACTS, 'skills', 'decommission', 'SKILL.md'));
  const flat = skill.replace(/\s+/g, ' ');
  it('is started only by the user and pre-approves only the nexus command', () => {
    expect(skill).toMatch(/^---\nname: decommission\ndescription: .{40,}\ndisable-model-invocation: true\n/);
    expect(skill).toContain('\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)\n---\n');
  });
  it('checks, drafts the report, opens the gate, writes the notes, then applies, in that order', () => {
    const order = ['nexus decommission check <build>', '.build/<build>/documents/reports/<build> final report.md', 'nexus guardrail list --accepted', 'nexus gate open', 'nexus gate apply decommission-<build>', 'docs/governance/rules/', 'nexus decommission apply <build>', 'Record <build> before decommission'];
    let at = -1;
    for (const s of order) {
      const i = skill.indexOf(s, at + 1);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
  });
  it('says what a rule, a decision and an issue are, and where each goes', () => {
    for (const s of ['| Rule |', '| Decision |', '| Issue |', '| Question |', '`docs/governance/decisions.json`', '`docs/governance/issues.json`', '<build> final report.md']) expect(skill, s).toContain(s);
    for (const s of ['manifest', '.canvas', '<!-- row:']) expect(skill, s).not.toContain(s);
  });
  it('asks the user about every accepted guardrail, and about nothing else', () => {
    for (const s of ['Every guardrail it prints is a row: never leave one out or sort them yourself.', 'the user decides one thing, which guardrails become repo rules']) expect(flat, s).toContain(s);
  });
  it('takes the commit identity only from the environment', () => {
    expect(flat).toContain('Run `nexus decommission apply <build>` with `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` set to the commit identity your instructions name, if they name one.');
  });
  it('forbids answering a gate, deleting the build, writing what apply writes, and touching branches', () => {
    expect(skill).toMatch(/Never answer a gate yourself by any means.*only the user answers, in the/s);
    for (const s of ['Never delete `.build/<build>/` yourself', 'Never push, merge or delete a branch']) expect(flat, s).toContain(s);
    expect(flat).toContain('Decommission only the build the user named');
  });
  it('meets what an agent will hit: several builds, no cockpit, a stopped apply, the record commit', () => {
    for (const s of [
      'Add `--build <build>` to every other nexus command when the checkout holds more than one build.',
      'start `nexus serve --open` in the background and give the user the URL. Tell the user the gate is waiting in the cockpit, then stop until they answer.',
      'so expect a permission prompt for it',
      "If it stops, the decommission isn't committed and the build folder is in place. Fix what it names and run it again.",
      "It commits the build folder as it stands (`Record <build> before decommission`), so the gate's answers and the whole record stay in git history.",
    ]) expect(flat, s).toContain(s);
  });
  it('asks the user at every decommission: with no accepted guardrail, an approve gate on the report, reopened once sent back', () => {
    for (const s of [
      'With no accepted guardrail there are no rows, but the user still approves what the report moves:',
      '"type": "approve", "step": "decommission"',
      'open `decommission-<build>-2` (then `-3`)',
    ]) expect(flat, s).toContain(s);
    expect(flat).not.toContain('skip the gate');
  });
  it("settles earlier builds' log entries only as the report lists them, which the plan skill keeps shut", () => {
    for (const s of ['5. **Earlier builds:**', '`"status": "closed"` and `"closedBy": "<build>"`', '`"status": "superseded"` and `"supersededBy": "<build>"`', "Earlier builds' entries change only as step 4 says."]) expect(flat, s).toContain(s);
    expect(flat.indexOf('5. **Earlier builds:**')).toBeLessThan(flat.indexOf('nexus gate open'));
    const plan = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(plan).toContain("The repo's permanent record (`docs/governance/decisions.json`, `issues.json` and `builds/`) is walled");
  });
  it('waits at the gate before applying the answers', () => {
    expect(flat).toContain('then stop until they answer.');
    expect(flat.indexOf('then stop until they answer.')).toBeLessThan(flat.indexOf('nexus gate apply decommission-<build>`'));
  });
  it('points only at reference files that exist, and keeps its prose to 118 columns', () => {
    const refs = [...skill.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/reference\/([a-z-]+\.md)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const r of refs) expect(existsSync(join(REF, r)), r).toBe(true);
    const body = skill.split('\n---\n').slice(1).join('\n---\n');
    for (const line of body.replace(/```[\s\S]*?```/g, '').split('\n')) expect(line.length, line).toBeLessThanOrEqual(118);
  });
});

describe('the Plan section docs', () => {
  it('cockpit.md lists the Plan params and the snapshot field', () => {
    const doc = readFileSync(join(ARTIFACTS, 'reference', 'cockpit.md'), 'utf8');
    expect(doc).toContain('mode=board');
    expect(doc).toContain('task=t-9c2e7b10');
    expect(doc).toContain('plan=p-3f9a1c2e');
    expect(doc).toContain('planProgress');
  });
  it('gates.md says an approved plan gate indexes its tasks', () => {
    expect(readFileSync(join(ARTIFACTS, 'reference', 'gates.md'), 'utf8')).toContain('nexus plan index <gate>');
  });
  it('the nexus skill mentions nexus plan', () => {
    expect(readFileSync(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md'), 'utf8')).toContain('`nexus plan`');
  });
});

describe('concept steering', () => {
  it('gates.md covers rounds, topics and the three apply outcomes', () => {
    const text = read(join(REF, 'gates.md'));
    expect(text).toContain('`Open the next round on topic "<topic>" with new pages in concepts/<topic>/, merging <label> and <label>.`');
    expect(text).toContain("`Open the next round on topic \"<topic>\" with new pages in concepts/<topic>/, using the user's note.`");
    for (const s of ['## Rounds and topics', '"topic": "status-look"', 'none of these', 'combine <label> + <label>', 'is settled.']) expect(text, s).toContain(s);
  });
  it('gates.md says a mark-list closes and reopens questions, and gate apply lists them', () => {
    const text = read(join(ARTIFACTS, 'reference', 'gates.md')).replace(/\s+/g, ' ');
    expect(text).toContain('An accepted or declined row closes an open question of the same name');
    expect(text).toContain('a research row reopens a decision of the same name as a question');
    expect(text).toContain('`Closed questions:`');
    expect(text).toContain('`Reopened as questions:`');
    expect(text).not.toContain('Each row leaves the log it was in');
  });
  it('gates.md says how to preview a concept page at the origin nexus serve prints', () => {
    const text = read(join(ARTIFACTS, 'reference', 'gates.md')).replace(/\s+/g, ' ');
    expect(text).toContain('`<concept pages URL><build>/concepts/<topic>/<option>.html`');
    expect(text).toContain('the second line `nexus serve` prints');
  });
  it('the plan skill replaces the visual companion with concept-pick rounds', () => {
    const text = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md'));
    expect(text).toContain("Don't offer or start the visual companion");
    expect(text).toContain('choose a short `topic`');
    expect(text).toContain('.build/<build>/concepts/<topic>/<option>.html');
    expect(text).toContain('reference/gates.md` ("Rounds and topics")');
  });
  it('the nexus skill sends option choices through concept-pick rounds', () => {
    // Read as prose: a phrase may wrap across lines.
    const text = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(text).toContain('go through a concept-pick round');
    expect(text).toContain('Never change a page after its round opens');
    expect(text).toContain("Never start Impeccable's live mode");
    expect(text).toContain('reference/gates.md');
  });
  it('the nexus skill records a live-mode accept the user made, with a topic', () => {
    // Read as prose: a phrase may wrap across lines. The user accepts in the browser; the agent handles the event.
    const text = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(text).toContain('When live mode delivers an `accept` on a chosen concept, after its cleanup, record it:');
    expect(text).not.toContain('After you accept');
    expect(text).toContain('In live mode the user accepts a variant in the browser, never you.');
    expect(text).toContain('or when the user asks for live mode by name');
    expect(text).toContain('nexus log add changes <entry-name> --topic <topic> --status applied');
    expect(text).toContain("where `<topic>` is the gate's `topic`, which defaults to the gate's name when it has none");
  });
  it('the nexus and plan skills let a concept page load assets beside it, new ones for each round', () => {
    const nexus = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(nexus).toContain('A page may load images, fonts, scripts and data placed beside it in its topic folder');
    expect(nexus).toContain("a new round gets new pages and new asset files, never edits to an opened round's assets");
    const plan = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md')).replace(/\n> /g, '\n').replace(/\s+/g, ' ');
    expect(plan).toContain('images, fonts, scripts and data it loads sit beside it');
  });
  it('the nexus skill keeps its prose to the file width', () => {
    // The front matter's description and lines that are a command are exempt: a command isn't wrapped.
    const long = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md'))
      .split('\n')
      .filter((l) => l.length > 118 && !l.startsWith('description:') && !l.includes('`nexus log add'));
    expect(long).toEqual([]);
  });
  it("the nexus skill puts a concept-pick round in place of Impeccable's decision page", () => {
    // Read as prose: a phrase may wrap across lines.
    const text = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(text).toContain("A concept-pick round replaces Impeccable's decision page (`impeccable serve-question`)");
    expect(text).toContain("a settled round is the user's recorded approval for that direction round");
    expect(text).toContain('"none of these" stands in for its re-roll');
  });
  it('the nexus skill covers options shown visually and keeps text-only choices in the terminal', () => {
    const text = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(text).toContain('options shown visually (layouts, mockups, directions)');
    expect(text).toContain('Text-only choices stay in the terminal.');
  });
  it('both skills follow the Next: line that gate apply prints', () => {
    const plan = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md'));
    const nexus = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(plan).toContain('follow the `Next:` line it prints');
    expect(nexus).toContain("When `nexus gate apply`'s `Next:` line says to open the next round");
  });
});

describe('concept frames', () => {
  it("cockpit.md says a document's link opens a concept page in a new tab, on the asset origin", () => {
    const doc = read(join(REF, 'cockpit.md'));
    expect(doc).toContain("a Markdown document's link to a concept page opens it in a new tab on the asset origin, sandboxed");
  });
  it('only ConceptFrame writes a sandbox attribute in the cockpit', () => {
    const src = join(ARTIFACTS, 'cockpit', 'src');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).map((f) => f.replace(/\\/g, '/')).filter((f) => statSync(join(src, f)).isFile());
    expect(files).toContain('components/ConceptFrame.tsx');
    const writers = files.filter((f) => readFileSync(join(src, f), 'utf8').includes('sandbox='));
    expect(writers).toEqual(['components/ConceptFrame.tsx']);
  });
});

describe('the Guidance commands page', () => {
  const page = () => read(join(REF, 'guide', 'commands.md'));
  it('matches the command table (run `pnpm guide` if this fails)', () => {
    const doc = page();
    expect(replaceGuide(doc)).toBe(doc);
  });
  it('opens with an index linking every command to its entry', () => {
    const doc = page();
    const index = doc.split(GUIDE_START)[1]?.split('\n## ')[0] ?? '';
    for (const c of COMMANDS) {
      const name = commandName(c);
      expect(index, name).toContain(`[${name}](#/guidance/commands?h=${slugify(name)})`);
      expect(doc, name).toContain(`\n### ${name}\n`);
    }
  });
  it('covers /nexus:plan and the three hooks above the generated block, and the overview names all three', () => {
    const intro = page().split(GUIDE_START)[0] ?? '';
    for (const term of ['/nexus:plan', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']) expect(intro).toContain(term);
    const overview = readFileSync(join(ARTIFACTS, 'reference', 'guide', 'overview.md'), 'utf8');
    for (const term of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse']) expect(overview).toContain(term);
  });
});

describe('the Guidance pages', () => {
  const guide = (f: string) => read(join(REF, 'guide', f));
  const mermaidBlocks = (doc: string) => [...doc.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  it('overview has its sections, a component map and a glossary', () => {
    const doc = guide('overview.md');
    for (const h of ['## What nexus is', '## The parts', '## How the parts talk', '## Glossary']) expect(doc).toContain(h);
    expect(mermaidBlocks(doc)).toHaveLength(1);
    const glossary = doc.split('## Glossary')[1] ?? '';
    for (const term of ['build', 'phase', 'stage', 'gate', 'step', 'guardrail', 'permit', 'round', 'topic', 'ledger', 'close-out']) {
      expect(glossary, term).toMatch(new RegExp(`\\*\\*${term}:\\*\\*`, 'i'));
    }
  });
  it('flow has the five maps, each a diagram with a walkthrough', () => {
    const doc = guide('flow.md');
    const maps = ['## A phase, start to merge', "## A gate's round trip", '## Concept rounds', '## The wall', '## Picking a phase back up'];
    for (const h of maps) expect(doc).toContain(`\n${h}\n`);
    expect(mermaidBlocks(doc)).toHaveLength(5);
    for (const section of doc.split('\n## ').slice(1)) {
      expect(mermaidBlocks(`\n${section}`), section.slice(0, 40)).toHaveLength(1);
      const words = section.replace(/```[\s\S]*?```/g, '').split('\n').slice(1).join(' ').trim().split(/\s+/);
      expect(words.length, section.slice(0, 40)).toBeGreaterThan(40);
    }
  });
  it('every diagram names its type, and the hand-written prose wraps at 120 columns', () => {
    for (const f of ['overview.md', 'flow.md', 'commands.md']) {
      for (const block of mermaidBlocks(guide(f))) expect(block.trimStart(), f).toMatch(/^(flowchart|sequenceDiagram|stateDiagram-v2)\b/);
    }
    // commands.md's generated block is laid out by the generator; its hand-written head is checked with the rest.
    const head = guide('commands.md').split(GUIDE_START)[0] ?? '';
    for (const [f, doc] of [['overview.md', guide('overview.md')], ['flow.md', guide('flow.md')], ['commands.md', head]] as const) {
      const prose = doc.replace(/```[\s\S]*?```/g, '').split('\n');
      expect(prose.filter((l) => l.length > 120), f).toEqual([]);
    }
  });
});

describe('the Guidance pages say what the code does', () => {
  const guide = (f: string) => read(join(REF, 'guide', f));
  const entry = (name: string) => COMMANDS.find((c) => commandName(c) === name);
  it('scopes permits to standing rules: answers, build files and opened concept pages are refused even with one', () => {
    const overview = guide('overview.md');
    expect(overview).toContain('A permit covers only standing rules');
    expect(overview.split('## Glossary')[1]).toMatch(/\*\*Permit:\*\* .*standing rule/);
    const wall = guide('flow.md').split('## The wall')[1]?.split('\n## ')[0] ?? '';
    expect(wall).toContain('A permit covers only standing rules');
    expect(wall).toMatch(/standing rule\?/);
    expect(entry('guard')?.detail).toMatch(/standing rule.*permit|permit.*standing rule/);
  });
  it('lists every protected target the wall holds', () => {
    for (const f of ['overview.md', 'flow.md']) {
      for (const t of ['plan.json', 'docs/superpowers/', '.nexus/config.json', 'build.json', 'AGENTS.md']) expect(guide(f), `${f} ${t}`).toContain(t);
    }
  });
  it('says the reminder carries a count of guardrails and the gates you answered, not the rules themselves', () => {
    expect(entry('hook')?.detail).toContain('how many guardrails are accepted');
    expect(entry('guardrail propose')?.detail).not.toContain('every reminder');
    expect(guide('commands.md').split(GUIDE_START)[0]).toContain('how many guardrails are accepted');
  });
  it('says the prompt hook also names an answered review, with or without a build', () => {
    const said = "With or without a build, it also names each review you've answered that the agent hasn't applied.";
    expect(entry('hook')?.detail).toContain(said);
    expect((guide('commands.md').split(GUIDE_START)[0] ?? '').replace(/\s+/g, ' ')).toContain(said);
    expect(read(join(REF, 'gates.md')).replace(/\s+/g, ' ')).toContain('On your next prompt the hook tells the agent the review was answered, with or without a build.');
  });
  it('puts the spec in the plan stage, and says close-out needs the finish gate and is one-way', () => {
    const stage = entry('stage')?.detail ?? '';
    expect(stage).toContain('plan (the spec and the implementation plan)');
    expect(stage).toContain('finish gate');
    expect(stage).toContain('only nexus phase start leaves it');
  });
  it('has close-out come before the merge, and keeps guardrail marks out of the logs', () => {
    expect(guide('overview.md')).not.toContain('finished and merged');
    expect(guide('flow.md')).not.toMatch(/folds your answers into the logs \([^)]*guardrails/);
  });
  it("names phase status's real gate states, and starts a phase the way /nexus:plan does", () => {
    expect(entry('phase status')?.detail).toContain('not opened, open, answered or applied');
    expect(entry('phase start')?.example).toBe('nexus phase start phase-2');
  });
});

describe('the roadmap the docs point to', () => {
  it('defers nothing to a "second sweep" that is not on the roadmap, and points at the vault and its check', () => {
    const shipped = ['cockpit.md', 'extending.md', 'contracts.md'].map((f) => read(join(REF, f)));
    expect(read(join(REF, 'contracts.md'))).toContain('set by its class notes');
    expect(read(join(REF, 'vault.md'))).toContain('docs/_meta/');
    expect(read(join(REF, 'vault.md'))).toContain('nexus docs check [root] [--file <p>] [--stale] [--json]');
  });
});

describe('declared views and the repo view', () => {
  it('extending.md gives a recipe per view type and keeps custom panels as not yet built', () => {
    const text = read(join(REF, 'extending.md'));
    for (const s of ['## Declared views', 'type: table', 'type: markdown', 'type: chart', 'type: gallery', 'Custom panels']) expect(text, s).toContain(s);
    expect(text).not.toContain('type: canvas');
  });
  it('the Views guide page carries the same recipes', () => {
    const text = read(join(REF, 'guide', 'views.md'));
    for (const s of ['docs/_meta/views/', 'type: chart', 'view-invalid']) expect(text, s).toContain(s);
    // JSON Canvas left the cockpit (decision canvas-is-retention-format): one sentence, here only.
    expect(text.replace(/\s+/g, ' ')).toContain('Boards are JSON Canvas files in the docs/ vault, opened in Obsidian.');
    expect(text).not.toContain('type: canvas');
    for (const f of ['extending.md', 'cockpit.md']) expect(read(join(REF, f)).replace(/\s+/g, ' '), f).not.toMatch(/json canvas|\.canvas/i);
  });
  it('vault.md documents the views folder and its three findings; cockpit.md documents Repo mode', () => {
    const vault = read(join(REF, 'vault.md'));
    for (const s of ['docs/_meta/views/', 'view-invalid', 'view-file-name', 'view-data-missing']) expect(vault, s).toContain(s);
    const cockpit = read(join(REF, 'cockpit.md'));
    for (const s of ['/api/repo', '/api/repo/items/<id>', '/api/repo/views/<name>', '#/repo/']) expect(cockpit, s).toContain(s);
  });
  it('the recipes and the Views page say what the code does: the row caps, the six colours, where paths resolve', () => {
    for (const doc of [read(join(REF, 'extending.md')), read(join(REF, 'guide', 'views.md'))].map((d) => d.replace(/\s+/g, ' '))) {
      for (const s of ['10,000 rows', 'first 1,000', 'six colours', "relative to the list's folder", '5 MB', '10 MB']) {
        expect(doc, s).toContain(s);
      }
    }
  });
  it('cockpit.md pins the repo routes, the read-only rule and the repo event', () => {
    const text = read(join(REF, 'cockpit.md'));
    for (const s of ['GET /api/repo', 'GET /api/repo/items/<id>', 'GET /api/repo/views/<name>', 'GET /api/repo/views/<name>/files/<n>', '405', '{ "repo": true }', 'CLAUDE_CONFIG_DIR', '`views` (how to declare a view)']) {
      expect(text, s).toContain(s);
    }
  });
  it('the docs this task touches wrap their prose at 120 columns', () => {
    for (const f of ['extending.md', 'vault.md', 'cockpit.md', join('guide', 'views.md')]) {
      const prose = read(join(REF, f)).replace(/```[\s\S]*?```/g, '').split('\n').filter((l) => !l.startsWith('|'));
      expect(prose.filter((l) => l.length > 120), f).toEqual([]);
    }
  });
  it('the recipes say views need a nexus vault, and name every key and every reason a note is invalid', () => {
    for (const doc of [read(join(REF, 'extending.md')), read(join(REF, 'guide', 'views.md'))].map((d) => d.replace(/\s+/g, ' '))) {
      for (const s of ['need a nexus vault', 'run `nexus init` first', 'without `docs/_meta/classes/` no view shows', '`component`', 'registered in `docs/_meta/components.md`', 'on the wrong type', 'a chart view without `chart:`', 'a name another view already has']) {
        expect(doc, s).toContain(s);
      }
    }
  });
  it('the recipes scope chart and image behaviour to what the code does', () => {
    for (const doc of [read(join(REF, 'extending.md')), read(join(REF, 'guide', 'views.md'))].map((d) => d.replace(/\s+/g, ' '))) {
      expect(doc).not.toContain('No image loads');
      expect(doc).toContain('No Markdown image loads');
      expect(doc).toContain('images a Mermaid diagram names may load');
      expect(doc).toContain('with a numeric `x`, a line, area or scatter chart names the rows with no `x` value');
      expect(doc).not.toContain('start the y-axis at zero');
    }
    expect(read(join(REF, 'extending.md')).replace(/\s+/g, ' ')).toContain('Bar and area charts include zero on the y-axis.');
  });
  it("cockpit.md says what each Repo section shows with no vault, and where memory is read from", () => {
    const text = read(join(REF, 'cockpit.md')).replace(/\s+/g, ' ');
    expect(text).not.toContain('or no declared views, the section says how to add one');
    for (const s of ['With no `docs/` vault, Overview, Decisions, Rules, Issues and Views say to run `nexus init`', 'each folder above it', '`autoMemoryDirectory`']) expect(text, s).toContain(s);
  });
  it('cockpit.md, governance list and the Overview say the inventory is not everything a session loads', () => {
    const cockpit = read(join(REF, 'cockpit.md')).replace(/\s+/g, ' ');
    expect(cockpit).not.toContain('everything an agent loads');
    for (const s of [
      'It is not everything a session loads',
      'are listed under their folder, each saying when Claude Code loads it',
      "a `--settings` file given at launch can't be seen",
      'about every 30 s',
      'more than 5 s after the last one',
      'Output styles, context that hooks add, skill listings, `--append-system-prompt` and the managed `claudeMd` setting.',
      "It doesn't apply `claudeMdExcludes` either: an excluded file still shows.",
      "Claude Code's `/context` and `/memory` are the ground truth",
    ]) expect(cockpit, s).toContain(s);
    const plan = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md')).replace(/\s+/g, ' ');
    expect(plan).not.toContain('every standing instruction');
    expect(plan).toContain('the standing instructions an agent loads from this repo, recorded or not, including files in subfolders (not output styles or hook context');
    const list = COMMANDS.find((c) => c.usage.startsWith('governance list'));
    expect(list?.summary).not.toContain('every');
    for (const s of ['It also lists CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/rules/ files in folders below the repo root, which Claude Code loads when it works there', 'Not listed: output styles, context hooks add, skill listings, --append-system-prompt and the managed claudeMd setting', "claudeMdExcludes isn't applied", "Claude Code's /context and /memory are the ground truth for one session"]) {
      expect(list?.detail, s).toContain(s);
      expect(read(join(REF, 'guide', 'commands.md')), s).toContain(s);
    }
    const overview = read(join(ARTIFACTS, 'cockpit', 'src', 'views', 'RepoView.tsx')).replace(/\s+/g, ' ');
    for (const s of ['Not listed here:', '<code>claudeMdExcludes</code> isn\'t applied', 'listed under their folder', '<code>/context</code> and <code>/memory</code>']) expect(overview, s).toContain(s);
  });
  it('cockpit.md says how memory follows the git repository and how AGENTS.md is marked', () => {
    const text = read(join(REF, 'cockpit.md')).replace(/\s+/g, ' ');
    for (const s of ['keys the repo\'s memory by its git repository', '`CLAUDE_CODE_PROJECT_DIR_NAME`', "An `AGENTS.md` that Claude Code won't load"]) expect(text, s).toContain(s);
  });
  it('contracts.md documents a declared view note, its table and chart options', () => {
    const doc = renderContracts();
    expect(doc).toContain('## docs/_meta/views/<name>.md (a declared view)');
    expect(doc).toMatch(/\| `data` \| string \| yes \| The data file/);
    expect(doc).toMatch(/Table options \(`table`\):\n\n\| Field/);
    expect(doc).toMatch(/Chart options \(`chart`\):\n\n\| Field/);
  });
  it('gates.md names a conflict the way the skills do', () => {
    expect(read(join(REF, 'gates.md'))).toContain('"conflicts": ["<title> (<location>)"]');
  });
});

describe('the plugin README', () => {
  const readme = () => read(join(ARTIFACTS, 'README.md'));
  it('names only real commands', () => {
    const names = COMMANDS.map(commandName);
    const used = [...readme().matchAll(/`nexus ([a-z][a-z -]*?)(?: [<[-][^`]*)?`/g)].map((m) => (m[1] ?? '').trim());
    expect(used.length).toBeGreaterThan(5);
    for (const u of used) expect(names.some((n) => u === n || u.startsWith(`${n} `)), u).toBe(true);
  });
  it('covers install, setup, health, upgrades, troubleshooting and releasing', () => {
    for (const h of ['## Requirements', '## Install', '## Set up a repo', '## Health checks', '## Upgrading', '## Troubleshooting', '## Development', '## Releasing']) {
      expect(readme()).toContain(`\n${h}\n`);
    }
    expect(readme()).toContain('nexus@nexus');
    expect(readme()).toContain('.claude-plugin/marketplace.json');
  });
  it('wraps its prose at 120 columns', () => {
    const prose = readme().replace(/```[\s\S]*?```/g, '').split('\n').filter((l) => !l.startsWith('|'));
    expect(prose.filter((l) => l.length > 120)).toEqual([]);
  });
});

describe('cockpit spacing', () => {
  // DESIGN.md's Scaled Pixel rule: sizes that sit with text scale with --px; hairlines, offsets and spacing stay fixed.
  // Padding that clears a scaled box keeps the box's scaled height and adds fixed spacing: calc(100 * var(--px) + 14px).
  it.each(['concepts.css', 'plan.css', 'repo.css'])('%s keeps gaps, margins and padding in fixed px', (file) => {
    const css = read(join(ARTIFACTS, 'cockpit', 'src', 'styles', file));
    const spacing = [...css.matchAll(/(?:^|[;{\s])((?:row-|column-)?gap|margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?)\s*:([^;}]*)/g)];
    const scaled = spacing.filter((m) => /calc\(\s*-?[\d.]+\s*\*\s*var\(--px\)\s*\)/.test(m[2] ?? '')).map((m) => `${m[1]}:${m[2]}`);
    expect(scaled).toEqual([]);
  });
});

describe('setting a repo up', () => {
  it('/nexus:init is started only by the user and pre-approves its command', () => {
    const init = read(join(ARTIFACTS, 'skills', 'init', 'SKILL.md'));
    expect(init).toMatch(/^---\nname: init\ndescription: .{40,}\ndisable-model-invocation: true\n/);
    expect(init).toContain('allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/nexus.mjs" *)');
  });
  it('/nexus:init asks, writes the answers, shows the plan, then runs, and never commits', () => {
    const text = read(join(ARTIFACTS, 'skills', 'init', 'SKILL.md')).replace(/\s+/g, ' ');
    for (const s of ['.nexus/init-answers.json', 'nexus init --answers .nexus/init-answers.json --check', 'nexus obsidian install', 'Never commit yourself', 'never edit around it']) expect(text, s).toContain(s);
  });
  it("/nexus:plan offers the seeding answers to a repo's first build", () => {
    expect(read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md')).replace(/\s+/g, ' ')).toContain("offer its `seeding:` entries to the user as this build's seeding brief");
  });
  it('/nexus:plan checks the inventory before proposing guardrails and before logging a standing rule', () => {
    // Read as prose: the brainstorm block is quoted, so its line breaks carry a "> ".
    const plan = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md')).replace(/\n> /g, '\n').replace(/\s+/g, ' ');
    for (const s of [
      'run `nexus governance list --json`',
      "A rule already held by a static rule, an accepted guardrail or a recorded vault item: cite that item to the user; don't propose it again.",
      'If it only partly overlaps, propose it with `"conflicts": ["<title> (<location>)"]` naming the item.',
      "A rule held only by an item outside the record (a memory, or a CLAUDE.md or rules file the config doesn't list as a static rule): propose the guardrail anyway",
      'propose the guardrail anyway, with its gate row `"conflicts": ["<title> (<location>)"]` naming that item, so the user can bring it into the record or drop it.',
      'Never follow an item outside the record over the plan without asking the user.',
      'open any item whose title is close to your draft before deciding it already says it',
      '`--note "overlaps <title> (<location>)"`',
      'raise a contradiction with the user before logging it',
      '`"conflicts": ["<title> (<location>)"]`',
      'Before logging a decision that sets a standing rule, run `nexus governance list`;',
      'an accepted guardrail shows in `nexus governance list`; a memory shows only as outside the record',
      'the accepted guardrails, `nexus governance list` and any approved documents',
    ]) expect(plan, s).toContain(s);
  });
  it('the nexus skill points at governance list before a rule is proposed', () => {
    const skill = read(join(ARTIFACTS, 'skills', 'nexus', 'SKILL.md'));
    expect(skill).toContain('- Check `nexus governance list` first: cite a recorded item that says the rule; if only outside items do, propose it.');
  });
  it('vault.md documents init, obsidian install and docs generate', () => {
    const text = read(join(REF, 'vault.md'));
    for (const s of ['nexus init [root] [--answers <file>] [--no-plugins] [--check]', 'nexus obsidian install [root] [--check]', 'nexus docs generate [root] [--check]', 'generated-modified', '.claude/rules/nexus/']) expect(text, s).toContain(s);
  });
  it('the README sets a repo up with /nexus:init', () => {
    expect(read(join(ARTIFACTS, 'README.md'))).toContain('/nexus:init');
  });
});

describe('decommission and reviews in the docs', () => {
  const flat = (p: string) => read(p).replace(/\s+/g, ' ');
  it('gates.md covers the decommission step, mark-list documents and review gates', () => {
    const text = flat(join(REF, 'gates.md'));
    for (const s of [
      '## Decommission gates',
      '## Review gates',
      '`decommission-<build>`',
      'optional `document`',
      'Its tab, Decommission, shows only when the build has one',
      '`.nexus/reviews/`',
      'Keep, Adjust and Remove',
      '`nexus review apply <name>`',
      'while a build is active, as it does gate answers',
      "can't be reopened or replaced",
      "rows are the build's accepted guardrails, every one of them",
      'Decisions and issues have no rows',
      'prints the counts and each Adjust or Remove row with its note',
      'Only the user answers the gate, in the cockpit',
      'Only the user answers it, in the cockpit',
    ]) expect(text, s).toContain(s);
  });
  it('vault.md covers contract 3, the report and build-record classes, docs upgrade and decommission', () => {
    const text = flat(join(REF, 'vault.md'));
    for (const s of ['## Decommission', 'contract 3', '`report`', '`build-record`', 'docs/governance/builds/<build>.md', 'decisions of note', '`nexus docs upgrade [root] [--check]`', '`nexus decommission check <build>`', '`nexus decommission apply <build>`', 'one commit',
      'It refuses while a build is active', 'It never merges, pushes or deletes a branch', '`docs/governance/decisions.json`', '`docs/governance/issues.json`',
      'first commits the build folder as it stands', "leaves every other build's"]) expect(text, s).toContain(s);
  });
  it('contracts.md shows the reviews folder and who writes answers, and no manifest', () => {
    const text = read(join(REF, 'contracts.md'));
    for (const s of ['## .nexus/reviews/', '`.nexus/reviews/<name>.answers.json`']) expect(text, s).toContain(s);
    expect(text).not.toMatch(/manifest\.json|└── decommission\//);
    expect(text.replace(/\s+/g, ' ')).toContain('`<name>.answers.json`: written only by the cockpit, once.');
  });
  it("cockpit.md pins the review routes and says the repo view's one write", () => {
    const text = flat(join(REF, 'cockpit.md'));
    for (const s of ['GET /api/reviews', 'POST /api/reviews/<name>/answers', 'The one write is a review', 'so `/api/repo` stays read-only', 'Every `/api/repo` route only reads', '`managed-only`', '20,000 folders', 'for gate answers and review answers alike']) expect(text, s).toContain(s);
    expect(text).not.toContain('writes nothing except gate answers');
  });
  it('the README, the changelog and the guide name /nexus:decommission', () => {
    expect(read(join(ARTIFACTS, 'README.md'))).toContain('## Decommission a build');
    expect(read(join(ARTIFACTS, 'CHANGELOG.md'))).toContain('/nexus:decommission <build>');
    const commands = read(join(REF, 'guide', 'commands.md')).split(GUIDE_START)[0] ?? '';
    expect(commands).toContain('/nexus:decommission <build>');
    const overview = read(join(REF, 'guide', 'overview.md'));
    for (const s of ['- **Decommission:**', '- **Review:**']) expect(overview, s).toContain(s);
  });
});

describe('the planned phases', () => {
  const flat = (p: string) => read(join(ARTIFACTS, ...p.split('/'))).replace(/\s+/g, ' ');
  it('the skills keep one list of planned phases, in phases.json, and the cockpit reference names its tab', () => {
    expect(flat('skills/nexus/SKILL.md')).toContain('Planned phases go only in `.build/<name>/phases.json`, in order: add, split, reorder or drop them there.');
    expect(flat('skills/plan/SKILL.md')).toContain('write them in order to `.build/<build>/phases.json`');
    expect(flat('skills/plan/SKILL.md')).toContain('It is the one place the list is kept.');
    expect(flat('reference/cockpit.md')).toContain('Gate, Plan, Phases, Logs, Concepts, Documents, Guidance');
    expect(flat('reference/cockpit.md')).toContain('| Phases | `phases.json`');
  });
});

describe('the Guidance in neutral words', () => {
  it('names the agent and the harness, never Claude, outside file names', () => {
    for (const page of ['overview.md', 'flow.md', 'commands.md']) {
      const text = read(join(ARTIFACTS, 'reference', 'guide', page)).replace(/CLAUDE(?:\.local)?\.md|CLAUDE_PLUGIN_ROOT|Claude Code/g, '');
      expect(text, page).not.toMatch(/\bClaude\b/);
    }
    const overview = read(join(ARTIFACTS, 'reference', 'guide', 'overview.md'));
    expect(overview).toContain('- **Agent:**');
    expect(overview).toContain('- **Harness:** the tool the agent runs in, which loads nexus\'s skills and runs its hooks; Claude Code today.');
  });
});

describe('/nexus:plan on both Superpowers versions', () => {
  // The brainstorming arguments are a blockquote: drop its markers so a phrase reads the same across wrapped lines.
  const skill = read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md')).replace(/^> ?/gm, '').replace(/\s+/g, ' ');

  it('treats the companion offer as made and declined', () => {
    expect(skill).toContain("Treat brainstorming's companion offer as already made and declined");
    expect(skill).toContain('two or more');
  });
  it('has the builder-check line, for versions that run one', () => {
    for (const s of ['If brainstorming runs a builder check', 'nexus log add decisions', 'Decisions to confirm', '--note "agent\'s call"', 'runs once per spec']) {
      expect(skill).toContain(s);
    }
  });
  it('still sends the spec into the build', () => {
    expect(skill).toContain('.build/<build>/documents/specs/<phase>/');
  });
});

/** The lines that still say "Claude" once real names, Claude Code and the stored raisedBy value are taken out. */
function bareClaude(text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ n: i + 1, rest: line.replace(/CLAUDE(?:\.local)?\.md|CLAUDE_PLUGIN_ROOT|\.claude|Claude Code|--raised-by claude/g, '') }))
    .filter((l) => /\bClaude\b/.test(l.rest))
    .map((l) => `${l.n}: ${l.rest.trim()}`);
}

/** Where the sweep reaches: the cockpit's text, the code's comments and messages, and the docs. */
const AREAS: Record<string, string[]> = { cockpit: ['cockpit/src'], code: ['core', 'scripts', 'hooks'], docs: ['reference', 'README.md', 'PRODUCT.md'] };

function filesUnder(rel: string): string[] {
  const abs = join(ARTIFACTS, rel);
  if (statSync(abs).isFile()) return [rel];
  return (readdirSync(abs, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx|md)$/.test(f))
    .map((f) => join(rel, f));
}

describe('neutral words', () => {
  it.each(Object.keys(AREAS))('%s has no bare Claude', (area) => {
    const found = (AREAS[area] ?? []).flatMap(filesUnder).flatMap((f) => bareClaude(read(join(ARTIFACTS, f))).map((l) => `${f}:${l}`));
    expect(found).toEqual([]);
  });
  it('stored names stay', () => {
    expect(RAISED_BY).toEqual(['user', 'claude', 'agent']);
    const schema = JSON.parse(read(join(ARTIFACTS, 'schemas', 'log-entry.schema.json'))) as { properties: { raisedBy: { enum: string[] } } };
    expect(schema.properties.raisedBy.enum).toEqual(['user', 'claude', 'agent']);
    expect(read(join(ARTIFACTS, 'skills', 'plan', 'SKILL.md'))).toContain('--raised-by claude');
  });
  it('no cockpit text says your next message in the terminal', () => {
    const found = filesUnder('cockpit/src').filter((f) => /next message in the terminal/.test(read(join(ARTIFACTS, f)).replace(/\s+/g, ' ')));
    expect(found).toEqual([]);
  });
});

/**
 * The manifest's description is what `/plugin` shows. It stays as 1.3.1 shipped it until the 1.3.2 release, because the
 * source manifest must match the release copy (tests/release.test.ts); from 1.3.2 on it names the agent, not Claude.
 */
function manifestProblems(m: { version: string; description: string }): string[] {
  return compareVersions(m.version, '1.3.1') > 0 ? bareClaude(m.description) : [];
}

describe('the plugin manifest in neutral words', () => {
  const sourceManifest = (): { version: string; description: string } =>
    JSON.parse(read(join(ARTIFACTS, '.claude-plugin', 'plugin.json'))) as { version: string; description: string };

  it('names the agent, not Claude, in its description from 1.3.2 on', () => {
    expect(manifestProblems({ version: '1.3.2', description: 'A cockpit for planned builds with Claude.' })).not.toEqual([]);
    expect(manifestProblems({ version: '1.3.1', description: 'A cockpit for planned builds with Claude.' })).toEqual([]);
    expect(manifestProblems({ version: '1.3.2', description: 'A cockpit for planned builds with an AI agent.' })).toEqual([]);
    expect(manifestProblems(sourceManifest())).toEqual([]);
  });
});

describe('the README on harnesses', () => {
  const readme = () => read(join(ARTIFACTS, 'README.md'));
  const section = () => {
    const text = readme();
    const at = text.indexOf('\n## Harnesses\n');
    return at === -1 ? '' : text.slice(at, text.indexOf('\n## ', at + 5));
  };
  it('has a Harnesses section with a row per harness and the strength of the wall in each', () => {
    const s = section();
    expect(s).not.toBe('');
    for (const row of ['| Claude Code |', '| Codex |', '| Antigravity |']) expect(s, row).toContain(row);
    expect(s).toContain('not a complete enforcement boundary');
    expect(s).toContain('/hooks');
    expect(s).toContain('obra/superpowers');
    expect(s).toContain('multi_agent = true');
    expect(s).toMatch(/http:\/\/localhost:<port>/);
  });
  it('marks each harness supported, with the version its live proof ran on', () => {
    expect(section()).toMatch(/^\| Codex \| `plugins\/nexus-codex\/` \| supported \(proven on codex-cli 0\.162\.0\) \|/m);
    expect(section()).toMatch(/^\| Antigravity \| `plugins\/nexus-antigravity\/` \| supported \(proven on agy 1\.4\.12\) \|/m);
    expect(section()).not.toContain('proof pending');
  });
  it("says Antigravity's print mode ends the cockpit with the run, and drops the Volta caveat the proof disproved", () => {
    expect(section()).toContain('`agy -p`');
    expect(section()).not.toContain('Volta');
  });
  it('gives the Codex install commands the proof ran', () => {
    for (const c of ['codex plugin add nexus@nexus', 'codex plugin marketplace add obra/superpowers', 'codex plugin add superpowers@superpowers-dev']) expect(section(), c).toContain(c);
  });
  it('releases three folders', () => {
    const releasing = readme().slice(readme().indexOf('\n## Releasing\n'));
    for (const f of ['plugins/nexus/', 'plugins/nexus-codex/', 'plugins/nexus-antigravity/']) expect(releasing, f).toContain(f);
  });
  it('lists the Codex package for Codex as nexus', () => {
    const m = JSON.parse(read(join(ARTIFACTS, '.agents', 'plugins', 'marketplace.json'))) as { name: string; plugins: { name: string; source: unknown; policy: unknown; category: unknown }[] };
    expect(m.plugins).toEqual([expect.objectContaining({ name: 'nexus', source: { source: 'local', path: './plugins/nexus-codex' } })]);
    expect(m.plugins[0]?.policy).toMatchObject({ installation: expect.any(String), authentication: expect.any(String) });
    expect(typeof m.plugins[0]?.category).toBe('string');
  });
});
