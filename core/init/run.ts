import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { currentHarness, type Harness } from '../harness.ts';
import { sha256 } from '../vault/generated.ts';
import { isVault } from '../vault/registry.ts';
import type { InitAnswers } from './answers.ts';
import { applyPlan, planInit, type InitPlan } from './init.ts';
import { downloadAll, pinnedDownloads, readPins, type Download, type Fetcher } from './obsidian.ts';

/** `harness`: whose files init writes; unset is the one this package was built for. */
export interface RunInitOptions { standard: string; answers: InitAnswers; fetcher: Fetcher | null; check: boolean; harness?: Harness }
export interface RunInitResult { plan: InitPlan; downloads: number | null; written: boolean; unreachable: boolean }

/** init end to end: preflight the target, download and verify, plan again with the files, then write. */
export async function runInit(root: string, opts: RunInitOptions): Promise<RunInitResult> {
  const harness = opts.harness ?? currentHarness();
  const base = { standard: opts.standard, answers: opts.answers, repoName: basename(resolve(root)), harness };
  const pre = planInit(root, { ...base, downloads: null });
  // Adding Codex or Antigravity to a repo already set up writes only that harness's files: nothing to download.
  const addsHarness = harness !== 'claude-code' && existsSync(join(root, 'docs', '_meta'));
  if (opts.fetcher === null || addsHarness) {
    const write = !opts.check && !pre.problems.length;
    if (write) applyPlan(root, pre);
    return { plan: pre, downloads: null, written: write, unreachable: false };
  }
  const list = pinnedDownloads(readPins(opts.standard));
  if (opts.check || pre.problems.length) return { plan: pre, downloads: list.length, written: false, unreachable: false };
  const got = await downloadAll(list, opts.fetcher);
  if (got.problems.length) return { plan: { actions: pre.actions, problems: got.problems }, downloads: list.length, written: false, unreachable: got.unreachable };
  const plan = planInit(root, { ...base, downloads: got.files });
  if (!plan.problems.length) applyPlan(root, plan);
  return { plan, downloads: list.length, written: !plan.problems.length, unreachable: false };
}

export interface InstallResult { present: string[]; missing: string[]; problems: string[]; written: boolean; unreachable: boolean }

/** The pinned plugin and theme files missing from an initialized vault, downloaded and verified. Never replaces a file. */
export async function runObsidianInstall(root: string, opts: { standard: string; fetcher: Fetcher; check: boolean }): Promise<InstallResult> {
  const result: InstallResult = { present: [], missing: [], problems: [], written: false, unreachable: false };
  if (!isVault(join(root, 'docs'))) return { ...result, problems: ['docs/_meta/classes/ not found: run nexus init first'] };
  const todo: Download[] = [];
  for (const d of pinnedDownloads(readPins(opts.standard))) {
    const abs = join(root, d.path);
    if (!existsSync(abs)) {
      todo.push(d);
      result.missing.push(d.path);
    } else if (sha256(readFileSync(abs)) === d.sha256) result.present.push(d.path);
    else result.problems.push(`${d.path} is there with other content; nexus won't replace it`);
  }
  if (result.problems.length || opts.check || !todo.length) return result;
  const got = await downloadAll(todo, opts.fetcher);
  if (got.problems.length) return { ...result, problems: got.problems, unreachable: got.unreachable };
  applyPlan(root, { actions: [...got.files].map(([path, data]) => ({ path, kind: 'create' as const, data })), problems: [] });
  return { ...result, written: true };
}
