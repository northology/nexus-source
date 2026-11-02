import { execFileSync } from 'node:child_process';
import { NexusError } from './errors.ts';

/**
 * `env` is merged over this process's environment; a key set to undefined is removed from the child's. `maxBuffer`
 * raises the 1 MB limit on git's output for a call that can print a long list. `raw` (gitTry) keeps stdout untrimmed,
 * for -z output whose first path may start with whitespace.
 */
export interface GitOptions { env?: Record<string, string | undefined>; maxBuffer?: number; raw?: boolean }

function childEnv(extra: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/** git with arguments, never a shell line, so paths with spaces or quotes pass through as they are. Raw stdout. */
function raw(cwd: string, args: string[], opts: GitOptions = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(opts.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}),
    env: childEnv(opts.env),
  });
}

function message(e: unknown): string {
  const stderr = (e as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' ? stderr.trim() : '';
  return text || (e as Error).message;
}

/** Raw stdout (untrimmed, for output where leading whitespace matters); a failure throws a NexusError. */
function run(cwd: string, args: string[], opts: GitOptions): string {
  try {
    return raw(cwd, args, opts);
  } catch (e) {
    throw new NexusError(`git ${args[0] ?? ''} failed: ${message(e)}`);
  }
}

/** Trimmed stdout; a failure throws a NexusError carrying git's own message. */
export function git(cwd: string, args: string[], opts: GitOptions = {}): string {
  return run(cwd, args, opts).trim();
}

export function gitTry(cwd: string, args: string[], opts: GitOptions = {}): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = raw(cwd, args, opts);
    return { ok: true, out: opts.raw ? out : out.trim() };
  } catch (e) {
    return { ok: false, err: message(e) };
  }
}

export function insideGit(cwd: string): boolean {
  const r = gitTry(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.out === 'true';
}

/** The checked-out branch; null when HEAD is detached or cwd isn't in a repo. */
export function currentBranch(cwd: string): string | null {
  const r = gitTry(cwd, ['branch', '--show-current']);
  return r.ok && r.out ? r.out : null;
}

/** The commit a ref names, or null when it names none. */
export function revParse(cwd: string, ref: string): string | null {
  const r = gitTry(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.ok && r.out ? r.out : null;
}

/** The oldest commit that added `path`, or null when none did. */
export function fileAddedCommit(cwd: string, path: string): string | null {
  const r = gitTry(cwd, ['log', '--diff-filter=A', '--format=%H', '--reverse', '--', path]);
  return r.ok ? (r.out.split('\n')[0] || null) : null;
}

const under = (path: string, prefix: string): boolean => {
  const p = prefix.replace(/\/+$/, '');
  return path === p || path.startsWith(`${p}/`);
};

/**
 * Every changed, staged or untracked file (both names of a rename) outside the `except` prefixes, sorted. An empty
 * list means the tree is clean apart from those prefixes.
 */
export function dirtyPaths(cwd: string, except: string[]): string[] {
  const parts = run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {}).split('\0');
  const paths = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    // A rename or copy is "XY new\0old": the old name is the next part.
    if (entry[0] === 'R' || entry[0] === 'C') {
      i++;
      if (parts[i]) paths.add(parts[i] ?? '');
    }
  }
  return [...paths].filter((p) => !except.some((e) => under(p, e))).sort();
}
