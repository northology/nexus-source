import { posix } from 'node:path';

/** `fold`: case-insensitive file names (Windows, and macOS's default); it defaults to `win`. `hostname`: this machine. */
export interface PathContext { cwd: string; home: string; win: boolean; fold?: boolean; hostname?: string }
export type TargetKind = 'rules' | 'answers' | 'build' | 'superpowers' | 'record';
export interface Target { pattern: string; kind: TargetKind; base: 'anywhere' | 'root' | 'home' | 'absolute' }
/** `ancestors` match the folders that can hold a file the pattern protects, so deleting or moving one is caught. */
export interface CompiledTarget { kind: TargetKind; pattern: string; full: string; re: RegExp; ancestors: RegExp[] }

/** What the wall protects during a build. Neutral: no organization's paths. Repos add more in .nexus/config.json. */
export const DEFAULT_TARGETS: Target[] = [
  { pattern: 'CLAUDE.md', kind: 'rules', base: 'anywhere' },
  { pattern: 'CLAUDE.local.md', kind: 'rules', base: 'anywhere' },
  { pattern: 'AGENTS.md', kind: 'rules', base: 'anywhere' },
  // Codex loads a folder's AGENTS.override.md in place of its AGENTS.md.
  { pattern: 'AGENTS.override.md', kind: 'rules', base: 'anywhere' },
  { pattern: '.claude/settings*.json', kind: 'rules', base: 'anywhere' },
  { pattern: '.claude/rules/**', kind: 'rules', base: 'anywhere' },
  { pattern: '.claude/projects/*/memory/**', kind: 'rules', base: 'home' },
  // The standing rules Codex and Antigravity load: a rule for one harness's sessions is a rule for any agent's.
  { pattern: 'GEMINI.md', kind: 'rules', base: 'anywhere' },
  { pattern: '.agents/rules/**', kind: 'rules', base: 'anywhere' },
  { pattern: '.agents/hooks.json', kind: 'rules', base: 'anywhere' },
  { pattern: '.codex/config.toml', kind: 'rules', base: 'anywhere' },
  { pattern: '.codex/AGENTS.override.md', kind: 'rules', base: 'home' },
  { pattern: '.gemini/config/**', kind: 'rules', base: 'home' },
  { pattern: '.nexus/config.json', kind: 'rules', base: 'root' },
  { pattern: '.build/*/gates/*.answers.json', kind: 'answers', base: 'root' },
  { pattern: '.nexus/reviews/*.answers.json', kind: 'answers', base: 'root' },
  { pattern: '.build/*/build.json', kind: 'build', base: 'root' },
  { pattern: '.build/*/plan.json', kind: 'build', base: 'root' },
  { pattern: 'docs/superpowers/**', kind: 'superpowers', base: 'root' },
  // After docs/superpowers/: deleting docs/ itself is refused as the build's record, which never takes a permit.
  // The repo's permanent record that decommission writes; seeding, change entries and rule notes stay open.
  { pattern: 'docs/governance/decisions.json', kind: 'record', base: 'root' },
  { pattern: 'docs/governance/issues.json', kind: 'record', base: 'root' },
  { pattern: 'docs/governance/builds/**', kind: 'record', base: 'root' },
  { pattern: 'docs/_meta/**', kind: 'rules', base: 'root' },
];

const isAbsolute = (p: string): boolean => /^[a-zA-Z]:\//.test(p) || p.startsWith('/');

/** ~, $HOME and ${HOME}; on Windows also the PowerShell and cmd spellings of the user profile, in any case. */
const HOME_PREFIX = {
  posix: /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/,
  win: /^(?:~|\$home|\$\{home\}|\$env:userprofile|%userprofile%|\$userprofile)(?=\/|$)/i,
};

/**
 * The folders above whatever a full pattern matches. A leading double star alone is skipped: every folder could
 * hold a CLAUDE.md somewhere below it, and refusing every delete would freeze ordinary work.
 */
function ancestorPatterns(full: string): RegExp[] {
  const segments = full.split('/');
  const out: RegExp[] = [];
  for (let k = 1; k < segments.length; k++) {
    const prefix = segments.slice(0, k).join('/');
    if (prefix === '**') continue;
    out.push(globToRegExp(prefix === '' ? '/' : prefix));
  }
  return out;
}

/** Quotes inside quotes ("'a'") come off one pair at a time, as each shell layer would take them. */
function stripQuotes(raw: string): string {
  let p = raw;
  for (let prev = ''; prev !== p; ) {
    prev = p;
    p = p.trim().replace(/^(['"])(.*)\1$/s, '$2');
  }
  return p;
}

const ownHost = (host: string, ctx: PathContext): boolean => {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || (!!ctx.hostname && h === ctx.hostname.toLowerCase());
};

/** The drive of the session's folder, lowercased, on Windows. */
function cwdDrive(ctx: PathContext): string | null {
  const cwd = ctx.cwd.replace(/\\/g, '/');
  const drive = /^([a-zA-Z]):/.exec(cwd) ?? /^\/([a-zA-Z])\//.exec(cwd);
  return drive?.[1]?.toLowerCase() ?? null;
}

/**
 * One spelling for every form of a path, so the wall can't be stepped around: on Windows, E:\x, /e/x, e:/X,
 * /cygdrive/e/x, /mnt/e/x, \\thishost\e$\x, "quoted", drive-relative, relative and ..-laden paths all become e:/x.
 * Case is folded where file names ignore it (`fold`, which defaults to Windows only).
 */
export function normalizePath(raw: string, ctx: PathContext): string {
  let p = stripQuotes(raw).replace(/\\/g, '/');
  // The shell would expand a leading home variable before the file is touched, so expand it here too.
  const home = HOME_PREFIX[ctx.win ? 'win' : 'posix'].exec(p);
  if (home) p = ctx.home.replace(/\\/g, '/') + p.slice(home[0].length);
  if (ctx.win) {
    // \\?\E:\x and \\.\E:\x are the same file as E:\x; \\?\UNC\host\share and \\thishost\E$\x are shares of it.
    const device = /^\/\/[?.]\/(UNC\/)?/i.exec(p);
    if (device) p = (device[1] ? '//' : '') + p.slice(device[0].length);
    const adminShare = /^\/\/([^/]+)\/([a-zA-Z])\$(?:\/|$)/.exec(p);
    if (adminShare?.[1] && ownHost(adminShare[1], ctx)) p = `${adminShare[2]}:/${p.slice(adminShare[0].length)}`;
    const mounted = /^\/(?:cygdrive|mnt)\/([a-zA-Z])(?:\/|$)/i.exec(p);
    const msys = /^\/([a-zA-Z])(\/|$)/.exec(p);
    if (mounted) p = `${mounted[1]}:/${p.slice(mounted[0].length)}`;
    else if (msys) p = `${msys[1]}:/${p.slice(3)}`;
    else if (p.startsWith('/') && !p.startsWith('//')) {
      // Rooted but drive-less: Windows resolves it against the current drive.
      const drive = cwdDrive(ctx);
      if (drive) p = `${drive}:${p}`;
    }
    // E:file is relative to that drive's current folder: the session's folder on its own drive, else (unknown) the root.
    const relative = /^([a-zA-Z]):(?!\/)/.exec(p);
    if (relative?.[1]) {
      const drive = relative[1].toLowerCase();
      const rest = p.slice(2);
      p = drive === cwdDrive(ctx) ? `${normalizePath(ctx.cwd, { ...ctx, cwd: '/' })}/${rest}` : `${drive}:/${rest}`;
    }
  }
  if (!isAbsolute(p)) p = `${normalizePath(ctx.cwd, { ...ctx, cwd: '/' })}/${p}`;
  // Win32 ignores trailing dots and spaces on a name, so CLAUDE.md. and "CLAUDE.md " are the same file.
  if (ctx.win) p = p.split('/').map((s) => (s === '.' || s === '..' ? s : s.replace(/[. ]+$/, ''))).join('/');
  p = posix.normalize(p);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return (ctx.fold ?? ctx.win) ? p.toLowerCase() : p;
}

/**
 * Every file a path could name. On Windows, /w/repo is drive W to Git Bash but a folder on the current drive to
 * PowerShell and Win32, so both readings are checked; anything else has one.
 */
export function pathReadings(raw: string, ctx: PathContext): string[] {
  const first = normalizePath(raw, ctx);
  const bare = stripQuotes(raw).replace(/\\/g, '/');
  const drive = ctx.win ? cwdDrive(ctx) : null;
  if (!drive || !/^\/[a-zA-Z]\//.test(bare)) return [first];
  const second = normalizePath(`${drive}:${bare}`, ctx);
  return second === first ? [first] : [first, second];
}

/** \\?\GLOBALROOT\… and \\?\Volume{…}\… name a file by device or volume, which the wall can't map to a path. */
export function unmappable(raw: string): boolean {
  return /^\/\/[?.]\/(?:globalroot|volume\{)/i.test(stripQuotes(raw).replace(/\\/g, '/'));
}

/** A literal path as a glob that matches only itself: a folder named `clients [2026]` isn't a character class. */
export function escapeGlob(path: string): string {
  return path.replace(/[*?[\]\\]/g, '\\$&');
}

/** Where the bracket expression opening at `open` closes (a `]` right after `[`, `[!` or `[^` is a member), or -1. */
function bracketEnd(glob: string, open: number): number {
  let j = open + 1;
  if (glob[j] === '!' || glob[j] === '^') j++;
  if (glob[j] === ']') j++;
  for (; j < glob.length; j++) {
    if (glob[j] === '/') return -1;
    if (glob[j] === ']') return j;
  }
  return -1;
}

/** A double star followed by a slash matches any depth (including none); a bare double star matches anything; a single star, ? and a bracket class stay in one segment. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    // A backslash makes the next character literal (escapeGlob): paths reach here with forward slashes only.
    if (c === '\\' && i + 1 < glob.length) {
      out += (glob[++i] ?? '').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      continue;
    }
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[' && bracketEnd(glob, i) > 0) {
      // A bracket expression is a class of one character: [abc], [a-z], and [!x] or [^x] for any but x.
      const end = bracketEnd(glob, i);
      let body = glob.slice(i + 1, end);
      const negated = body.startsWith('!') || body.startsWith('^');
      if (negated) body = body.slice(1);
      out += `[${negated ? '^/' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`;
      i = end;
    } else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 's');
}

/** Repo config entries: relative to the repo root, from home with ~/, or absolute. All protect permanent rules. */
export function configTargets(protect: string[]): Target[] {
  return protect.map((raw): Target => {
    const p = raw.replace(/\\/g, '/');
    if (p.startsWith('~/')) return { pattern: p.slice(2), kind: 'rules', base: 'home' };
    if (isAbsolute(p)) return { pattern: p, kind: 'rules', base: 'absolute' };
    return { pattern: p.replace(/^\.\//, ''), kind: 'rules', base: 'root' };
  });
}

export function compileTargets(targets: Target[], ctx: { root: string; home: string; win: boolean; fold?: boolean }): CompiledTarget[] {
  const fold = ctx.fold ?? ctx.win;
  const pc: PathContext = { cwd: '/', home: ctx.home, win: ctx.win, fold };
  const root = normalizePath(ctx.root, pc);
  const home = normalizePath(ctx.home, pc);
  return targets.map((t) => {
    const dir = t.pattern.endsWith('/');
    const pattern = fold ? t.pattern.toLowerCase() : t.pattern;
    let full: string;
    if (t.base === 'absolute') full = normalizePath(pattern, pc);
    else {
      // The root and home are literal folders; only the pattern after them is a glob.
      const prefix = t.base === 'anywhere' ? '**' : escapeGlob(t.base === 'root' ? root : home);
      full = posix.normalize(`${prefix}/${pattern}`);
    }
    full = full.replace(/\/+$/, '');
    // A pattern ending in a slash names the directory: everything under it.
    if (dir) full += '/**';
    return { kind: t.kind, pattern: t.pattern, full, re: globToRegExp(full), ancestors: ancestorPatterns(full) };
  });
}

/**
 * The first target the visible tail of a path looks like, when the folder above it can't be known (a variable, a
 * substitution). Each ending of the target's glob is tried against the tail, but an ending may not start with `**`:
 * the unknown folder stands for the part before the tail, so `.claude/rules/**` matches `rules/x.md` and not `x.md`.
 * A path with nothing visible matches nothing; the wall reads the shell best-effort (reference/superpowers.md).
 */
export function matchTail(tail: string, compiled: CompiledTarget[]): CompiledTarget | null {
  if (!tail) return null;
  return (
    compiled.find((c) => {
      const segments = c.full.split('/');
      for (let j = 0; j < segments.length; j++) {
        if (j > 0 && segments[j] === '**') continue;
        if (globToRegExp(segments.slice(j).join('/')).test(tail)) return true;
      }
      return false;
    }) ?? null
  );
}

export function matchTarget(path: string, compiled: CompiledTarget[]): CompiledTarget | null {
  return compiled.find((c) => c.re.test(path)) ?? null;
}

/** The first target that a folder at `path` could hold files of; deleting or moving that folder removes them. */
export function matchAncestor(path: string, compiled: CompiledTarget[]): CompiledTarget | null {
  return compiled.find((c) => c.ancestors.some((re) => re.test(path))) ?? null;
}
