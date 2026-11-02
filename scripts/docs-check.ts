// The docs vault checker on its own: no plugin, no build, no node_modules once bundled (bin/docs-check.mjs).
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { checkVault, type CheckOptions } from '../core/vault/check.ts';
import { exitCode, formatReport } from '../core/vault/format.ts';
import { runDocsHook } from '../core/vault/hook.ts';
import { findVaultRoot } from '../core/vault/paths.ts';
import { currentHarness } from '../core/harness.ts';
import { adapterFor } from '../hooks/adapters/index.ts';

export interface DocsIO {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  readStdin(): Promise<string>;
}

export const DOCS_CHECK_USAGE = 'Usage: node docs-check.mjs [root] [--file <path>] [--stale] [--json]   |   node docs-check.mjs --hook';

const OPTIONS = { file: { type: 'string' }, stale: { type: 'boolean' }, json: { type: 'boolean' }, hook: { type: 'boolean' } } as const;
const parse = (argv: string[]) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });

export async function runDocsCheck(argv: string[], io: DocsIO): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (e) {
    io.err(`${(e as Error).message}\n${DOCS_CHECK_USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.hook) {
    try {
      // One reply per written file (a Codex patch can write several); the first with something to say is printed.
      const replies = adapterFor(currentHarness()).toDocsInputs(await io.readStdin()).map((raw) => runDocsHook(raw));
      const reply = replies.find((r) => r) ?? '';
      if (reply) io.out(reply);
    } catch (e) {
      io.err(`nexus docs-check hook: ${(e as Error).message.split('\n')[0] ?? ''}`);
    }
    return 0;
  }
  const given = positionals[0];
  const root = given ? resolve(io.cwd, given) : (findVaultRoot(io.cwd) ?? io.cwd);
  const opts: CheckOptions = {};
  if (values.file !== undefined) {
    // From the current folder, or from the root given when it isn't found there. A path that isn't a note in this
    // vault is refused rather than checked as nothing, so a typo in CI fails instead of passing.
    const fromCwd = resolve(io.cwd, values.file);
    const file = given && !existsSync(fromCwd) ? resolve(root, values.file) : fromCwd;
    const inDocs = relative(join(root, 'docs'), file);
    if (!existsSync(file) || !file.toLowerCase().endsWith('.md') || inDocs.startsWith('..') || isAbsolute(inDocs)) {
      io.err(`nexus docs check: --file ${values.file} isn't a note in ${join(root, 'docs')}`);
      return 2;
    }
    opts.file = file;
  }
  if (values.stale) opts.stale = true;
  const report = checkVault(root, opts);
  if (values.json) io.out(JSON.stringify(report));
  else for (const line of formatReport(report)) io.out(line);
  return exitCode(report);
}
