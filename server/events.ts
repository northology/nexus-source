import { existsSync, readdirSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from '../core/config.ts';
import { fold, fsCode, linkRefusal } from '../core/fs-guard.ts';
import { inventorySignature } from '../core/governance/inventory.ts';
import { walkSubfolders } from '../core/governance/subfolders.ts';
import type { Found, InventoryEnv, InventoryProblem } from '../core/governance/types.ts';
import { BUILD_DIR } from '../core/paths.ts';
import { LEDGER_DIR } from '../core/progress.ts';
import { reviewsDir } from '../core/review-files.ts';
import { revisionOf, ruleFiles } from '../core/rules.ts';
import { viewSignature } from '../core/views/read.ts';

/**
 * Calls onChange(buildName) after files under .build/ change, debounced per build; null means "reload everything".
 * Uses fs.watch (recursive) and falls back to polling when watching fails or .build/ doesn't exist yet. A recursive
 * watch on Windows goes silent, with no error, when its folder is deleted and recreated (a branch checkout does
 * that), so the folder's identity is checked every identityMs: when it vanishes or comes back as a new folder, the
 * watch is re-armed and a full refresh is pushed. The same tick also watches the run ledgers under
 * `.superpowers/sdd/`, which sit outside `.build/`, and pushes a full refresh when one changes.
 */
export function watchBuilds(
  root: string,
  onChange: (build: string | null) => void,
  opts: { pollMs?: number; debounceMs?: number; forcePolling?: boolean; identityMs?: number } = {},
): () => void {
  const dir = join(root, BUILD_DIR);
  const debounceMs = opts.debounceMs ?? 120;
  const pending = new Map<string, NodeJS.Timeout>();
  // stop() is authoritative: a watch event already queued when it ran must not schedule a later onChange.
  let stopped = false;
  const fire = (build: string | null): void => {
    if (stopped) return;
    const key = build ?? '';
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        if (!stopped) onChange(build);
      }, debounceMs),
    );
  };

  let watcher: FSWatcher | null = null;
  let poll: NodeJS.Timeout | null = null;
  const startPolling = (): void => {
    let last = signature(root, dir);
    poll = setInterval(() => {
      const next = signature(root, dir);
      if (next !== last) {
        last = next;
        fire(null);
      }
    }, opts.pollMs ?? 1500);
  };
  const disarm = (): void => {
    watcher?.close();
    watcher = null;
    if (poll) clearInterval(poll);
    poll = null;
  };
  const arm = (): void => {
    try {
      // A .build that is a link to a network or device path, or another drive, is neither watched nor polled.
      if (linkRefusal(root, dir) !== null) return;
      if (opts.forcePolling || !existsSync(dir)) throw new Error('polling');
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        const f = filename ? String(filename) : '';
        if (f.endsWith('.tmp')) return;
        const first = f.split(/[\\/]/)[0] ?? '';
        // Dotfiles directly in .build/ (like .gitattributes) aren't builds.
        if (first.startsWith('.')) return;
        fire(first || null);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
        if (!stopped && !poll) startPolling();
      });
    } catch {
      if (!poll) startPolling();
    }
  };

  // Read before arming: a .build/ that appears between the two calls then still differs from `id` at the first check.
  let id = identity(root, dir);
  let ledgers = ledgerSignature(root);
  let rules = rulesSignature(root);
  arm();
  const check = setInterval(() => {
    if (stopped) return;
    const nextLedgers = ledgerSignature(root);
    const nextRules = rulesSignature(root);
    if (nextLedgers !== ledgers || nextRules !== rules) {
      ledgers = nextLedgers;
      rules = nextRules;
      fire(null);
    }
    const next = identity(root, dir);
    if (next === id) return;
    id = next;
    disarm();
    arm();
    fire(null);
  }, opts.identityMs ?? 2000);

  return () => {
    stopped = true;
    clearInterval(check);
    disarm();
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
  };
}

/** The repo config and the static rules files it lists, so the cockpit shows a rules file as it's edited. */
function rulesSignature(root: string): string {
  try {
    return [revisionOf(join(root, CONFIG_FILE)) ?? '', ...ruleFiles(root).rules.map((r) => r.revision ?? '')].join('|');
  } catch {
    return '';
  }
}

/** Which folder .build/ is right now: '' when missing, otherwise its inode and birth time. */
function identity(root: string, dir: string): string {
  if (linkRefusal(root, dir) !== null) return '';
  try {
    const s = statSync(dir);
    return `${s.ino}:${s.birthtimeMs}`;
  } catch {
    return '';
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The run ledgers' modified times and sizes, so the Plan section follows execution as it writes them. A ledger folder
 * may be a link (findLedgers reads linked workspace folders), but its links are checked first: one that leads to a
 * network or device path, or another drive, is skipped and never followed.
 */
export function ledgerSignature(root: string): string {
  const base = join(root, ...LEDGER_DIR);
  let names: string[];
  if (linkRefusal(root, base) !== null) return '';
  try {
    names = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() || (d.isSymbolicLink() && linkRefusal(root, join(base, d.name)) === null))
      .map((d) => d.name);
  } catch {
    return '';
  }
  return names
    .map((name) => {
      try {
        const s = statSync(join(base, name, 'progress.md'));
        return `${name}:${s.mtimeMs}:${s.size}${markerSignature(join(base, name, 'plan-path'))}`;
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .sort()
    .join('|');
}

/** A workspace's plan-path marker, as `:<modified>:<size>`; nothing when it has none. */
function markerSignature(file: string): string {
  try {
    const s = statSync(file);
    return `:${s.mtimeMs}:${s.size}`;
  } catch {
    return '';
  }
}

/** The polled signature of everything under .build/: each file's path, modified time and size. Exported for tests. */
export function signature(root: string, dir: string): string {
  if (linkRefusal(root, dir) !== null || !existsSync(dir)) return '';
  const parts: string[] = [];
  // The real path of every folder walked, so a link back into a folder already seen is not entered again.
  const seen = new Set<string>();
  const walk = (d: string): void => {
    const real = fold(realpathSync.native(d));
    if (seen.has(real)) return;
    seen.add(real);
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      // A link entry is followed only when every link on its way passes the check; otherwise it is left out unread.
      if (e.isSymbolicLink() && linkRefusal(root, p) !== null) continue;
      if (e.isDirectory() || (e.isSymbolicLink() && isDir(p))) walk(p);
      else if (!e.name.endsWith('.tmp')) parts.push(`${p}:${statSync(p).mtimeMs}:${statSync(p).size}`);
    }
  };
  try {
    walk(dir);
  } catch (e) {
    // A file system failure (a folder removed mid-walk, no access) makes the signature differ; a bug is not hidden.
    if (fsCode(e) === null) throw e;
    return `error:${Date.now()}`;
  }
  return parts.sort().join('|');
}

/** Each file in .nexus/reviews/ by name, size and time: opening, answering or applying a review changes it. */
export function reviewSignature(root: string): string {
  const dir = reviewsDir(root);
  if (linkRefusal(root, dir) !== null) return '-';
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch {
    return '';
  }
  return names
    .map((n) => {
      try {
        const s = statSync(join(dir, n));
        return `${n}:${s.size}-${s.mtimeMs}`;
      } catch {
        return `${n}:-`;
      }
    })
    .join(',');
}

/** The walk's results by file, size, time and note, plus its problems: what makes the Repo view refresh. */
export function subfolderSignature(found: Found[], problems: InventoryProblem[]): string {
  const files = found.map((f) => {
    try {
      const s = statSync(f.file);
      return `${f.file}|${s.size}-${s.mtimeMs}|${f.conditional ?? ''}`;
    } catch {
      return `${f.file}|-`;
    }
  });
  return [...files, ...problems.map((p) => `!${p.location}|${p.message}`)].join('\n');
}

type Walk = { found: Found[]; problems: InventoryProblem[] };

export interface SubfolderCache {
  /** The last walk, walking first when there is none or it is older than staleMs. */
  get(): Walk;
  /** Walks now; true when the result differs from the last walk's. A walk that throws keeps the last files and names the failure. */
  walk(): boolean;
}

/**
 * The server's copy of the walk below the repo root (core/governance/subfolders.ts), which is too slow for the 2 s
 * poll: /api/repo reads it through get(), so opening the Repo view walks at most once per staleMs (the walk is
 * synchronous), and watchSubfolders refreshes it on its own cadence. `onChange` is called when a walk that get()
 * made finds a change, which the timer's next walk would no longer see; walk() itself only returns it.
 */
export function subfolderCache(
  root: string,
  env: InventoryEnv,
  opts: { staleMs?: number; now?: () => number; walk?: (root: string, env: InventoryEnv) => Walk; onChange?: () => void } = {},
): SubfolderCache {
  const staleMs = opts.staleMs ?? 5000;
  const now = opts.now ?? Date.now;
  const run = opts.walk ?? ((r: string, e: InventoryEnv) => walkSubfolders(r, e));
  let last: Walk | null = null;
  let lastSig = '';
  let at = -Infinity;
  const walk = (): boolean => {
    let next: Walk;
    try {
      next = run(root, env);
    } catch (e) {
      next = { found: last?.found ?? [], problems: [{ location: root, message: `the walk below the repo failed: ${(e as Error).message}` }] };
    }
    const sig = subfolderSignature(next.found, next.problems);
    const changed = last !== null && sig !== lastSig;
    last = next;
    lastSig = sig;
    at = now();
    return changed;
  };
  return {
    get() {
      if ((last === null || now() - at > staleMs) && walk()) opts.onChange?.();
      return last ?? { found: [], problems: [] };
    },
    walk,
  };
}

/** Walks every intervalMs (30 s by default) and calls onChange when the result differs. */
export function watchSubfolders(cache: SubfolderCache, onChange: () => void, intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    if (cache.walk()) onChange();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Everything the repo view shows that can change, by stat (spec §3): inventorySignature (each item's location, size
 * and time, each problem, and the builds' guardrail logs and gates), plus each declared view's note and data
 * (viewSignature says exactly what is tracked), and each review file. An unchanged repo is polled without reading
 * any file's contents.
 */
export function repoSignature(root: string, env: InventoryEnv): string {
  return `${inventorySignature(root, env)}\n--\n${viewSignature(root)}\n--\n${reviewSignature(root)}`;
}

/**
 * Calls onChange after anything the repo view shows changes. One poll of repoSignature every pollMs (a memory folder
 * created later is picked up by construction), plus a check shortly after any fs.watch event under docs/, .claude/ or
 * .nexus/ (a burst of events schedules one check, not one per event). Never creates a folder.
 *
 * A signature that throws, at start or on a poll, is non-fatal: the poll skips that round and tries again. A
 * persistently failing signature is silent (no log, no event); until it recovers nothing is announced. The first
 * successful signature after a failed start becomes the baseline and doesn't count as a change.
 * `signature` is injectable for tests.
 */
export function watchRepo(
  root: string,
  env: InventoryEnv,
  onChange: () => void,
  opts: { pollMs?: number; debounceMs?: number; fsCoalesceMs?: number; signature?: (root: string, env: InventoryEnv) => string } = {},
): () => void {
  const pollMs = opts.pollMs ?? 2000;
  const debounceMs = opts.debounceMs ?? 200;
  const fsCoalesceMs = opts.fsCoalesceMs ?? 100;
  const signature = opts.signature ?? repoSignature;
  let last: string | null;
  try {
    last = signature(root, env);
  } catch {
    last = null;
  }
  let timer: NodeJS.Timeout | null = null;
  let fsTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  const check = (): void => {
    if (stopped) return;
    let next: string;
    try {
      next = signature(root, env);
    } catch {
      return;
    }
    if (last === null) {
      last = next;
      return;
    }
    if (next === last) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
    timer.unref();
  };
  const onFsEvent = (): void => {
    if (stopped || fsTimer) return;
    fsTimer = setTimeout(() => {
      fsTimer = null;
      check();
    }, fsCoalesceMs);
    fsTimer.unref();
  };
  const poll = setInterval(check, pollMs);
  poll.unref();
  const watchers: FSWatcher[] = [];
  for (const dir of [join(root, 'docs'), join(root, '.claude'), join(root, '.nexus')]) {
    if (!existsSync(dir)) continue;
    try {
      const w = watch(dir, { recursive: true }, onFsEvent);
      w.on('error', () => {});
      watchers.push(w);
    } catch {
      // The poll still covers it.
    }
  }
  return () => {
    stopped = true;
    clearInterval(poll);
    if (timer) clearTimeout(timer);
    if (fsTimer) clearTimeout(fsTimer);
    for (const w of watchers) w.close();
  };
}
