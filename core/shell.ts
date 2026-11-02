/**
 * Best-effort reading of which files a Bash or PowerShell line writes. The wall uses it to catch the common forms;
 * writes through an interpreter or a script are not seen (reference/superpowers.md records the gap).
 */

/** Stands for a part of a path the guard can't know: a substitution, an unset variable, an xargs replacement. */
export const UNKNOWN = '\u0000';

/** Where the parenthesis at `open` closes, honouring nesting and quotes; the line's end when it doesn't. */
function closingParen(line: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = open; j < line.length; j++) {
    const c = line[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
  }
  return line.length;
}

/**
 * Splits a line into simple commands of words, honouring quotes. Redirections become their own words. A command
 * substitution (`$(…)`, a backtick, PowerShell's `(…)` in an argument) is scanned as commands of its own, and leaves
 * UNKNOWN in the word it stands in, which then goes on: `$(pwd)/CLAUDE.md` is one word, UNKNOWN + `/CLAUDE.md`.
 */
export function splitCommands(line: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: string | null = null;
  /** Scans a substitution's text as commands of its own; the word gets UNKNOWN where its output goes. */
  const substitute = (inner: string): void => {
    commands.push(...splitCommands(inner));
    word += UNKNOWN;
    inWord = true;
  };
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? '';
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === '$' && line[i + 1] === '(') {
        // A substitution inside double quotes still runs.
        const end = closingParen(line, i + 1);
        substitute(line.slice(i + 2, end));
        i = end;
      } else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
      continue;
    }
    if (c === '>') {
      // "2>" and "&>" put a descriptor before the operator: drop it rather than treat it as a word.
      if (inWord && /^(\d+|&)$/.test(word)) {
        word = '';
        inWord = false;
      } else endWord();
      if (line[i + 1] === '>') {
        i++;
        words.push('>>');
      } else {
        words.push('>');
        // ">|" is the clobbering redirect.
        if (line[i + 1] === '|') i++;
      }
      // "2>&1" duplicates a descriptor; mark it so the next word isn't read as a file.
      if (line[i + 1] === '&') {
        i++;
        words.push('&');
      }
      continue;
    }
    if (c === '<') {
      endWord();
      words.push('<');
      continue;
    }
    if (c === '&' && line[i + 1] === '>') {
      endWord();
      word = '&';
      inWord = true;
      continue;
    }
    if (c === '$' && line[i + 1] === '(') {
      const end = closingParen(line, i + 1);
      substitute(line.slice(i + 2, end));
      i = end;
      continue;
    }
    if (c === '`') {
      const close = line.indexOf('`', i + 1);
      const end = close < 0 ? line.length : close;
      substitute(line.slice(i + 1, end));
      i = end;
      continue;
    }
    // PowerShell's "(Join-Path a b)" as an argument: its value is unknown. At a command's start it's a subshell.
    if (c === '(' && !inWord && words.length > 0) {
      const end = closingParen(line, i);
      substitute(line.slice(i + 1, end));
      i = end;
      continue;
    }
    // Subshells and groups bound a command; "{" and "}" only when they stand alone as words.
    const standsAlone = !inWord && /^\s?$/.test(line[i + 1] ?? '');
    if (c === '(' || c === ')' || ((c === '{' || c === '}') && standsAlone)) {
      endCommand();
      continue;
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      endCommand();
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      continue;
    }
    word += c;
    inWord = true;
  }
  endCommand();
  return commands;
}


const MAX_WRAPPER_DEPTH = 3;

/** Value-taking PowerShell parameters, so their value is not mistaken for a positional path. */
const POWERSHELL_VALUE_PARAMS = new Set(['-path', '-literalpath', '-filepath', '-destination', '-value', '-encoding', '-inputobject', '-newname', '-itemtype', '-type', '-name', '-target']);
const SED_SCRIPT_FLAGS = new Set(['-e', '-f', '--expression', '--file']);

/** Commands that run another command: skipped (with their own dash options) to reach the real one. */
const PREFIX_COMMANDS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec', 'xargs']);

/** Delete, truncate and tee-style commands: every positional is a target. */
const ALL_OPERANDS = new Set(['tee', 'truncate', 'rm', 'del', 'erase', 'rmdir', 'rd', 'unlink', 'touch', 'remove-item', 'ri']);
/** PowerShell writers whose first positional is the path (a later one is the value). */
const FIRST_OPERAND = new Set(['set-content', 'add-content', 'clear-content', 'out-file', 'new-item', 'rename-item', 'sc', 'ac', 'clc', 'ni', 'rni', 'ren']);
/** Copy, move and link commands: the last operand (or the target directory) is written. */
const DESTINATION = new Set(['cp', 'mv', 'install', 'ln', 'copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi']);
/** Commands that remove what they name: a folder operand takes everything under it. */
const REMOVES = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'unlink', 'remove-item', 'ri']);
/** A rename removes its path, like a move removes its sources. */
const RENAMES = new Set(['rename-item', 'rni', 'ren']);
/** Move commands, whose sources are removed too. */
const MOVES = new Set(['mv', 'move', 'move-item', 'mi']);
/** Copy and move cmdlets (and cmd's copy and move), which take -Recurse rather than a POSIX flag cluster. */
const CMDLET_COPIES = new Set(['copy-item', 'move-item', 'cpi', 'mi', 'copy', 'move']);
const TARGET_DIRECTORY_OPTIONS = ['-t', '--target-directory'];

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const POWERSHELLS = new Set(['pwsh', 'powershell']);

/** Names shared between PowerShell aliases and POSIX commands, which may take PowerShell parameters. */
const POWERSHELL_ALIASES = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'cp', 'mv', 'copy', 'move', 'ri', 'sc', 'ac', 'ni', 'rni', 'ren', 'clc', 'cpi', 'mi']);

const VALUE_OPTIONS_BY_COMMAND: Record<string, Set<string>> = {
  touch: new Set(['-t', '-d', '-r', '--date', '--reference']),
  install: new Set(['-m', '-o', '-g', '--mode', '--owner', '--group']),
  truncate: new Set(['-s', '-r', '--size', '--reference']),
};

function isPowerShellName(cmd: string): boolean {
  return cmd.includes('-') || POWERSHELL_ALIASES.has(cmd);
}

/** "-Path:value" is "-Path value". */
function splitColonParams(args: string[]): string[] {
  return args.flatMap((a) => {
    const m = /^(-[A-Za-z]+):(.+)$/.exec(a);
    const name = m?.[1];
    const value = m?.[2];
    return name !== undefined && value !== undefined ? [name, value] : [a];
  });
}

function positional(args: string[], valueOptions: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a.startsWith('-')) {
      if (valueOptions.has(a.toLowerCase())) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function optionValue(args: string[], names: string[]): string | null {
  for (let i = 0; i < args.length - 1; i++) {
    if (names.includes((args[i] ?? '').toLowerCase())) return args[i + 1] ?? null;
  }
  return null;
}

/** The directory named by -t DIR, --target-directory DIR or --target-directory=DIR. */
function targetDirectory(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-t' || a === '--target-directory') return args[i + 1] ?? null;
    if (a.startsWith('--target-directory=')) return a.slice('--target-directory='.length);
  }
  return null;
}

function basenameOf(word: string): string {
  const base = word.split(/[\\/]/).at(-1) ?? word;
  return base.toLowerCase().replace(/\.exe$/, '');
}

/** Words that open a clause, so the command after them is the one that runs (`do rm x`, `then rm x`). */
const SHELL_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!']);

/** A prefix command's options that take a value, so the value isn't read as the command. */
const PREFIX_VALUE_OPTIONS: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-U', '-D', '-r', '-t', '-T']),
  xargs: new Set(['-n', '-L', '-P', '-s', '-d', '-E', '-a']),
  env: new Set(['-u', '-C', '-S']),
  time: new Set(['-f', '-o']),
};

/** The replacement string an xargs option sets (-I {}, -I{}, -i, --replace=…), or null for any other option. */
function xargsReplace(option: string, next: string | undefined): { replace: string; takesNext: boolean } | null {
  if (option === '-I') return next === undefined ? null : { replace: next, takesNext: true };
  if (option.startsWith('-I')) return { replace: option.slice(2), takesNext: false };
  if (option === '-i' || option === '--replace') return { replace: '{}', takesNext: false };
  if (option.startsWith('--replace=')) return { replace: option.slice('--replace='.length), takesNext: false };
  if (option.startsWith('-i')) return { replace: option.slice(2), takesNext: false };
  return null;
}

/**
 * Finds the command word, skipping VAR=val assignments and prefixes such as env, sudo, time and xargs with their
 * options (and the values those take). `replace` is the string xargs swaps for each input line, if one is set.
 */
function commandStart(rest: string[]): { k: number; replace: string | null } {
  let k = 0;
  let replace: string | null = null;
  while (k < rest.length) {
    const w = rest[k] ?? '';
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || SHELL_KEYWORDS.has(w)) k++;
    else if (PREFIX_COMMANDS.has(basenameOf(w))) {
      const prefix = basenameOf(w);
      const values = PREFIX_VALUE_OPTIONS[prefix] ?? new Set<string>();
      k++;
      while ((rest[k] ?? '').startsWith('-')) {
        const option = rest[k] ?? '';
        k++;
        if (option === '--') break;
        const set = prefix === 'xargs' ? xargsReplace(option, rest[k]) : null;
        if (set) {
          replace = set.replace;
          if (set.takesNext) k++;
        } else if (values.has(option)) k++;
      }
    } else break;
  }
  return { k, replace };
}

function sedTargets(args: string[]): string[] {
  let inPlace = false;
  let scripted = false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (SED_SCRIPT_FLAGS.has(a)) {
      scripted = true;
      i++;
    } else if (a.startsWith('--expression=') || a.startsWith('--file=')) scripted = true;
    else if (a === '--in-place' || a.startsWith('--in-place=')) inPlace = true;
    else if (a.startsWith('--')) continue;
    else if (a.length > 1 && a.startsWith('-')) {
      if (/^-[A-Za-z]*i/.test(a)) inPlace = true;
      // A cluster ending in e or f takes the next word as its script or script file.
      if (/^-[A-Za-z]*[ef]$/.test(a)) {
        scripted = true;
        i++;
      }
    } else operands.push(a);
  }
  if (!inPlace) return [];
  return scripted ? operands : operands.slice(1);
}

/** The command string a shell wrapper runs (bash -c "...", pwsh -Command "...", cmd /c ...), or null. */
function wrappedCommand(cmd: string, args: string[]): string | null {
  if (POSIX_SHELLS.has(cmd)) {
    const at = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    return at >= 0 ? (args[at + 1] ?? null) : null;
  }
  if (POWERSHELLS.has(cmd)) {
    const at = args.findIndex((a) => ['-command', '-c'].includes(a.toLowerCase()));
    return at >= 0 ? args.slice(at + 1).join(' ') : null;
  }
  if (cmd === 'cmd') {
    const at = args.findIndex((a) => ['/c', '/k'].includes(a.toLowerCase()));
    return at >= 0 ? args.slice(at + 1).join(' ') : null;
  }
  return null;
}

/** A file or folder a command writes; `removes` when the command deletes it, so a folder takes its contents along. */
export interface ShellWrite { path: string; removes: boolean }

const written = (paths: string[], removes = false): ShellWrite[] => paths.map((path) => ({ path, removes }));

function commandTargets(cmd: string, rawArgs: string[]): Planned[] {
  const powerShell = isPowerShellName(cmd);
  const args = powerShell ? splitColonParams(rawArgs) : rawArgs;
  const valueOptions = powerShell ? POWERSHELL_VALUE_PARAMS : (VALUE_OPTIONS_BY_COMMAND[cmd] ?? new Set<string>());
  const pathParam = optionValue(args, ['-path', '-literalpath', '-filepath']);
  // PowerShell reads "a.md,b.md" as a list of two paths.
  const lists = (paths: string[]): string[] => (powerShell ? paths.flatMap((p) => p.split(',').filter(Boolean)) : paths);
  if (cmd === 'sed') return written(sedTargets(args));
  if (ALL_OPERANDS.has(cmd)) return written(lists([...(pathParam ? [pathParam] : []), ...positional(args, valueOptions)]), REMOVES.has(cmd));
  if (FIRST_OPERAND.has(cmd)) {
    const operands = positional(args, valueOptions);
    const path = pathParam ?? operands[0];
    if (!path) return [];
    // New-Item -Path DIR -Name FILE makes DIR/FILE.
    const name = cmd === 'new-item' || cmd === 'ni' ? optionValue(args, ['-name']) : null;
    if (name) return written(lists([path]).map((p) => joined(p, name)));
    if (!RENAMES.has(cmd)) return written(lists([path]));
    // A rename removes its path and writes its new name, which sits in the same folder.
    const newName = optionValue(args, ['-newname']) ?? (pathParam ? operands[0] : operands[1]);
    const folder = path.replace(/[^\\/]*[\\/]*$/, '');
    if (newName === undefined || newName === null) return written([path], true);
    // A name with a separator is a path of its own; a bare name sits in the path's folder.
    const target = /[\\/]/.test(newName) ? newName : folder + newName;
    return [...written([path], true), ...(target ? written([target]) : [])];
  }
  if (DESTINATION.has(cmd)) {
    const operands = positional(args, new Set([...valueOptions, ...TARGET_DIRECTORY_OPTIONS]));
    const directory = targetDirectory(args);
    const named = directory ?? optionValue(args, ['-destination']);
    const dest = named ?? operands.at(-1);
    // Every operand but the destination, plus -Path. A move deletes them.
    const sources = lists([...(pathParam ? [pathParam] : []), ...(named === null ? operands.slice(0, -1) : operands)]);
    if (!dest) return written(MOVES.has(cmd) ? sources : [], true);
    // A folder destination is certain from a trailing separator, -t or several sources; otherwise it is the
    // destination's existing folder, which only the caller can see (isFolder).
    const folder = directory !== null || /[\\/]$/.test(dest) || sources.length > 1;
    // -T (cp's --no-target-directory, alone or in a cluster such as -rT) copies a folder's contents into dest.
    const contents = args.some((a) => a === '--no-target-directory' || /^-[a-zA-Z]{0,4}T[a-zA-Z]{0,4}$/.test(a));
    // Copies and moves carry whole folders; a link or an install names one file. `recursive`: a copy that says so, so a
    // source it can't name may be a folder of anything. A cmdlet says it with -Recurse or any abbreviation of it; a
    // POSIX command with -r, -R or -a in a short cluster, --recursive or --archive (never with a cmdlet parameter
    // such as -Path, which cp as a PowerShell alias also takes).
    const tree = cmd !== 'ln' && cmd !== 'install';
    const recurses = (a: string): boolean =>
      (a.length >= 4 && '-recurse'.startsWith(a.toLowerCase())) ||
      (!CMDLET_COPIES.has(cmd) && (/^--(?:recursive|archive)$/.test(a) || (/^-[a-zA-Z]{1,4}$/.test(a) && /[rRa]/.test(a.slice(1)) && !POWERSHELL_VALUE_PARAMS.has(a.toLowerCase()))));
    const recursive = tree && args.some(recurses);
    return [...written(MOVES.has(cmd) ? sources : [], true), ...written([dest]), { copy: { sources, dest, folder, contents, tree, recursive } }];
  }
  return [];
}

/** A copy, move or link, resolved in shellWrites, where variables are known and the caller can ask the disk. */
interface Copy { sources: string[]; dest: string; folder: boolean; contents: boolean; tree: boolean; recursive: boolean }
type Planned = ShellWrite | { copy: Copy };

/** Commands that change the shell's folder, and the stack pushd and popd keep. */
const CD = new Set(['cd', 'chdir', 'set-location', 'sl']);
const PUSHD = new Set(['pushd', 'push-location']);
const POPD = new Set(['popd', 'pop-location']);

/** A path that doesn't depend on the shell's folder: rooted, on a drive, or from home. */
function anchored(path: string): boolean {
  return /^(?:[a-zA-Z]:|[\\/]|~|\$home\b|\$\{home\}|\$env:userprofile\b|%userprofile%)/i.test(path);
}

/** A path as seen from `dir`, the folder a cd moved to (null: the session's own folder). */
function under(dir: string | null, path: string): string {
  return dir === null || anchored(path) ? path : `${dir}/${path}`;
}

function rebase(p: Planned, dir: string | null): Planned {
  if (dir === null) return p;
  if ('copy' in p) return { copy: { ...p.copy, sources: p.copy.sources.map((s) => under(dir, s)), dest: under(dir, p.copy.dest) } };
  return { path: under(dir, p.path), removes: p.removes };
}

/**
 * What a line writes, with each relative path taken from the folder the line's cds moved to. A line with a subshell or
 * a substitution (where a cd may not last) has each write judged from both folders.
 */
function writeTargets(line: string, depth: number, start: string | null): Planned[] {
  const targets: Planned[] = [];
  const subshell = /[(`]/.test(line);
  let dir = start;
  const stack: (string | null)[] = [];
  const add = (found: Planned[]): void => {
    for (const p of found) {
      if (subshell && dir !== start) targets.push(rebase(p, start));
      targets.push(rebase(p, dir));
    }
  };
  for (const words of splitCommands(line)) {
    const rest: string[] = [];
    const redirects: Planned[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i] ?? '';
      if (w === '>' || w === '>>') {
        const next = words[i + 1];
        if (next === '&') {
          i += 2;
          continue;
        }
        if (next !== undefined) redirects.push({ path: next, removes: false });
        i++;
        continue;
      }
      if (w === '<') {
        i++;
        continue;
      }
      rest.push(w);
    }
    add(redirects);
    const { k, replace } = commandStart(rest);
    const cmd = basenameOf(rest[k] ?? '');
    // Each input line xargs reads takes the replacement string's place, so that part of an operand is unknown.
    const args = rest.slice(k + 1).map((a) => (replace ? a.split(replace).join(UNKNOWN) : a));
    if (CD.has(cmd) || PUSHD.has(cmd)) {
      // cd DIR, cd /d DIR, Set-Location -Path DIR. A bare cd, cd - or more than one operand leaves the folder unknown.
      const operands = positional(args.filter((a) => a.toLowerCase() !== '/d'), POWERSHELL_VALUE_PARAMS);
      const target = optionValue(args, ['-path', '-literalpath']) ?? (operands.length === 1 ? operands[0] : undefined);
      if (PUSHD.has(cmd)) stack.push(dir);
      dir = args.includes('-') || target === undefined ? UNKNOWN : under(dir, target);
      continue;
    }
    if (POPD.has(cmd)) {
      dir = stack.length ? (stack.pop() ?? null) : UNKNOWN;
      continue;
    }
    const wrapped = wrappedCommand(cmd, args);
    if (wrapped !== null) {
      // The wrapped line starts in this folder; its own cds end with it.
      if (depth < MAX_WRAPPER_DEPTH) targets.push(...writeTargets(wrapped, depth + 1, dir));
      continue;
    }
    add(commandTargets(cmd, args));
  }
  return targets;
}

/** Names a line sets before using them (`X=…`, `export X=…`, `$X = …`, `for X in`, `read X`), so their value is unknown. */
function assignedNames(line: string): Set<string> {
  const out = new Set<string>();
  const patterns = [
    /(?:^|[\s;&|(])(?:export\s+|local\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)=/g,
    /\$(?:env:)?([A-Za-z_]\w*)\s*=(?!=)/gi,
    /\bfor\s+([A-Za-z_]\w*)\s+in\b/g,
    /\bforeach\s*\(\s*\$([A-Za-z_]\w*)/gi,
    /\bread\s+(?:-\w+\s+)*([A-Za-z_]\w*)/g,
    /\bset\s+([A-Za-z_]\w*)=/gi,
  ];
  for (const re of patterns) for (const m of line.matchAll(re)) if (m[1]) out.add(m[1].toLowerCase());
  // A line that changes folder changes $PWD too.
  if (/\b(?:cd|chdir|pushd|popd|set-location|push-location|pop-location|sl)\b/i.test(line)) out.add('pwd');
  return out;
}

/** $X, ${X}, $env:X and %X%. */
const VARIABLE = /\$\{([A-Za-z_]\w*)\}|\$env:([A-Za-z_]\w*)|\$([A-Za-z_]\w*)|%([A-Za-z_]\w*)%/gi;
/** Home at a path's start is left for normalizePath, which expands it. */
const HOME_NAMES = new Set(['home', 'userprofile']);

/**
 * What the caller can see on disk, so a copy is judged by where its files land. `isFolder`: whether a path is an
 * existing folder. `list`: the paths inside a folder, relative to it (null when it can't list them all). `expand`: the
 * paths a source glob names (null when it can't tell). Each is given the path as the line names it.
 */
export interface ShellOptions {
  env?: Record<string, string | undefined>;
  win?: boolean;
  isFolder?: (path: string) => boolean;
  list?: (folder: string) => string[] | null;
  expand?: (glob: string) => string[] | null;
}

/** Stands for files a copy carries that can't be listed: some path, at any depth, below the folder it is joined to. */
const UNLISTED = `${UNKNOWN}/${UNKNOWN}`;

/**
 * Puts each variable's value in place: from the environment the hook runs in, unless the line sets the name itself.
 * Anything else becomes UNKNOWN.
 */
function resolveVariables(path: string, opts: ShellOptions, assigned: Set<string>): string {
  const env = opts.env ?? {};
  const lookup = (name: string): string | undefined => {
    if (assigned.has(name.toLowerCase())) return undefined;
    if (env[name] !== undefined) return env[name];
    if (!opts.win) return undefined;
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : env[key];
  };
  return path.replace(VARIABLE, (whole: string, braced?: string, envName?: string, plain?: string, percent?: string, at?: number) => {
    const name = braced ?? envName ?? plain ?? percent ?? '';
    if (at === 0 && HOME_NAMES.has(name.toLowerCase())) return whole;
    return lookup(name) ?? UNKNOWN;
  });
}

const joined = (base: string, rel: string): string => (/[\\/]$/.test(base) ? base + rel : `${base}/${rel}`);

/**
 * Where a copy's files land, besides the destination itself. Into a folder each source lands as <folder>/<its name>;
 * a source's contents (`src/.`, -T) land in the destination directly; a folder copied whole carries every path in it.
 * A source it can't name, or a folder it can't list, carries UNLISTED.
 */
function landings(copy: Copy, resolve: (p: string) => string, opts: ShellOptions): ShellWrite[] {
  const dest = resolve(copy.dest);
  const into = copy.folder || dest.includes(UNKNOWN) || (opts.isFolder?.(dest) ?? false);
  const paths = new Set<string>();
  for (const raw of copy.sources) {
    const source = resolve(raw);
    const glob = !source.includes(UNKNOWN) && /[*?[]/.test(source) && opts.expand;
    const items = glob ? (opts.expand?.(source) ?? [UNKNOWN]) : [source];
    for (const item of items) {
      const name = item.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? item;
      const contents = copy.contents || name === '.' || name === '..';
      // A -T read from a flag could be a PowerShell parameter (-PassThru), so both landings count then.
      const bases = new Set([contents || !into ? dest : joined(dest, name), ...(copy.contents && into && !/^\.\.?$/.test(name) ? [joined(dest, name)] : [])]);
      for (const base of bases) paths.add(base);
      if (item.includes(UNKNOWN)) {
        // It could be a folder of anything.
        if (copy.recursive) paths.add(joined(dest, UNLISTED));
        continue;
      }
      if (!copy.tree || !(contents || (opts.isFolder?.(item) ?? false))) continue;
      const files = opts.list?.(item) ?? null;
      for (const base of bases) {
        if (files === null) paths.add(joined(base, UNLISTED));
        else for (const f of files) paths.add(joined(base, f));
      }
    }
  }
  paths.delete(dest);
  return [...paths].map((path) => ({ path, removes: false }));
}

export function shellWrites(line: string, opts: ShellOptions = {}): ShellWrite[] {
  const assigned = assignedNames(line);
  const resolve = (p: string): string => resolveVariables(p, opts, assigned);
  const out: ShellWrite[] = [];
  for (const p of writeTargets(line, 0, null)) {
    if ('copy' in p) out.push(...landings(p.copy, resolve, opts));
    else out.push({ path: resolve(p.path), removes: p.removes });
  }
  return out;
}

/** HTTP clients by name. `fetch` counts in any form; `git fetch` is removed from the line before this is tested. */
const HTTP_CLIENT = /\b(?:curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|fetch)\b/;
// Spaces and tabs only: a newline ends the statement, so "git⏎fetch(...)" is a variable and a real fetch call.
const GIT_FETCH = /\bgit[ \t]+fetch\b/g;

/**
 * True when a line looks like it talks to the cockpit's answer routes (a gate's or a review's) or its page token
 * through an HTTP client. Only the user answers gates and reviews; best effort, like the write checks: a script or an
 * unusual client isn't seen.
 */
export function postsGateAnswers(line: string): boolean {
  const text = line.toLowerCase();
  if (!HTTP_CLIENT.test(text.replace(GIT_FETCH, ''))) return false;
  return text.includes('nexus-token') || ((text.includes('/gates/') || text.includes('/reviews/')) && text.includes('/answers'));
}
