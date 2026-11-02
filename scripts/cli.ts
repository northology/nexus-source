import { parseArgs } from 'node:util';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTopics } from '../core/concept-pages.ts';
import { checkNewBuild, createBuild, readBuild } from '../core/build.ts';
import { applyDecommission } from '../core/decommission/apply.ts';
import { buildCommits, commitLines, decommissionProblems } from '../core/decommission/record.ts';
import { anchorTexts, checkAnchors, findSuperpowers, readAnchors, superpowersWhere, wallStrength, type AnchorText } from '../core/doctor.ts';
import { activeBuilds, changeStage } from '../core/lifecycle.ts';
import { NexusError } from '../core/errors.ts';
import { currentBranch, insideGit } from '../core/git.ts';
import { applyAnswers, indexPlanGate, openGate, type ApplySummary, type GateInput } from '../core/gates.ts';
import { describeStatus, phaseStatus } from '../core/status.ts';
import { addEntry, assertLogName, setStatus } from '../core/logs.ts';
import { checkPhaseStart, currentPhase, startPhase } from '../core/phases.ts';
import { indexLine } from '../core/plan.ts';
import { currentPlanFor, stateText, summarize } from '../core/plan-text.ts';
import { importRun } from '../core/progress.ts';
import { proposeGuardrail, withdrawGuardrail } from '../core/guardrails.ts';
import { findBuildRoot, findRepoRoot, listBuilds, resolveBuild } from '../core/paths.ts';
import { LOG_STATUSES } from '../core/schema-files.ts';
import { readSnapshot } from '../core/snapshot.ts';
import { readJson } from '../core/store.ts';
import { isoNow } from '../core/time.ts';
import type { LogEntry } from '../core/types.ts';
import { runGuard, type GuardInput } from '../hooks/guard.ts';
import { runHook } from '../hooks/hook.ts';
import { doctorDocs } from '../core/vault/doctor.ts';
import { findVaultRoot } from '../core/vault/paths.ts';
import { EMPTY_ANSWERS, readAnswers } from '../core/init/answers.ts';
import { describePlan } from '../core/init/init.ts';
import { fetchBytes, mirrorFetcher, type Fetcher } from '../core/init/obsidian.ts';
import { runInit, runObsidianInstall } from '../core/init/run.ts';
import { checkVault } from '../core/vault/check.ts';
import { exitCode, formatReport } from '../core/vault/format.ts';
import { applyGenerate, planGenerate } from '../core/vault/generate.ts';
import { applyUpgrade, planUpgrade, upgradeRefusal } from '../core/vault/upgrade.ts';
import { CONTRACT_VERSION } from '../core/vault/types.ts';
import { inventoryEnv } from '../core/governance/env.ts';
import { formatInventory, formatSetting, outsideOnly } from '../core/governance/format.ts';
import { fullInventory } from '../core/governance/inventory.ts';
import { applyReview, listReviews, openReview } from '../core/reviews.ts';
import { runDocsCheck } from './docs-check.ts';
import { COMMANDS, commandName, usageLine } from './commands.ts';
import { startServer } from '../server/server.ts';
import { currentHarness, skillCommand } from '../core/harness.ts';
import { adapterFor } from '../hooks/adapters/index.ts';

export interface CliIO {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  now(): string;
  readStdin(): Promise<string>;
  env: Record<string, string | undefined>;
}

const LOG_LINE = (['decisions', 'questions', 'issues', 'changes'] as const).map((l) => `${l} (${LOG_STATUSES[l].join(', ')})`).join(' · ');

export const USAGE = `nexus: a temporary cockpit for one build
Usage: node nexus.mjs <command> [options]

${COMMANDS.map(usageLine).join('\n')}

  --build <name> picks the build when a checkout holds more than one.
  Logs and statuses: ${LOG_LINE}`;

const OPTIONS = {
  build: { type: 'string' },
  summary: { type: 'string' },
  branch: { type: 'string' },
  phase: { type: 'string' },
  text: { type: 'string' },
  status: { type: 'string' },
  source: { type: 'string' },
  note: { type: 'string' },
  quote: { type: 'string' },
  'raised-by': { type: 'string' },
  accepted: { type: 'boolean' },
  check: { type: 'boolean' },
  commit: { type: 'string' },
  topic: { type: 'string' },
  path: { type: 'string' },
  port: { type: 'string' },
  open: { type: 'boolean' },
  cockpit: { type: 'string' },
  file: { type: 'string' },
  stale: { type: 'boolean' },
  json: { type: 'boolean' },
  answers: { type: 'string' },
  'no-plugins': { type: 'boolean' },
  outside: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Opts = { [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]['type'] extends 'boolean' ? boolean : string };

export async function main(argv: string[], io: CliIO): Promise<number> {
  let values: Opts;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }));
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  if (positionals.length === 0) {
    io.out(USAGE);
    return 2;
  }
  try {
    return await run(positionals, values, io);
  } catch (e) {
    if (e instanceof NexusError) {
      io.err(`nexus: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new NexusError(`Missing ${what}`);
  return value;
}

/** The commands that act on the checkout's build, which `--build` picks: those the dispatch reaches `resolveBuild` for. */
const BUILD_COMMANDS = new Set(['phase', 'stage', 'guardrail', 'log', 'gate', 'check', 'ledger', 'plan']);

const flagsOf = (usage: string): string[] => [...usage.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1] ?? '');
const inWords = (items: string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`);

/**
 * Why a command (named by its first words) doesn't take one of `flags`, or null. A command takes the flags its usage
 * line names, `--help`, and `--build` when it acts on the checkout's build; any other would be dropped without a word,
 * so it's refused. A command the table doesn't know is left to fail on its own.
 */
export function strayFlag(words: string[], flags: string[]): string | null {
  const spec = COMMANDS.find((c) => commandName(c) === words.slice(0, 2).join(' ')) ?? COMMANDS.find((c) => commandName(c) === (words[0] ?? ''));
  if (!spec) return null;
  for (const flag of flags) {
    if (flag === 'help' || flagsOf(spec.usage).includes(flag)) continue;
    if (flag === 'build') {
      if (BUILD_COMMANDS.has(words[0] ?? '')) continue;
      return `--build is only used by commands that act on the checkout's build, not \`nexus ${commandName(spec)}\``;
    }
    const users = COMMANDS.filter((c) => flagsOf(c.usage).includes(flag)).map((c) => `\`nexus ${commandName(c)}\``);
    return `--${flag} is only used by ${inWords(users)}`;
  }
  return null;
}

async function run(p: string[], o: Opts, io: CliIO): Promise<number> {
  const [cmd, ...rest] = p;
  const stray = strayFlag(p, Object.keys(o).filter((k) => o[k as keyof Opts] !== undefined));
  if (stray) throw new NexusError(stray);

  if (cmd === 'hook') {
    try {
      const raw = await io.readStdin();
      let input: { cwd?: unknown } = {};
      try {
        input = JSON.parse(raw || '{}') as { cwd?: unknown };
      } catch {
        input = {};
      }
      const adapter = adapterFor(currentHarness());
      const hookInput = adapter.toHookInput(input);
      const out = adapter.toHookOutput(hookInput ? runHook(hookInput, { cli: cliPath(io), now: new Date() }) : '');
      if (out) io.out(out);
    } catch {
      // A hook must never block the user's prompt.
    }
    return 0;
  }

  if (cmd === 'guard') {
    const raw = await io.readStdin();
    let input: GuardInput = {};
    try {
      input = JSON.parse(raw || '{}') as GuardInput;
    } catch {
      input = {};
    }
    const text = runGuard(input, { home: homedir(), win: process.platform === 'win32', now: new Date() });
    if (text) io.out(text);
    return 0;
  }

  if (cmd === 'builds') {
    const root = findBuildRoot(io.cwd);
    const names = root ? listBuilds(root) : [];
    if (!root || !names.length) {
      io.out('No builds in this checkout.');
      return 0;
    }
    // "active" comes from the same check the wall uses, so the two always agree.
    const active = new Set(activeBuilds(root));
    const rows = names.map((name) => {
      const state = active.has(name) ? 'active' : 'finished';
      try {
        const b = readBuild(root, name);
        return [name, `phase ${currentPhase(b)}`, `stage ${b.stage}`, state, b.branch];
      } catch (e) {
        const reason = (e as Error).message.replace(/\s+/g, ' ').trim();
        return [name, `unreadable: ${reason}`, state];
      }
    });
    // Every name sets the first column's width; only readable rows (five cells) set the rest. An unreadable row prints
    // as name, reason, state, with its name padded into the first column.
    const readable = rows.filter((r) => r.length === 5);
    const widths = [0, 1, 2, 3].map((i) => Math.max(...(i === 0 ? rows : readable).map((r) => (r[i] ?? '').length)));
    for (const r of rows) {
      const cells = r.length === 5 ? r.map((c, i) => c.padEnd(widths[i] ?? 0)) : [(r[0] ?? '').padEnd(widths[0] ?? 0), ...r.slice(1)];
      io.out(cells.join('  ').trimEnd());
    }
    return 0;
  }

  if (cmd === 'new') {
    const name = need(rest[0], 'a build name');
    const root = findRepoRoot(io.cwd);
    if (o.check) {
      const c = checkNewBuild(root, { name, ...(o.phase !== undefined ? { phase: o.phase } : {}) });
      io.out(`ok: would start build "${c.name}" with phase "${c.phase}"`);
      return 0;
    }
    const dir = createBuild(root, { name, ...(o.summary !== undefined ? { summary: o.summary } : {}), branch: o.branch ?? branchLabel(root), now: io.now(), ...(o.phase !== undefined ? { phase: o.phase } : {}) });
    io.out(`Started build "${name}" in ${relative(io.cwd, dir) || '.'}`);
    return 0;
  }

  if (cmd === 'serve') {
    const root = findRepoRoot(io.cwd);
    const cockpitDir = o.cockpit ? resolve(io.cwd, o.cockpit) : (io.env['NEXUS_COCKPIT_DIR'] ?? defaultCockpitDir());
    const port = o.port === undefined ? 4410 : Number(o.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new NexusError('--port must be a whole number from 0 to 65535');
    const running = await startServer({ root, cockpitDir, port });
    for (const line of serveLines(running)) io.out(line);
    if (o.open) openBrowser(running.url);
    return 0;
  }

  if (cmd === 'init') {
    const root = resolve(io.cwd, rest[0] ?? '.');
    if (!existsSync(root)) throw new NexusError(`${rest[0] ?? root} doesn't exist`);
    const answers = o.answers ? readAnswers(resolve(io.cwd, o.answers)) : EMPTY_ANSWERS;
    for (const line of overrideLines(io)) io.out(line);
    const r = await runInit(root, { standard: standardDir(io), answers, fetcher: o['no-plugins'] ? null : fetcherFor(io), check: Boolean(o.check) });
    if (r.plan.problems.length) {
      io.err('nexus init: stopped; nothing was written:');
      for (const p of r.plan.problems) io.err(`- ${p}`);
      if (r.unreachable) io.err(OFFLINE_HINT);
      return 1;
    }
    io.out(`nexus init: ${o.check ? 'would set up' : 'set up'} ${root}`);
    for (const line of describePlan(r.plan)) io.out(line);
    if (r.downloads === null) io.out('  skip     plugins and theme (--no-plugins): run `nexus obsidian install` later');
    else if (o.check) io.out(`  download ${r.downloads} pinned plugin and theme files`);
    if (!r.written) return 0;
    const gen = planGenerate(root);
    applyGenerate(root, gen);
    io.out(`  generate ${gen.writes.length} written`);
    const report = checkVault(root);
    io.out(formatReport(report).at(-1) ?? '');
    return exitCode(report);
  }

  if (cmd === 'obsidian') {
    if (rest[0] !== 'install') throw new NexusError('Use `obsidian install [root] [--check]`');
    const root = resolve(io.cwd, rest[1] ?? '.');
    for (const line of overrideLines(io)) io.out(line);
    const r = await runObsidianInstall(root, { standard: standardDir(io), fetcher: fetcherFor(io), check: Boolean(o.check) });
    if (r.problems.length) {
      io.err('nexus obsidian install: stopped; nothing was written:');
      for (const p of r.problems) io.err(`- ${p}`);
      if (r.unreachable) io.err('No network? Run it again once online.');
      return 1;
    }
    io.out(`${r.present.length} pinned files in place, ${r.missing.length} ${o.check ? 'to download' : 'downloaded'}`);
    return 0;
  }

  if (cmd === 'governance') {
    if (rest[0] !== 'list') {
      io.err('nexus: Use `governance list [root] [--json] [--outside]`');
      return 2;
    }
    const root = rest[1] ? resolve(io.cwd, rest[1]) : findRepoRoot(io.cwd);
    for (const k of ['NEXUS_INVENTORY_CEILING', 'NEXUS_INVENTORY_MANAGED']) if (io.env[k]) io.err(`nexus: using ${k}=${io.env[k] ?? ''}`);
    const inv = fullInventory(root, inventoryEnv(io.env));
    if (o.json) io.out(JSON.stringify(o.outside ? outsideOnly(inv) : inv, null, 2));
    else {
      for (const l of formatInventory(inv, { outside: Boolean(o.outside) })) io.out(l);
      if (inv.setting) io.out(formatSetting(inv.setting));
    }
    return 0;
  }

  if (cmd === 'review') {
    const root = findRepoRoot(io.cwd);
    if (rest[0] === 'open') {
      const file = resolve(io.cwd, need(rest[1], 'a request file'));
      let data: unknown;
      try {
        data = readJson(file);
      } catch (e) {
        throw new NexusError(`Could not read ${rest[1] ?? ''}: ${(e as Error).message}`);
      }
      const r = openReview(root, data as GateInput, io.now(), inventoryEnv(io.env));
      const n = r.items?.length ?? 0;
      io.out(`Opened review "${r.name}" (${n} row${n === 1 ? '' : 's'}). It is waiting in the cockpit's Repo view.`);
      return 0;
    }
    if (rest[0] === 'apply') {
      const name = need(rest[1], 'a review name');
      const a = applyReview(root, name, io.now());
      const rows = Object.entries(a.marks);
      const count = (m: string) => rows.filter(([, v]) => v === m).length;
      io.out(`Applied review "${name}": ${count('accepted')} kept, ${count('research')} to adjust, ${count('declined')} to remove. Its permits are closed.`);
      for (const [row, mark] of rows) {
        if (mark === 'accepted') continue;
        // Own keys only: a row named constructor must not print a prototype function as its note.
        const note = Object.hasOwn(a.notes, row) ? a.notes[row] : undefined;
        const target = Object.hasOwn(a.targets, row) ? a.targets[row] : undefined;
        io.out(`  ${mark === 'declined' ? 'remove' : 'adjust'}  ${row} · ${target ?? '(no longer listed or reviewable)'}${note ? ` · note: ${note}` : ''}`);
      }
      return 0;
    }
    if (rest[0] === 'list') {
      const problems: string[] = [];
      const states = listReviews(root, problems);
      if (!states.length && !problems.length) io.out('No reviews in this repo.');
      for (const s of states) io.out(`${s.request.name}  ${s.answers === null ? 'waiting' : s.read === null ? 'answered' : 'applied'}  ${s.request.title}`);
      for (const p of problems) io.err(`nexus: ${p}`);
      return 0;
    }
    throw new NexusError('Use `review open <request.json>`, `review apply <name>` or `review list`');
  }

  if (cmd === 'docs') {
    if (rest[0] === 'upgrade') {
      const root = rest[1] ? resolve(io.cwd, rest[1]) : (findVaultRoot(io.cwd) ?? io.cwd);
      for (const line of overrideLines(io)) io.out(line);
      const plan = planUpgrade(root, standardDir(io));
      const blocked = upgradeRefusal(root);
      const refusal = plan.problems[0] ?? (o.check ? null : blocked);
      if (refusal) {
        io.err(`nexus docs upgrade: ${refusal}`);
        return 1;
      }
      if (!plan.adds.length && !plan.contract) {
        io.out(`nexus docs upgrade: the vault already follows contract ${CONTRACT_VERSION}`);
        return 0;
      }
      const lines = plan.adds.map((a) => `  add      ${a.path}`);
      if (plan.contract) lines.push(`  contract ${plan.contract.from === null ? 'none' : String(plan.contract.from)} → ${plan.contract.to}`);
      if (o.check) {
        for (const line of lines) io.out(line);
        if (blocked) io.out(`  blocked  ${blocked}`);
        io.out(`nexus docs upgrade --check: ${plan.adds.length} to add; nothing written`);
        return 0;
      }
      applyUpgrade(root, plan);
      for (const line of lines) io.out(line);
      io.out(`nexus docs upgrade: ${plan.adds.length} added; the vault follows contract ${CONTRACT_VERSION}`);
      return 0;
    }
    if (rest[0] === 'generate') {
      const root = rest[1] ? resolve(io.cwd, rest[1]) : (findVaultRoot(io.cwd) ?? io.cwd);
      const plan = planGenerate(root);
      if (o.check) {
        for (const i of plan.issues) io.out(`  ${i.kind.padEnd(8)} ${i.file}`);
        io.out(`${plan.expected.size} generated files expected: ${plan.issues.length} to fix`);
        return plan.issues.length ? 1 : 0;
      }
      applyGenerate(root, plan);
      io.out(`nexus docs generate: ${plan.writes.length} written, ${plan.removes.length} removed`);
      for (const f of plan.writes) io.out(`  write    ${f}`);
      for (const f of plan.removes) io.out(`  remove   ${f}`);
      return 0;
    }
    if (rest[0] !== 'check') throw new NexusError('Use `docs check [root] [--file <path>] [--stale] [--json]`, `docs generate [root] [--check]` or `docs upgrade [root] [--check]`');
    const args = [...(rest[1] ? [rest[1]] : []), ...(o.file ? ['--file', o.file] : []), ...(o.stale ? ['--stale'] : []), ...(o.json ? ['--json'] : [])];
    return runDocsCheck(args, { cwd: io.cwd, out: io.out, err: io.err, readStdin: io.readStdin });
  }

  if (cmd === 'doctor') {
    if (rest[0] === 'docs') {
      const root = findVaultRoot(io.cwd) ?? findRepoRoot(io.cwd);
      const results = doctorDocs(root, {
        bundle: fileURLToPath(new URL('./docs-check.mjs', import.meta.url)),
        hooks: fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)),
      });
      for (const r of results) {
        if (r.ok) io.out(`ok    ${r.text}`);
        else io.err(`FAIL  ${r.text}`);
      }
      return results.every((r) => r.ok) ? 0 : 1;
    }
    if (rest[0] === 'guard') {
      io.out(wallStrength(currentHarness()));
      // The wall's hook loads this bundle from beside the CLI; when it can't, the wall refuses writes during a build.
      try {
        const mod = (await import(new URL('./guard-core.mjs', import.meta.url).href)) as { runGuard?: unknown };
        if (typeof mod.runGuard !== 'function') throw new Error('guard-core.mjs has no runGuard export');
        io.out('ok    the guard bundle loads');
      } catch (e) {
        const first = (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0] ?? '';
        io.err(`FAIL  The guard bundle didn't load: ${first}. Rebuild the plugin (pnpm build) or reinstall it.`);
        return 1;
      }
      // The hook runs bin/guard.mjs itself: an empty input must pass through it and out, silently.
      const entry = spawnSync(process.execPath, [fileURLToPath(new URL('./guard.mjs', import.meta.url))], { input: '{}', encoding: 'utf8' });
      if (entry.status === 0) {
        io.out('ok    the hook entry runs');
        return 0;
      }
      io.err(`FAIL  The hook entry didn't run (exit ${String(entry.status)}): ${(entry.stderr || '').split(/\r?\n/)[0] ?? ''}. Rebuild the plugin (pnpm build) or reinstall it.`);
      return 1;
    }
    if (rest[0] !== 'superpowers') throw new NexusError('Use `doctor guard`, `doctor docs` or `doctor superpowers [--path <version folder>]`');
    const harness = currentHarness();
    const codexHome = io.env['CODEX_HOME'];
    const dir = o.path ? resolve(io.cwd, o.path) : findSuperpowers(homedir(), harness, codexHome ? { codexHome: resolve(codexHome) } : {});
    if (!dir) throw new NexusError(`Could not find Superpowers under ${superpowersWhere(harness)}. Pass --path <version folder>.`, 404);
    const anchors = readAnchors(fileURLToPath(new URL('../reference/superpowers.md', import.meta.url)));
    const results = checkAnchors(dir, anchors);
    io.out(`Superpowers at ${dir}`);
    const wording = (t: AnchorText): string => `"${t.text}"${t.version ? ` (${t.version}${t.file ? `, in ${t.file}` : ''})` : ''}`;
    for (const r of results) {
      if (r.matched) io.out(`ok    ${r.anchor.file}: ${wording(r.matched)}`);
      else io.err(`FAIL  ${r.anchor.file}: ${anchorTexts(r.anchor).map(wording).join(' or ')}. ${r.anchor.breaks}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    io.out(failed ? `${failed} of ${results.length} anchors are missing. Read reference/superpowers.md before relying on ${skillCommand('plan')}.` : `All ${results.length} anchors found.`);
    return failed ? 1 : 0;
  }

  if (cmd === 'decommission') {
    if (rest[0] !== 'check' && rest[0] !== 'apply') throw new NexusError('Use `decommission check <build>` or `decommission apply <build>`');
    const root = findBuildRoot(io.cwd);
    if (!root) throw new NexusError('No .build/ folder here or above, so there is no build to decommission.', 404);
    const build = resolveBuild(root, need(rest[1], 'a build name'));
    if (rest[0] === 'apply') {
      const a = applyDecommission(root, build, { standard: standardDir(io), env: io.env });
      const folder = a.left ? `${a.left}/ is still held open: remove it once nothing uses it (\`git clean -fd ${a.left}/\`).` : `.build/${build}/ removed.`;
      io.out(`Decommissioned "${build}" in one commit (${a.commit.slice(0, 7)}): ${a.archived.length} archived, ${a.decisions} decisions and ${a.issues} issues logged, ${a.generated.length} generated; the record is ${a.buildRecord}; ${folder}`);
      if (a.upgraded.length) io.out(`  the vault was upgraded: ${a.upgraded.join(', ')}`);
      return 0;
    }
    const problems = decommissionProblems(root, build, 'check');
    if (problems.length) {
      io.err(`nexus decommission check: "${build}" isn't ready; nothing was changed:`);
      for (const pr of problems) io.err(`- ${pr}`);
      return 1;
    }
    for (const l of commitLines(buildCommits(root, build))) io.out(l);
    io.out(`nexus decommission check: "${build}" can be decommissioned`);
    return 0;
  }

  const root = findBuildRoot(io.cwd);
  if (!root) throw new NexusError('No .build/ folder here or above. Start a build with `nexus new <name>`.', 404);
  const build = resolveBuild(root, o.build);

  switch (cmd) {
    case 'stage': {
      const stage = need(rest[0], 'a stage');
      changeStage(root, build, stage, io.now());
      io.out(`Stage set to ${stage}`);
      return 0;
    }
    case 'guardrail':
      return guardrailCommand(root, build, rest, o, io);
    case 'log':
      return logCommand(root, build, rest, o, io);
    case 'gate':
      return gateCommand(root, build, rest, io);
    case 'phase': {
      if (rest[0] === 'status') {
        io.out(describeStatus(phaseStatus(root, build, new Date(io.now()))));
        return 0;
      }
      if (rest[0] !== 'start') throw new NexusError('Use `phase start <name> [--branch <b>]` or `phase status`');
      const phaseName = need(rest[1], 'a phase name');
      if (o.check) {
        checkPhaseStart(root, build, phaseName);
        io.out(`ok: would start phase "${phaseName}" of build "${build}"`);
        return 0;
      }
      const next = startPhase(root, build, phaseName, { branch: o.branch ?? branchLabel(root), now: io.now() });
      const count = next.phases?.length ?? 1;
      io.out(`Started phase "${next.phase}" (${count} of ${count}) at stage planning.`);
      return 0;
    }
    case 'check': {
      const snapshot = readSnapshot(root, build);
      if (!snapshot.problems.length) {
        io.out(`${build}: every file is valid`);
        return 0;
      }
      for (const pr of snapshot.problems) io.err(`${pr.file}: ${pr.message}`);
      return 1;
    }
    case 'ledger': {
      if (rest[0] !== 'import') throw new NexusError('Use `ledger import <progress.md>`');
      const file = resolve(io.cwd, need(rest[1], 'a ledger file'));
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (e) {
        throw new NexusError(`Could not read ${rest[1]}: ${(e as Error).message}`);
      }
      const r = importRun(root, build, text, file, io.now());
      io.out(`Imported ${r.rulings} rulings and ${r.minors} deferred minors (${r.skipped} already there).`);
      if (r.noRecord) io.out(`plan.json can't be read (${unnamed(r.noRecord)}), so no task record was kept.`);
      else io.out(r.plan ? `Kept the task record for "${r.plan}": ${r.done} of ${r.total} tasks done.` : 'This ledger names no indexed plan, so no task record was kept.');
      if (r.asBuilt) io.out(`Kept the run's as-built notes at ${r.asBuilt}.`);
      if (r.noNotes) io.out(`The run's as-built notes can't be read (${unnamed(r.noNotes)}), so none were kept.`);
      return 0;
    }
    case 'plan': {
      if (rest[0] === 'index') {
        const gate = need(rest[1], 'a plan gate name');
        io.out(indexLine(indexPlanGate(root, build, gate, io.now()), gate));
        return 0;
      }
      if (rest.length) throw new NexusError('Use `plan [--phase <name>]` or `plan index <gate>`');
      const snapshot = readSnapshot(root, build);
      const unreadable = snapshot.problems.find((pr) => pr.file === 'plan.json');
      if (unreadable) {
        io.err(`plan.json can't be read: ${unnamed(unreadable.message)}`);
        return 1;
      }
      const phase = o.phase ?? currentPhase(readBuild(root, build));
      const plan = currentPlanFor(snapshot.plan, phase);
      if (!plan) {
        io.out(`No approved plan for ${phase} yet. It appears once its plan gate is approved.`);
        return 0;
      }
      const progress = snapshot.planProgress[plan.id];
      const s = summarize(plan, progress);
      io.out(`${plan.title} (${plan.phase}, approved at ${plan.gate})`);
      io.out(s.when ? `${s.text} · ${s.when.label} ${utcMinute(s.when.time)}` : s.text);
      if (s.notice) io.out(s.notice);
      const rows = plan.tasks.map((t): [string, string, string] => {
        const p = progress?.tasks[t.id];
        return [p ? stateText(p) : 'pending', t.title, p?.commits ?? ''];
      });
      const stateWidth = Math.max(0, ...rows.map((r) => r[0].length));
      const titleWidth = Math.max(0, ...rows.map((r) => r[1].length));
      for (const [state, title, commits] of rows) io.out(`${state.padEnd(stateWidth)}  ${title.padEnd(titleWidth)}  ${commits}`.trimEnd());
      if (!rows.length) io.out(`${plan.document.split('/').at(-1) ?? plan.document} has no tasks nexus can read.`);
      return 0;
    }
    default:
      throw new NexusError(`Unknown command "${cmd}"\n\n${USAGE}`);
  }
}

/** An error message without its leading "plan.json ", for lines that already say plan.json. */
export function unnamed(message: string): string {
  return message.replace(/^plan\.json (?:is |cannot be read: )?/, '');
}

/** A stored time, shown as 2026-10-04 19:12 UTC whatever offset it was written with. */
export function utcMinute(time: string): string {
  const at = new Date(time);
  return Number.isNaN(at.getTime()) ? time : `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function knownTopic(root: string, build: string, topic: string): string {
  const topics = buildTopics(root, build);
  if (topics.includes(topic)) return topic;
  throw new NexusError(topics.length ? `No concept topic "${topic}" in this build. Topics: ${topics.join(', ')}.` : 'This build has no concept topics yet.');
}

function logCommand(root: string, build: string, rest: string[], o: Opts, io: CliIO): number {
  const [action, logArg, name, status] = rest;
  const log = need(logArg, 'a log name (decisions, issues, changes, questions)');
  assertLogName(log);
  if (log === 'guardrails') throw new NexusError('Guardrails have their own command: `nexus guardrail propose|withdraw|list`.');
  if (action === 'add') {
    const entry: LogEntry = {
      name: need(name, 'an entry name'),
      text: need(o.text, '--text'),
      status: need(o.status, '--status'),
      source: need(o.source, '--source'),
      time: io.now(),
      phase: currentPhase(readBuild(root, build)),
      ...(o.note ? { note: o.note } : {}),
      ...(o.quote ? { quote: o.quote } : {}),
      ...(o.commit ? { commit: o.commit } : {}),
      ...(o.topic ? { topic: knownTopic(root, build, o.topic) } : {}),
    };
    addEntry(root, build, log, entry);
    io.out(`Added "${entry.name}" to the ${log} log`);
    return 0;
  }
  if (action === 'status') {
    const entry = setStatus(root, build, log, need(name, 'an entry name'), need(status, 'a status'));
    io.out(`"${entry.name}" is now ${entry.status}`);
    return 0;
  }
  throw new NexusError('Use `log add` or `log status`');
}

function gateCommand(root: string, build: string, rest: string[], io: CliIO): number {
  const [action, arg] = rest;
  if (action === 'open') {
    const file = resolve(io.cwd, need(arg, 'a request file'));
    let data: unknown;
    try {
      data = readJson(file);
    } catch (e) {
      throw new NexusError(`Could not read ${arg}: ${(e as Error).message}`);
    }
    const input = data as GateInput;
    const request = openGate(root, build, { ...input, phase: input.phase ?? currentPhase(readBuild(root, build)) }, io.now());
    io.out(`Opened gate "${request.name}" (${request.type}). It is waiting in the cockpit.`);
    return 0;
  }
  if (action === 'apply') {
    io.out(describeApply(applyAnswers(root, build, need(arg, 'a gate name'), io.now())));
    return 0;
  }
  throw new NexusError('Use `gate open` or `gate apply`');
}

function guardrailCommand(root: string, build: string, rest: string[], o: Opts, io: CliIO): number {
  const [action, name] = rest;
  if (action === 'propose') {
    const entry = proposeGuardrail(
      root,
      build,
      {
        name: need(name, 'a guardrail name'),
        text: need(o.text, '--text'),
        source: need(o.source, '--source'),
        raisedBy: need(o['raised-by'], '--raised-by (user, claude or agent)'),
        phase: currentPhase(readBuild(root, build)),
        ...(o.quote ? { quote: o.quote } : {}),
        ...(o.note ? { note: o.note } : {}),
      },
      io.now(),
    );
    io.out(`Proposed guardrail "${entry.name}". It applies only once the user accepts it at a gate.`);
    return 0;
  }
  if (action === 'withdraw') {
    io.out(`Withdrew guardrail "${withdrawGuardrail(root, build, need(name, 'a guardrail name'), readSnapshot(root, build).gates).name}"`);
    return 0;
  }
  if (action === 'list') {
    const views = readSnapshot(root, build, { progress: false }).guardrails;
    if (o.accepted) {
      const accepted = views.filter((v) => v.state === 'accepted');
      io.out(accepted.length ? accepted.map((v) => `- ${v.entry.text} (${v.entry.name})`).join('\n') : 'No accepted guardrails yet.');
      return 0;
    }
    if (!views.length) io.out('No guardrails in this build yet.');
    for (const v of views) io.out(`${v.state.padEnd(9)} ${v.entry.name}: ${v.entry.text}`);
    return 0;
  }
  throw new NexusError('Use `guardrail propose`, `guardrail withdraw` or `guardrail list`');
}

/** What `nexus serve` prints: the cockpit, then the origin concept pages are served from (a free port per start). */
export function serveLines(running: { url: string; assets: string }): string[] {
  return [`nexus cockpit: ${running.url}`, `nexus concept pages: ${running.assets}`];
}

function describeApply(s: ApplySummary): string {
  const lines = [`Applied gate "${s.gate}".`];
  if (s.type === 'mark-list') {
    lines.push(`Accepted: ${s.accepted.join(', ') || 'none'}`, `Research: ${s.research.join(', ') || 'none'}`, `Declined: ${s.declined.join(', ') || 'none'}`);
    if (s.closed.length) lines.push(`Closed questions: ${s.closed.join(', ')}`);
    if (s.reopened.length) lines.push(`Reopened as questions: ${s.reopened.join(', ')}`);
  }
  if (s.choice) lines.push(`Picked: ${s.choice}`);
  if (s.choices) lines.push(`Combine: ${s.choices.join(', ')}`);
  if (s.none) lines.push('None of these.');
  if (s.decision) lines.push(s.decision === 'approve' ? 'Approved.' : 'Sent back.');
  if (s.log === 'guardrails') lines.push("Guardrail marks stay in the answers file; `nexus guardrail list` shows each guardrail's state.");
  if (s.rowNotes) lines.push('Row notes:', ...Object.entries(s.rowNotes).map(([row, note]) => `- ${row}: ${note}`));
  if (s.note) lines.push(`Note from the user: ${s.note}`);
  if (s.next) lines.push(`Next: ${s.next}`);
  if (s.indexed) lines.push(indexLine(s.indexed, s.gate));
  lines.push('Commit the build folder to record this review.');
  return lines.join('\n');
}

/** The branch a new build or phase records: the checked-out branch, 'detached', or 'none' outside git. */
function branchLabel(root: string): string {
  if (!insideGit(root)) return 'none';
  return currentBranch(root) ?? 'detached';
}

/** The command as the agent should run it: forward slashes, so it matches the skill's allowed-tools rule. */
function cliPath(io: CliIO): string {
  const pluginRoot = io.env['CLAUDE_PLUGIN_ROOT'];
  const path = pluginRoot ? `${pluginRoot.replace(/[\\/]+$/, '')}/bin/nexus.mjs` : (process.argv[1] ?? 'nexus.mjs');
  return path.replace(/\\/g, '/');
}

/** standard/ beside the CLI (nexus/standard in source, dist/nexus/standard when built), or NEXUS_STANDARD_DIR. */
function standardDir(io: CliIO): string {
  return io.env['NEXUS_STANDARD_DIR'] ?? fileURLToPath(new URL('../standard/', import.meta.url));
}

/** The network, or NEXUS_OBSIDIAN_MIRROR: a local folder laid out as <host>/<path>. */
function fetcherFor(io: CliIO): Fetcher {
  const mirror = io.env['NEXUS_OBSIDIAN_MIRROR'];
  return mirror ? mirrorFetcher(mirror) : fetchBytes;
}

const OFFLINE_HINT = 'No network? Run `nexus init --no-plugins` now and `nexus obsidian install` once online.';

/** One line per override in force, so a variable left over from a test session can't change what init writes unseen. */
function overrideLines(io: CliIO): string[] {
  return ['NEXUS_STANDARD_DIR', 'NEXUS_OBSIDIAN_MIRROR'].flatMap((k) => (io.env[k] ? [`nexus: using ${k}=${io.env[k]}`] : []));
}

function defaultCockpitDir(): string {
  return fileURLToPath(new URL('../cockpit/', import.meta.url));
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(command as string, args as string[], () => {});
}

/** Reads a stream to its end. A stream that errors rejects, so the caller decides: the hook ignores it, the guard fails as it always did. */
export function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((done, fail) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => (data += chunk));
    stream.on('end', () => done(data));
    stream.on('error', fail);
  });
}

export function defaultIO(): CliIO {
  return {
    cwd: process.cwd(),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    now: () => isoNow(),
    readStdin: () => (process.stdin.isTTY ? Promise.resolve('') : readStream(process.stdin)),
    env: process.env,
  };
}
