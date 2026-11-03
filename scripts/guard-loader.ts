// The PreToolUse entry (bin/guard.mjs). It uses only Node's own modules, so it still runs when the guard bundle
// doesn't load. Where a build is in progress, a guard that can't run refuses the write (exit 2, which Claude Code
// treats as a block) rather than letting it through; everywhere else it stays silent, so a broken plugin can't stop
// work in repos whose builds finished or that never used nexus.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Bundled into bin/guard.mjs: pure functions whose only import is errors.ts, shared so the two checks can't drift.
import { finishGatePattern, isReadableName } from '../core/names.ts';
import { currentHarness } from '../core/harness.ts';
import { adapterFor } from '../hooks/adapters/index.ts';
import { claudeCodeAdapter } from '../hooks/adapters/claude-code.ts';
import type { HarnessAdapter } from '../hooks/adapters/types.ts';

type RunGuard = (input: unknown, opts: { home: string; win: boolean; now: Date }) => string;
interface Deps { cwd: string; load: () => Promise<{ runGuard: RunGuard }>; home: string; win: boolean; now: Date; adapter?: HarnessAdapter }
interface Result { code: 0 | 2; stdout: string; stderr: string }

const FILE_FIELDS = ['file_path', 'notebook_path'];
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** On Windows, the msys, Cygwin and WSL spellings of a drive (/c/x, /cygdrive/c/x, /mnt/c/x) as c:/x. */
function driveSpelling(path: string, win: boolean): string {
  if (!win) return path;
  const p = path.replace(/\\/g, '/');
  const m = /^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?:\/|$)/.exec(p);
  return m ? `${m[1]}:/${p.slice(m[0].length)}` : path;
}

/** The session folder and the folder of the file a tool writes; the process folder when the input names none. */
export function candidateFolders(input: unknown, cwd: string, win = process.platform === 'win32'): string[] {
  const o = record(input);
  const session = typeof o['cwd'] === 'string' && o['cwd'] ? o['cwd'] : cwd;
  const out = [session];
  const toolInput = record(o['tool_input']);
  for (const field of FILE_FIELDS) {
    const v = toolInput[field];
    if (typeof v === 'string' && v) out.push(dirname(resolve(session, driveSpelling(v, win))));
  }
  return out;
}

function* foldersUp(start: string): Generator<string> {
  let dir = resolve(start);
  for (;;) {
    yield dir;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** A .build/ folder at or above `folder`. */
export function hasBuildDir(folder: string): boolean {
  for (const dir of foldersUp(folder)) if (existsSync(join(dir, '.build'))) return true;
  return false;
}

const readRaw = (file: string): Record<string, unknown> => record(JSON.parse(readFileSync(file, 'utf8')));

/**
 * The same test as activeBuilds (core/lifecycle.ts), restated with Node built-ins so it works when the bundle doesn't:
 * a build is finished only at close-out with one of its phase's finish gates (finish-<phase> or a reopened
 * finish-<phase>-<n>) answered approve. Anything unreadable counts as in progress.
 */
function inProgress(builds: string, name: string): boolean {
  try {
    const build = readRaw(join(builds, name, 'build.json'));
    if (build['stage'] !== 'close-out') return true;
    const phase = build['phase'] ?? name;
    if (!isReadableName(phase)) return true;
    const finish = finishGatePattern(phase, '\\.answers\\.json');
    const gates = join(builds, name, 'gates');
    return !readdirSync(gates).some((file) => {
      if (!finish.test(file)) return false;
      const answers = readRaw(join(gates, file));
      return answers['gate'] === file.slice(0, -'.answers.json'.length) && answers['decision'] === 'approve';
    });
  } catch {
    return true;
  }
}

/** A build in progress in any .build/ at or above `folder`, nearest first. */
export function buildInProgress(folder: string): boolean {
  for (const dir of foldersUp(folder)) {
    const builds = join(dir, '.build');
    if (!existsSync(builds)) continue;
    let names: string[];
    try {
      names = readdirSync(builds, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch {
      return true;
    }
    if (names.some((name) => inProgress(builds, name))) return true;
  }
  return false;
}

function refusalMessage(e: unknown): string {
  const first = (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '';
  return `The nexus wall couldn't run, so it refused this write. Run \`nexus doctor guard\` to see why. (${first})\n`;
}

export async function runLoader(raw: string | Error, deps: Deps): Promise<Result> {
  const adapter = deps.adapter ?? claudeCodeAdapter;
  let input: unknown = null;
  let failure: unknown = raw instanceof Error ? raw : null;
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(raw || '{}');
    } catch (e) {
      failure = e;
    }
  }
  const inputs = failure ? [] : adapter.toGuardInputs(input);
  let found = inputs.flatMap((i) => candidateFolders(i, deps.cwd, deps.win));
  if (failure && adapter.foldersFromText) {
    const placed = adapter.foldersFromText(typeof raw === 'string' ? raw : '');
    if (placed === null) return adapter.refusal("The nexus wall couldn't tell which workspace this call is in, so it refused it. Run `nexus doctor guard` to see why.\n");
    found = placed;
  }
  const folders = found.length ? [...new Set(found)] : [deps.cwd];
  const allow: Result = { code: 0, stdout: adapter.toGuardOutput(''), stderr: '' };
  // Outside every build the guard has nothing to protect, so it isn't loaded. A shell command's paths are only known
  // to the guard itself, so it always loads for one.
  const shell = inputs.some((i) => {
    const tool = record(i)['tool_name'];
    return typeof tool === 'string' && SHELL_TOOLS.has(tool);
  });
  if (!failure && !shell && !folders.some(hasBuildDir)) return allow;
  try {
    if (failure) throw failure;
    const { runGuard } = await deps.load();
    for (const i of inputs) {
      const out = runGuard(i, { home: deps.home, win: deps.win, now: deps.now });
      if (out) return { code: 0, stdout: adapter.toGuardOutput(out), stderr: '' };
    }
    return allow;
  } catch (e) {
    return folders.some(buildInProgress) ? adapter.refusal(refusalMessage(e)) : allow;
  }
}

function readStdin(): Promise<string> {
  return new Promise((done, fail) => {
    if (process.stdin.isTTY) {
      done('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => done(data));
    process.stdin.on('error', fail);
  });
}

// Runs only as the bundled entry, never when a test imports this module.
const entry = process.argv[1] ?? '';
if (/[\\/]guard\.mjs$/.test(entry)) {
  const raw = await readStdin().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  const r = await runLoader(raw, {
    cwd: process.cwd(),
    load: () => import(pathToFileURL(join(dirname(entry), 'guard-core.mjs')).href) as Promise<{ runGuard: RunGuard }>,
    home: homedir(),
    win: process.platform === 'win32',
    now: new Date(),
    adapter: adapterFor(currentHarness()),
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
