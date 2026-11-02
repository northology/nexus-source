import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { CONFIG_FILE, readConfig } from '../core/config.ts';
import { activeBuilds } from '../core/lifecycle.ts';
import { BUILD_DIR, findBuildRoot, listBuilds } from '../core/paths.ts';
import { openPermits } from '../core/permits.ts';
import { type OpenedPage, openedPages } from '../core/concept-pages.ts';
import { findReviewsRoot, REVIEWS_DIR } from '../core/review-files.ts';
import { compileTargets, type CompiledTarget, configTargets, DEFAULT_TARGETS, escapeGlob, globToRegExp, matchAncestor, matchTail, matchTarget, normalizePath, type PathContext, pathReadings, type TargetKind, unmappable } from '../core/protect.ts';
import { postsGateAnswers, type ShellOptions, type ShellWrite, shellWrites, UNKNOWN } from '../core/shell.ts';

export interface GuardInput { tool_name?: unknown; tool_input?: unknown; cwd?: unknown }
/** `fold` (case-insensitive names) defaults to Windows and macOS; `hostname` to this machine's; `env` to this process's. */
export interface GuardOptions { home: string; win: boolean; now: Date; fold?: boolean; hostname?: string; env?: Record<string, string | undefined> }

const FILE_FIELDS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** A build's gate answers: walled while its build folder exists, active or finished, so only the cockpit answers. */
const GATE_ANSWERS = DEFAULT_TARGETS.filter((t) => t.kind === 'answers' && t.pattern.startsWith(`${BUILD_DIR}/`));

/** `literals` is set only for a build nexus can't read: a write whose path contains one is refused (see stateOf). */
/** `active`: the builds holding the wall up, or `['*']` when nexus can't read them (all count as active). */
interface RootState { build: string; active: string[]; targets: CompiledTarget[]; permitted: string[]; literals: string[] }

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function deny(reason: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

function writesOf(tool: string, input: Record<string, unknown>, shell: ShellOptions): ShellWrite[] {
  const field = FILE_FIELDS[tool];
  if (field) {
    const v = input[field];
    return typeof v === 'string' && v ? [{ path: v, removes: false }] : [];
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = input['command'];
    return typeof command === 'string' ? shellWrites(command, shell) : [];
  }
  return [];
}

/**
 * What a repo config entry literally names, for the fallback: the text before its first glob character (a star, a ?
 * or a bracket class), else after its last.
 */
function literalOf(entry: string): string {
  const e = entry.toLowerCase().replace(/\\/g, '/').replace(/^(?:~\/|\.\.?\/)+/, '');
  const first = e.search(/[*?[]/);
  const last = Math.max(e.lastIndexOf('*'), e.lastIndexOf('?'), e.lastIndexOf(']'));
  const literal = first < 0 ? e : e.slice(0, first) || e.slice(last + 1);
  return /[a-z0-9]/.test(literal) ? literal : '';
}

// The longest run of a pattern with no glob character in it, the part most its own: `.answers.json` for a gate's
// answers, whose first run, `.build/`, would take every build file.
function longestLiteral(pattern: string): string {
  return pattern.toLowerCase().split(/[*?[\]]+/).reduce((a, b) => (b.length > a.length ? b : a), '');
}

/**
 * If the guard itself fails, it still refuses writes whose input mentions one of these: a few broad folders, and
 * every target the wall has, so the list never falls behind it.
 */
const FALLBACK = [
  ...new Set([
    ...['claude.md', 'agents.md', '.claude/', 'memory/', '.answers.json', 'build.json', 'plan.json', 'docs/superpowers', '.nexus/'],
    ...DEFAULT_TARGETS.map((t) => longestLiteral(t.pattern)),
  ]),
];

/** The fallback list plus the cwd's repo config entries, read as plainly as possible: the guard already failed once. */
function fallbackTargets(cwd: unknown): string[] {
  const out = [...FALLBACK];
  try {
    const root = typeof cwd === 'string' && cwd ? findBuildRoot(cwd) : null;
    if (!root) return out;
    const config: unknown = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
    const protect = typeof config === 'object' && config !== null ? (config as Record<string, unknown>)['protect'] : null;
    if (Array.isArray(protect)) {
      for (const entry of protect) {
        const literal = typeof entry === 'string' ? literalOf(entry) : '';
        if (literal) out.push(literal);
      }
    }
  } catch {
    // no readable config: the defaults stand
  }
  return out;
}

/** The whole tool input as one lowercased string with its backslashes read as slashes, for the literal checks. */
function rawInputOf(toolInput: unknown): string {
  try {
    // JSON doubles each backslash, so a pair stands for one.
    return JSON.stringify(toolInput ?? '').toLowerCase().replace(/\\\\/g, '/');
  } catch {
    return '';
  }
}

/**
 * What is known of a path with an unknown part: the segments after the last one holding it, folded where names
 * ignore case. A tail that climbs (`..`) could land anywhere, so it counts as nothing known.
 */
function unknownTail(raw: string, fold: boolean): string {
  const segments = raw.replace(/\\/g, '/').split('/');
  let last = -1;
  segments.forEach((s, i) => {
    if (s.includes(UNKNOWN)) last = i;
  });
  const tail = posix.normalize(segments.slice(last + 1).join('/') || '.');
  if (tail === '.' || tail === '..' || tail.startsWith('../')) return '';
  return fold ? tail.toLowerCase() : tail;
}

/** Build roots a delete or move would take with it: the folder itself and the folders directly inside it. */
function buildRootsInside(folder: string): string[] {
  const out: string[] = [];
  try {
    if (existsSync(join(folder, BUILD_DIR))) out.push(folder);
    for (const e of readdirSync(folder, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(folder, e.name, BUILD_DIR))) out.push(join(folder, e.name));
    }
  } catch {
    // not a folder, or unreadable: nothing inside to judge
  }
  return out;
}

/**
 * True when a build folder at or above `start` holds a build, active or finished. After the last decommission the
 * committed .build/.gitattributes keeps .build/ there with no build in it, and the wall is down. A folder nexus can't
 * list counts as holding one, so a failure never lowers the wall.
 */
function holdsBuild(start: string): boolean {
  for (let r = findBuildRoot(start); r; ) {
    try {
      if (listBuilds(r).length) return true;
    } catch {
      return true;
    }
    const up = dirname(r);
    r = up === r ? null : findBuildRoot(up);
  }
  return false;
}

/** True when a build in this root holds the wall up; a build nexus can't read counts as active. */
function anyActive(root: string): boolean {
  try {
    return activeBuilds(root).length > 0;
  } catch {
    return true;
  }
}

/**
 * Why a write to an active build's concepts folder is refused: it would change a page some round already shows (the
 * page itself; for a removal, one inside the folder or one the glob names), or nexus can't read the build's gates.
 */
function conceptRefusal(root: string, path: string, removes: boolean, ctx: PathContext, active: string[], glob: RegExp | null): string | null {
  const prefix = normalizePath(join(root, BUILD_DIR), { ...ctx, cwd: '/' }) + '/';
  if (!path.startsWith(prefix)) return null;
  const [build, area] = path.slice(prefix.length).split('/');
  if (!build || area !== 'concepts') return null;
  const fold = ctx.fold ?? ctx.win;
  if (!active.includes('*') && !active.some((a) => (fold ? a.toLowerCase() : a) === build)) return null;
  let pages: OpenedPage[];
  try {
    pages = openedPages(root, build);
  } catch {
    return `nexus can't read the gates of build "${build}", so it refused a write to its concept pages. Check the build's gates/ folder.`;
  }
  const opened = pages.find((p) => {
    const target = normalizePath(join(root, BUILD_DIR, build, p.page), { ...ctx, cwd: '/' });
    return target === path || (removes && target.startsWith(path + '/')) || (glob?.test(target) ?? false);
  });
  if (!opened) return null;
  // The page as a build path, whatever spelling the gate used.
  const page = posix.normalize(opened.page.replace(/\\/g, '/'));
  return `${page} is in round "${opened.title}" already. Write the next round's pages as new files.`;
}

const GLOB_CHARS = /[*?[]/;
/** How many paths a glob's expansion or a copied folder's listing may name before the guard stops looking. */
const GLOB_CAP = 2000;

/** Every path inside a folder, relative to it, without following links; null past the cap or when it can't be read. */
function listFiles(folder: string, cap = GLOB_CAP): string[] | null {
  const out: string[] = [];
  const walk = (dir: string, rel: string): boolean => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      out.push(path);
      if (out.length > cap) return false;
      if (e.isDirectory() && !walk(join(dir, e.name), path)) return false;
    }
    return true;
  };
  return walk(folder, '') ? out : null;
}

/** The name an unknown part of a path stands as, when its visible parts are judged. Nothing protected is named so. */
const PLACEHOLDER = 'nexus-unknown-part';

/** The folder before a glob's first glob segment. */
function globHead(glob: string): string {
  const segments = glob.split('/');
  const at = segments.findIndex((s) => GLOB_CHARS.test(s));
  const head = segments.slice(0, at < 0 ? segments.length : at).join('/');
  return /^[a-zA-Z]:$/.test(head) || head === '' ? `${head}/` : head;
}

/**
 * The files a glob names on disk, as the shell will expand it a moment later. Null when it can't be expanded
 * within the cap (a `**`, or too many files): the caller judges it as a path it can't see. `dots`: whether a star
 * matches a name starting with a dot.
 */
function expandGlob(glob: string, fold: boolean, cap = GLOB_CAP, dots = true, literal = ''): string[] | null {
  // `literal`: a folder the glob sits in, taken as it is.
  const [head = '', ...segments] = literal ? [literal, ...(glob ? glob.split('/') : [])] : glob.split('/');
  let bases = [head];
  for (const segment of segments) {
    if (!GLOB_CHARS.test(segment)) {
      bases = bases.map((b) => `${b}/${segment}`);
      continue;
    }
    if (segment.includes('**')) return null;
    const re = globToRegExp(segment);
    const next: string[] = [];
    for (const base of bases) {
      let names: string[];
      try {
        // A bare drive (c:) would list that drive's current folder, not its root.
        names = readdirSync(base === '' ? '/' : /^[a-zA-Z]:$/.test(base) ? `${base}/` : base);
      } catch {
        continue;
      }
      for (const name of names) {
        const seen = fold ? name.toLowerCase() : name;
        // A name that is the segment itself is taken too: a folder can be named `clients [2026]`.
        if (seen === segment) {
          next.push(`${base}/${seen}`);
          continue;
        }
        // Bash's glob passes over a name starting with a dot unless the segment starts with one; PowerShell's doesn't.
        if (!dots && name.startsWith('.') && !segment.startsWith('.')) continue;
        if (re.test(seen)) next.push(`${base}/${seen}`);
      }
      if (next.length > cap) return null;
    }
    bases = next;
  }
  return bases;
}

/**
 * Glob reading for one hook call. The session's folder, home and the repo roots above are literal (a folder named
 * `clients [2026]` is no character class): only what follows them is read as a glob. Elsewhere a segment that exists
 * on disk under its own name is taken as itself as well as a glob. `dots`: whether a star matches a name starting
 * with a dot (PowerShell's does, bash's doesn't).
 */
interface Globs {
  /** Whether the path has a glob outside its literal head. */
  has(path: string): boolean;
  /** The files the glob names on disk; null when it can't tell within the cap (a `**`, or too many files). */
  expand(path: string): string[] | null;
  /** The folder before the first glob segment. */
  head(path: string): string;
  /** The glob as a regular expression, its literal head escaped. */
  regex(path: string): RegExp;
}

function globsFor(ctx: PathContext, dots: boolean, roots: (string | null)[] = []): Globs {
  const fold = ctx.fold ?? ctx.win;
  const heads = [ctx.cwd, ctx.home, ...roots]
    .filter((p): p is string => !!p)
    .map((p) => normalizePath(p, { ...ctx, cwd: '/' }))
    .sort((a, b) => b.length - a.length);
  const split = (path: string): { head: string; rest: string } => {
    for (const h of heads) {
      if (h.length > 1 && (path === h || path.startsWith(h + '/'))) return { head: h, rest: path.slice(h.length + 1) };
    }
    return { head: '', rest: path };
  };
  return {
    has: (path) => GLOB_CHARS.test(split(path).rest),
    expand: (path) => {
      const { head, rest } = split(path);
      return expandGlob(rest, fold, GLOB_CAP, dots, head);
    },
    head: (path) => {
      const { head, rest } = split(path);
      const inner = globHead(rest);
      return head ? (rest === '' || inner === '/' ? head : `${head}/${inner}`) : inner;
    },
    regex: (path) => {
      const { head, rest } = split(path);
      return globToRegExp(head ? `${escapeGlob(head)}/${rest}` : path);
    },
  };
}

function reason(kind: TargetKind, build: string, target: string): string {
  if (kind === 'answers') return 'Only the cockpit writes gate answers. Wait for the user to answer in the cockpit.';
  if (kind === 'build') return `Build state changes only through nexus commands (\`nexus stage\`, \`nexus phase\`, \`nexus gate apply\`, \`nexus plan index\`, \`nexus ledger import\`), never by editing ${target}. Close-out needs the user's approval of the phase's finish gate in the cockpit.`;
  if (kind === 'superpowers') return `This build's specs and plans go to .build/${build}/documents/specs/ and documents/plans/, not docs/superpowers/.`;
  if (kind === 'record' && /governance[\\/]+builds[\\/]/i.test(target)) return `A build's record (${target}) is written at decommission, from its final report: draft it as .build/${build}/documents/reports/${build} final report.md.`;
  if (kind === 'record') return `The repo's permanent record (${target}) is written at decommission, from the build's record: log it in .build/${build}/ with \`nexus log add\` instead.`;
  return `Permanent rules can't change during build "${build}" (${target}). Propose it with \`nexus guardrail propose\`, or ask the user to approve the change at a gate with a permit.`;
}

const REVIEW_FILE = /(?:^|\/)\.nexus\/reviews\/(?:[^/]*\.answers\.json|index\.json)$/;
const REVIEW_FOLDER = /(?:^|\/)\.nexus(?:\/reviews)?$/;
const REVIEW_INSIDE = /(?:^|\/)\.nexus\/reviews\//;
const REVIEW_REASON = "Only the cockpit writes review answers, and only `nexus review` commands change .nexus/reviews/index.json. Wait for the user to answer the review in the cockpit's Repo view.";
const REVIEW_FOLDER_REASON = `${REVIEW_REASON} nexus creates .nexus/reviews/ itself (\`nexus review open\`): don't create, link or copy over it.`;
const reviewDeleteReason = (raw: string): string =>
  `Deleting ${raw} would remove the repo's reviews and their answers. Remove only a review's request file, if you mean to withdraw it.`;
const unlistedReason = (folder: string): string =>
  `nexus can't list the files this copies into ${folder}, and they could place review answers. ${REVIEW_REASON}`;

/** The folder a copy carries files it can't list into (`<folder>/UNLISTED`), or null. */
function unlistedFolder(raw: string): string | null {
  return /^(.*)[\\/]\u0000\/\u0000$/s.exec(raw)?.[1] ?? null;
}

/**
 * Whether a path with an unknown part could be a review's answers or the index: anything inside the reviews folder,
 * a wholly unknown name directly under .nexus (it could be reviews/), a name ending in .answers.json, or an index.json
 * or a name with an unknown stem ($N.json) in a folder the line could have pointed at the reviews (it names .nexus, or
 * the visible part does).
 */
function unknownReviewPath(raw: string, mentionsNexus: boolean): boolean {
  const seen = raw.replace(/\\/g, '/').toLowerCase();
  const visible = seen.split(UNKNOWN).join('');
  if (REVIEW_INSIDE.test(visible)) return true;
  const segments = seen.split('/');
  if (segments.some((s, j) => s === UNKNOWN && segments[j - 1] === '.nexus')) return true;
  const tail = seen.slice(seen.lastIndexOf(UNKNOWN) + 1);
  if (tail.endsWith('.answers.json')) return true;
  const reviewsNamed = mentionsNexus || visible.includes('.nexus');
  if (!/(?:^|\/)index\.json$/.test(tail) && tail !== '.json') return false;
  return reviewsNamed || /(?:^|\/)reviews\/index\.json$/.test(tail);
}

/**
 * The wall's rules for a repo's reviews, which runGuard applies while a build is active: no write or delete of a review's answers or the review index (a copy into the folder included), no write over
 * the folder itself, no delete of the folder or of anything holding it, no copy of files nexus can't list into any of
 * those, and no shell post of answers (to the review route anywhere, or with the cockpit token below a folder that
 * has reviews). Paths are judged by their shape after pathReadings, which folds case where names ignore it; a glob is
 * judged by what it names on disk (`dots`: whether its * matches names starting with a dot, as PowerShell's does and
 * bash's doesn't). The shell route rule is best effort (a token in a variable, or a script, can evade it): the file
 * wall and the fail-closed permits are the guarantees. Returns the deny JSON, or ''.
 */
export function reviewGuard(input: { writes: ShellWrite[]; command: string | null; dots?: boolean }, ctx: PathContext): string {
  if (input.command !== null && postsGateAnswers(input.command)) {
    const line = input.command.toLowerCase();
    if ((line.includes('/reviews/') && line.includes('/answers')) || findReviewsRoot(ctx.cwd) !== null) {
      return deny("Only the user answers reviews, in the cockpit's Repo view. Never post answers or read the page token yourself: tell the user the review is waiting.");
    }
  }
  const mentionsNexus = input.command?.toLowerCase().replace(/\\/g, '/').includes('.nexus') ?? false;
  const reviewsRoot = findReviewsRoot(ctx.cwd);
  const holding = reviewsRoot === null ? null : normalizePath(reviewsRoot, { ...ctx, cwd: '/' });
  const globs = globsFor(ctx, input.dots ?? true, [reviewsRoot]);
  /** A folder holding the reviews: at or above the session's own, or with a reviews folder directly inside. */
  const holds = (path: string): boolean =>
    (holding !== null && (holding === path || holding.startsWith(path === '/' ? '/' : path + '/'))) || isFolder(join(path, ...REVIEWS_DIR));
  /** A folder that holds the reviews, is the reviews folder or .nexus, or sits inside the reviews folder. */
  const reaches = (path: string): boolean => holds(path) || REVIEW_FOLDER.test(path.toLowerCase()) || REVIEW_INSIDE.test(path.toLowerCase());
  // A glob's expansions join the queue as plain paths, judged like any other write.
  const queue: (ShellWrite & { expanded?: boolean })[] = [...input.writes];
  for (let i = 0; i < queue.length; i++) {
    const { path: raw, removes, expanded } = queue[i] ?? { path: '', removes: false };
    const unlisted = unlistedFolder(raw);
    if (unlisted !== null) {
      if (unlisted.includes(UNKNOWN)) {
        if (mentionsNexus) return deny(unlistedReason(unlisted.split(UNKNOWN).join('…')));
      } else if (!unmappable(unlisted) && pathReadings(unlisted, ctx).some(reaches)) return deny(unlistedReason(unlisted));
      continue;
    }
    if (raw.includes(UNKNOWN)) {
      if (unknownReviewPath(raw, mentionsNexus)) return deny(REVIEW_REASON);
      continue;
    }
    if (unmappable(raw)) continue; // the wall below judges it
    for (const path of pathReadings(raw, ctx)) {
      const p = path.toLowerCase();
      if (REVIEW_FILE.test(p)) return deny(REVIEW_REASON);
      if (REVIEW_FOLDER.test(p)) {
        if (removes) return deny(reviewDeleteReason(raw));
        // Writing the folder itself (a copy of a folder over it, a link, a new folder) is nexus's to do; an existing
        // .nexus only takes a new entry beside reviews/.
        if (p.endsWith('/reviews') || !isFolder(path)) return deny(REVIEW_FOLDER_REASON);
      }
      if (globs.has(path) && !expanded) {
        // A glob that writes inside the folder may name an answers file that doesn't exist yet.
        if (!removes && REVIEW_INSIDE.test(p)) return deny(REVIEW_REASON);
        if (removes && REVIEW_INSIDE.test(p)) return deny(reviewDeleteReason(raw));
        const files = globs.expand(path);
        // A glob the disk can't expand here takes from the folder before its first glob segment.
        if (files === null) queue.push({ path: globs.head(path), removes: true, expanded: true });
        else queue.push(...files.map((f) => ({ path: f, removes, expanded: true })));
        continue;
      }
      // Deleting a folder takes the reviews inside it: a repo's own folder, or anything above the session's reviews.
      if (removes && holds(path)) return deny(reviewDeleteReason(raw));
    }
  }
  return '';
}

/**
 * PreToolUse hook: the wall. While a build in this checkout is active, writes to permanent rules, gate answers and
 * docs/superpowers are refused unless the cockpit approved a permit for that exact file, and so are a repo's review
 * answers (reviewGuard). With no build active, only a build's gate answers are refused, while its folder exists.
 * Returns '' to allow.
 */
export function runGuard(input: GuardInput, opts: GuardOptions): string {
  try {
    if (typeof input.cwd !== 'string' || !input.cwd) return '';
    const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
    const toolInput = typeof input.tool_input === 'object' && input.tool_input !== null ? (input.tool_input as Record<string, unknown>) : {};
    const command = SHELL_TOOLS.has(tool) ? toolInput['command'] : null;
    const answering = typeof command === 'string' && postsGateAnswers(command);
    // The shell's own folder variables are the session's, not the hook's: $PWD is where the command runs.
    const env: Record<string, string | undefined> = { ...(opts.env ?? process.env), PWD: input.cwd };
    delete env['OLDPWD'];
    const fold = opts.fold ?? (opts.win || process.platform === 'darwin');
    const ctx: PathContext = { cwd: input.cwd, home: opts.home, win: opts.win, fold, hostname: opts.hostname ?? hostname() };
    // Bash's * passes over dot names; PowerShell's matches them, and so does anything that may run PowerShell.
    const dots = tool !== 'Bash' || /\b(?:pwsh|powershell)\b/i.test(typeof command === 'string' ? command : '');
    // A copy is judged by where its files land, so the shell reading asks the disk what is a folder and what is in it.
    const cwdRoot = findBuildRoot(input.cwd);
    const globs = globsFor(ctx, dots, [cwdRoot, findReviewsRoot(input.cwd)]);
    const onDisk = (p: string): string[] => pathReadings(p, ctx).flatMap((r) => (globs.has(r) ? (globs.expand(r) ?? []) : [r]));
    const firstReading = (p: string): string | null => (unmappable(p) ? null : (pathReadings(p, ctx)[0] ?? null));
    const shell: ShellOptions = {
      env,
      win: opts.win,
      isFolder: (p) => !unmappable(p) && onDisk(p).some(isFolder),
      list: (p) => {
        const r = firstReading(p);
        return r === null ? null : listFiles(r);
      },
      expand: (p) => {
        const r = firstReading(p);
        return r === null ? null : globs.expand(r);
      },
    };
    const writes = writesOf(tool, toolInput, shell);
    if (!writes.length && !answering) return '';
    // A build at or above the session's folder holds the wall up; with none, nothing here is refused.
    let building = false;
    for (let r = cwdRoot; r && !building; ) {
      building = anyActive(r);
      const up = dirname(r);
      r = up === r ? null : findBuildRoot(up);
    }
    const review = building ? reviewGuard({ writes, command: typeof command === 'string' ? command : null, dots }, ctx) : '';
    if (review) return review;
    // A build folder at or above the session, active or finished: a finished build's decommission gate is a gate too.
    if (answering && (building || holdsBuild(input.cwd))) {
      return deny('Only the user answers gates, in the cockpit. Never post answers or read the page token yourself: tell the user the gate is waiting.');
    }
    const cache = new Map<string, RootState | null>();
    const protectedTargets = (root: string): CompiledTarget[] =>
      compileTargets([...DEFAULT_TARGETS, ...configTargets(readConfig(root).config.protect)], { root, home: opts.home, win: opts.win, fold });
    const rawInput = rawInputOf(input.tool_input);
    const stateOf = (root: string): RootState | null => {
      const key = normalizePath(root, { ...ctx, cwd: '/' });
      if (cache.has(key)) return cache.get(key) ?? null;
      let active: string[];
      let permitted: string[];
      try {
        active = activeBuilds(root);
        permitted = active.length ? openPermits(root, opts.now).map((p) => normalizePath(p.target, { ...ctx, cwd: root })) : [];
      } catch {
        // An unreadable build (or gates folder) counts as active, so a failure never lowers the wall, and no permit is
        // trusted. The wall is never narrower than the guard's own fallback: the repo config's targets apply when it
        // reads (else the defaults alone), and any write whose path or input contains a fallback literal is refused.
        let targets = compileTargets(DEFAULT_TARGETS, { root, home: opts.home, win: opts.win, fold });
        try {
          targets = protectedTargets(root);
        } catch {
          // an unreadable config: the defaults and the literals stand
        }
        const state: RootState = { build: 'an unreadable build', active: ['*'], targets, permitted: [], literals: fallbackTargets(root) };
        cache.set(key, state);
        return state;
      }
      const state: RootState | null = active.length
        ? { build: active[0] ?? 'this build', active, targets: protectedTargets(root), permitted, literals: [] }
        : null;
      cache.set(key, state);
      return state;
    };
    // The nearest build root at or above `start` with a build holding the wall up: a closed repo nested in an active
    // one is walled by the active one.
    const deciding = (start: string | null): string | null => {
      for (let r = start; r; ) {
        if (stateOf(r)) return r;
        const up = dirname(r);
        r = up === r ? null : findBuildRoot(up);
      }
      return null;
    };
    // A glob's expansions join the queue as plain paths, judged like any other write.
    // `fills`: a folder a copy carries files into that nexus can't list, judged like a removal of it (anything inside
    // may change).
    const queue: (ShellWrite & { expanded?: boolean; fills?: boolean })[] = [...writes];
    for (let w = 0; w < queue.length; w++) {
      const { path: raw, removes, expanded, fills } = queue[w] ?? { path: '', removes: false };
      const unlisted = unlistedFolder(raw);
      if (unlisted !== null && !unlisted.includes(UNKNOWN)) {
        queue.push({ path: unlisted, removes: false, expanded: true, fills: true });
        continue;
      }
      if (raw.includes(UNKNOWN)) {
        // Part of the path can't be known: judged by the parts that can be seen. The tail after an unknown folder
        // ($D/CLAUDE.md, $D/.claude/rules/a.md) is matched on its own here.
        const root = deciding(cwdRoot);
        const state = root ? stateOf(root) : null;
        if (root && state) {
          // Files it can't list, into a folder it can't name: refused when the line names a protected file or folder.
          if (unlisted !== null && fallbackTargets(root).some((f) => rawInput.includes(f))) return deny(`nexus can't tell which files ${raw.split(UNKNOWN).join('…')} are, and they could be protected files during build "${state.build}". Copy named files into a named folder.`);
          const tail = unknownTail(raw, fold);
          const builds = state.active.includes('*') ? listBuilds(root) : state.active;
          const pages = builds.flatMap((b) => {
            try {
              return openedPages(root, b).map((p) => p.page.replace(/\\/g, '/'));
            } catch {
              return []; // unreadable gates: the targets alone judge it
            }
          });
          const pageTargets = pages.map((page): CompiledTarget => ({ kind: 'build', pattern: page, full: page, re: /$^/, ancestors: [] }));
          if (matchTail(tail, state.targets) || matchTail(tail, pageTargets)) {
            return deny(`nexus can't tell which file ${raw.split(UNKNOWN).join('…')} is, and it could be a protected file during build "${state.build}". Name the path directly.`);
          }
        }
        // The visible head is judged too, with a placeholder name in each unknown part: .claude/rules/$X.md is still
        // in .claude/rules/, and .build/b/gates/$G.answers.json is still an answers file. A path that is wholly
        // unknown ($f) lands on a placeholder in the session's folder, which nothing protects.
        if (!expanded) {
          const named = raw.split(UNKNOWN).join(PLACEHOLDER);
          // An unknown beside visible text in one name could be empty: ${X}CLAUDE.md may be CLAUDE.md.
          const emptied = raw
            .split(/([\\/])/)
            .map((s) => (s.includes(UNKNOWN) && s !== UNKNOWN ? s.split(UNKNOWN).join('') : s.split(UNKNOWN).join(PLACEHOLDER)))
            .join('');
          // A wholly unknown name could be any name, an answers file's included: gates/$F may be gates/x.answers.json.
          const segments = raw.split(/[\\/]/);
          const head = segments.slice(0, -1);
          const answers = segments.at(-1) === UNKNOWN ? [...head, `${UNKNOWN}.answers.json`].join('/').split(UNKNOWN).join(PLACEHOLDER) : null;
          for (const path of new Set([named, emptied, ...(answers ? [answers] : [])])) queue.push({ path, removes, expanded: true });
        }
        continue;
      }
      if (unmappable(raw)) {
        if (building) return deny(`nexus can't tell which file ${raw} is. Name the file by its drive path.`);
        continue;
      }
      // A path some shells read two ways (/w/repo) is refused if either reading is protected.
      for (const path of pathReadings(raw, ctx)) {
        // A glob names the files it takes on disk, which are judged one by one; the glob itself is judged too (a
        // literal name the shell keeps when nothing matches), and a removal's glob is matched against opened pages
        // (which a round still needs whether or not the file exists).
        const globbed = !expanded && globs.has(path);
        const glob = removes && globbed ? globs.regex(path) : null;
        if (globbed) {
          const files = globs.expand(path);
          // A glob the disk can't expand here (a **, or too many files) reaches into the folder before its first
          // glob segment, so that folder is judged as removed: .claude/** is refused, dist/** isn't.
          if (files === null) queue.push({ path: globs.head(path), removes: true, expanded: true });
          else queue.push(...files.map((f) => ({ path: f, removes, expanded: true })));
        }
        // Deleting a folder, or copying files nexus can't list into it, may change everything inside it.
        const takes = removes || fills === true;
        const doing = removes ? 'Deleting or moving' : "Copying files nexus can't list into";
        if (takes) {
          for (const inner of buildRootsInside(path)) {
            let active: string[];
            try {
              active = activeBuilds(inner);
            } catch {
              // An unreadable build folder counts as active, so a failure never lowers the wall.
              return deny(removes ? `Deleting or moving ${raw} would remove a build folder nexus can't read (${inner}). Check it before deleting.` : `${doing} ${raw} could change a build folder nexus can't read (${inner}). Copy named files instead.`);
            }
            if (active.length) return deny(removes ? `Deleting or moving ${raw} would remove the active build "${active[0] ?? ''}". Finish the build first.` : `${doing} ${raw} could change the active build "${active[0] ?? ''}". Copy named files instead.`);
          }
        }
        // Check the file's own repo and the session's repo, each against its own build, targets and permits. A repo
        // walls what is inside it; the session's repo also covers paths outside every repo (home memory). Without this,
        // a pattern that matches anywhere would let the session's repo veto a permit approved in the file's own repo.
        const fileRoot = findBuildRoot(posix.dirname(path));
        const within = (r: string): boolean => {
          const n = normalizePath(r, { ...ctx, cwd: '/' });
          return path === n || path.startsWith(n === '/' ? '/' : n + '/');
        };
        const roots = new Map<string, string>();
        for (const start of [fileRoot, cwdRoot]) {
          const r = start && (within(start) || (start === cwdRoot && !fileRoot)) ? deciding(start) : null;
          if (r) roots.set(normalizePath(r, { ...ctx, cwd: '/' }), r);
        }
        for (const r of roots.values()) {
          const state = stateOf(r);
          if (!state) continue;
          const hit = matchTarget(path, state.targets);
          if (hit) {
            if (hit.kind === 'rules' && state.permitted.includes(path)) continue;
            return deny(reason(hit.kind, state.build, raw));
          }
          // Deleting or moving a folder removes the protected files inside it; a permit names a file, never a folder.
          const holder = takes ? matchAncestor(path, state.targets) : null;
          if (holder) {
            return deny(`${doing} ${raw} would take protected files (${holder.pattern}) with it during build "${state.build}". ${removes ? 'Remove' : 'Copy'} only the files you mean to.`);
          }
          const concept = conceptRefusal(r, path, takes, ctx, state.active, glob);
          if (concept) return deny(concept);
          // The slash lets a bare folder operand (.claude) match its literal (.claude/). The whole input is checked too,
          // as the guard's own fallback does: a command can touch a file that its parsed writes don't name.
          const slashed = path.toLowerCase() + '/';
          if (state.literals.some((literal) => slashed.includes(literal) || rawInput.includes(literal))) {
            return deny(`nexus can't read the build in this repo, so it refused a write that may touch a protected file (${raw}).`);
          }
        }
        if (fileRoot && within(fileRoot)) {
          const answers = compileTargets(GATE_ANSWERS, { root: fileRoot, home: opts.home, win: opts.win, fold });
          if (matchTarget(path, answers)) return deny(reason('answers', '', raw));
          // Deleting the gates folder, the build or .build/ takes the answers with it.
          if (takes && matchAncestor(path, answers)) return deny(`${doing} ${raw} would take the build's gate answers with it. ${reason('answers', '', raw)}`);
        }
      }
    }
    return '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const raw = rawInputOf(input.tool_input);
    // Only where a build folder is at or above the session: a failing guard never blocks writes outside nexus repos.
    if (typeof input.cwd === 'string' && input.cwd && !holdsBuild(input.cwd)) return '';
    return fallbackTargets(input.cwd).some((f) => raw.includes(f)) ? deny(`The nexus guard failed (${msg}), so it refused a write that may touch a protected file.`) : '';
  }
}
