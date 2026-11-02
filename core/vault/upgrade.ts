import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { NexusError } from '../errors.ts';
import { activeBuilds } from '../lifecycle.ts';
import { META, isVault, readRegistry } from './registry.ts';
import { CONTRACT_VERSION } from './types.ts';

/** `adds`: standard registry files the vault lacks; `contract`: the number change, or null when it already matches. */
export interface UpgradePlan { adds: { path: string; data: string }[]; contract: { from: number | null; to: number } | null; problems: string[] }

const nothing = (problem: string): UpgradePlan => ({ adds: [], contract: null, problems: [problem] });

const CONTRACT_LINE = `docs/${META}/contract.md has no contract: line to raise; fix it before upgrading`;

/**
 * contract.md with its frontmatter `contract:` number set to `to`; null when no such line is there. A trailing comment
 * and a leading byte-order mark stay, `1.0` becomes a plain integer, and a body line never counts.
 */
function raiseContract(text: string, to: number): string | null {
  const block = /^﻿?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text)?.[0];
  if (block === undefined) return null;
  const line = /^(contract:[ \t]*)\d+(?:\.0+)?(?=[ \t]*(?:#.*)?\r?$)/m;
  if (!line.test(block)) return null;
  return block.replace(line, `$1${to}`) + text.slice(block.length);
}

/**
 * What it takes to bring a vault up to this nexus's contract: each standard class note it lacks (a class the vault
 * already defines, under its own file or edited, is never touched) and the contract number. Reads only.
 */
export function planUpgrade(root: string, standard: string): UpgradePlan {
  const docs = join(root, 'docs');
  if (!isVault(docs)) return nothing('docs/_meta/classes/ not found: run nexus init first');
  const { registry } = readRegistry(docs);
  const contractFile = join(docs, META, 'contract.md');
  const hasContract = existsSync(contractFile);
  if (hasContract && registry.contract === null) return nothing(`docs/${META}/contract.md can't be read; fix it before upgrading`);
  const from = hasContract ? registry.contract : null;
  if (from !== null && from > CONTRACT_VERSION) return nothing(`this vault follows contract ${from}; this nexus supports ${CONTRACT_VERSION}. Update nexus.`);
  if (from !== null && from !== CONTRACT_VERSION && raiseContract(readFileSync(contractFile, 'utf8'), CONTRACT_VERSION) === null) return nothing(CONTRACT_LINE);
  const adds: UpgradePlan['adds'] = [];
  const classes = join(standard, 'classes');
  for (const file of readdirSync(classes).filter((f) => f.endsWith('.md')).sort()) {
    const name = file.slice(0, -3);
    if (registry.classes.has(name) || existsSync(join(docs, META, 'classes', file))) continue;
    adds.push({ path: `docs/${META}/classes/${file}`, data: readFileSync(join(classes, file), 'utf8') });
  }
  if (!hasContract) adds.push({ path: `docs/${META}/contract.md`, data: readFileSync(join(standard, 'contract.md'), 'utf8') });
  return { adds, contract: from === CONTRACT_VERSION ? null : { from, to: CONTRACT_VERSION }, problems: [] };
}

/** Writes the plan: new files only, then the number. Checks everything first, and removes its own adds if a write fails. */
export function applyUpgrade(root: string, plan: UpgradePlan): void {
  if (plan.problems.length) throw new NexusError(plan.problems.join('; '));
  const appeared = (path: string) => new NexusError(`${path} appeared since the plan was made; nothing was changed`);
  for (const a of plan.adds) if (existsSync(join(root, a.path))) throw appeared(a.path);
  const contractFile = join(root, 'docs', META, 'contract.md');
  let raised: string | null = null;
  if (plan.contract && plan.contract.from !== null) {
    raised = raiseContract(readFileSync(contractFile, 'utf8'), plan.contract.to);
    if (raised === null) throw new NexusError(CONTRACT_LINE);
  }
  const written: string[] = [];
  try {
    for (const a of plan.adds) {
      const file = join(root, a.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, a.data, { flag: 'wx' }); // the backstop for a file created between the check and here
      written.push(file);
    }
    if (raised !== null) writeFileSync(contractFile, raised);
  } catch (e) {
    for (const f of written) rmSync(f, { force: true });
    const path = (e as NodeJS.ErrnoException).path;
    if ((e as NodeJS.ErrnoException).code === 'EEXIST' && path !== undefined) throw appeared(relative(root, path).split(sep).join('/'));
    throw e;
  }
}

/** docs/_meta/ is walled while a build is active: upgrade then, and the wall would refuse it anyway. */
export function upgradeRefusal(root: string): string | null {
  const [active] = activeBuilds(root);
  return active === undefined ? null : `build "${active}" is active: docs/${META}/ is walled during a build, so upgrade once it closes (decommission upgrades the vault for you)`;
}
