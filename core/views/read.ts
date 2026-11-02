import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { NexusError } from '../errors.ts';
import { driveOf, fold, fsCode, isInside, linkRefusal, refusalText } from '../fs-guard.ts';
import { isVault, META, readRegistry } from '../vault/registry.ts';
import type { ViewDef } from '../vault/types.ts';
import { DATA_CAP, ParseError, tableFromText } from './data.ts';
import type { GalleryData, ViewAnswer, ViewData, ViewSummary } from './types.ts';

export const IMAGE_CAP = 10 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

const posix = (p: string): string => p.replace(/\\/g, '/');
const extOf = (f: string): string => extname(f).toLowerCase();
const isImage = (f: string): boolean => Object.hasOwn(IMAGE_TYPES, extOf(f));

class Refused extends Error {}

/** The repo as one call sees it: `real` is the repo root's canonical path (native, so short names and aliases resolve), computed once. */
interface Repo { root: string; real: string }
const repoOf = (root: string): Repo => ({ root, real: realpathSync.native(root) });

/** .git is never read, at any depth. A view's data also stays out of docs (top level), where the views themselves live. */
const NO_TOP: string[] = [];
const NO_TOP_DATA = ['docs'];

/**
 * The shared link walk (core/fs-guard.ts), with the view's own messages: a link whose text names a network or device
 * path or another drive is refused before anything follows it.
 */
function guardLinks(from: string, path: string, shown: string, view: string, drive: string | null): void {
  const r = linkRefusal(from, path, drive);
  if (r === null) return;
  if (r.why === 'too-many') throw new Refused(`view "${view}": ${shown} leads through too many links; not read`);
  if (r.why === 'unchecked') throw new Refused(`view "${view}": ${shown} can't be checked for links (${r.code}); not read`);
  throw new Refused(`view "${view}": ${shown} leads outside the repo; not read`);
}

/**
 * The canonical file behind a path, which must stay inside the repo and never reach .git (or a `noTop` folder at its top); null when nothing is
 * there. The path's text is judged first, so an absolute or UNC path from repo content is refused without a filesystem
 * call. For a path inside the repo, the link walk then lstats each link and its targets and refuses network and device
 * paths and other drives by their text before anything follows them, and refuses a path it couldn't finish walking;
 * only then is the path resolved.
 */
function inRepo(repo: Repo, abs: string, view: string, noTop: string[] = NO_TOP): string | null {
  const full = resolve(abs);
  const textInside = isInside(resolve(repo.root), full);
  const shown = posix(textInside ? relative(repo.root, full) : abs);
  if (!textInside) throw new Refused(`view "${view}": ${shown} leads outside the repo; not read`);
  guardLinks(resolve(repo.root), full, shown, view, driveOf(resolve(repo.root)));
  if (!existsSync(full)) return null;
  const real = realpathSync.native(full);
  if (!isInside(repo.real, real)) throw new Refused(`view "${view}": ${shown} leads outside the repo; not read`);
  const hit = relative(repo.real, real).split(sep).find((seg, i) => fold(seg) === '.git' || (i === 0 && noTop.some((b) => fold(b) === fold(seg))));
  if (hit !== undefined) throw new Refused(`view "${view}": ${shown} reaches ${hit}, which views don't read; not read`);
  return real;
}

/** `stamp`: the file's size and time from the stat that found it, so a rewrite changes it. */
type Target = { file: string; stamp: string } | { missing: true } | { refused: true };

/** For paths named by repo content: a file inside the repo, missing, or refused (it leaves the repo or reaches .git). */
function targetIn(repo: Repo, abs: string, view: string): Target {
  try {
    const f = inRepo(repo, abs, view);
    const st = f === null ? null : statSync(f);
    return f !== null && st?.isFile() ? { file: f, stamp: `${st.size}-${st.mtimeMs}` } : { missing: true };
  } catch (e) {
    if (e instanceof Refused) return { refused: true };
    throw e;
  }
}

function registryViews(root: string): { views: Map<string, ViewDef>; problems: string[] } {
  const docs = join(root, 'docs');
  // docs/ or its _meta/ as a network or device link is named, not followed.
  const refused = linkRefusal(root, join(docs, META, 'classes'));
  if (refused !== null) return { views: new Map(), problems: [`docs: ${refusalText(refused)}`] };
  if (!isVault(docs)) return { views: new Map(), problems: [] };
  const { registry, findings } = readRegistry(docs);
  return { views: registry.views, problems: findings.filter((f) => f.rule === 'view-invalid' || f.rule === 'view-file-name').map((f) => `${f.file}: ${f.message}`) };
}

export function listViews(root: string): { views: ViewSummary[]; problems: string[] } {
  const { views, problems } = registryViews(root);
  return { views: [...views.values()].map((v) => ({ name: v.name, title: v.title, type: v.type, description: v.description, file: v.file })), problems };
}

/** At most cap + 1 bytes from an open file, whatever its size claims: more than cap means it is over. */
export function readBounded(fd: number, cap: number): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= cap) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, cap + 1 - total));
    const n = readSync(fd, chunk, 0, chunk.length, null);
    if (n === 0) break;
    chunks.push(chunk.subarray(0, n));
    total += n;
  }
  return Buffer.concat(chunks);
}

// The canonical path is opened by path after it was resolved and checked. A swap between the check and the open is the
// accepted residual: Node can't portably check an open handle's final path, and a swap needs write access to the repo.
// What is read is then judged on the open handle (fstat) and bounded.
function readCapped(file: string, rel: string, cap: number): string {
  const over = `${rel} is larger than ${cap / 1024 / 1024} MB; not read`;
  const fd = openSync(file, 'r');
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Refused(`${rel} isn't a regular file; not read`);
    if (st.size > cap) throw new Refused(over);
    const buf = readBounded(fd, cap);
    if (buf.length > cap) throw new Refused(over);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** A view's data file (or, for a gallery, folder) as a canonical path inside the repo; null when it doesn't exist. */
function dataPath(repo: Repo, def: ViewDef): string | null {
  const real = inRepo(repo, resolve(repo.root, def.data), def.name, NO_TOP_DATA);
  if (real === null) return null;
  const st = statSync(real);
  if (st.isFile()) return real;
  if (st.isDirectory()) {
    if (def.type === 'gallery') return real;
    throw new Refused(`${def.data} is a folder, not a file; not read`);
  }
  throw new Refused(`${def.data} isn't a regular file; not read`);
}

/** An image a view reaches: its canonical file, caption, stamp, and (in a gallery folder) the name it has there. */
type ViewImage = { file: string; caption: string; stamp: string; name?: string };

/**
 * The image list as readView last numbered it, per view, so serving position n doesn't resolve every entry again (a
 * 400-image gallery took about 29 s of link checks, once per image). It is kept against the data path's own state (a
 * file's size and time, a folder's entry names), taken before the list was built; a list whose key no longer matches is
 * built again. Anything else that moves an image is picked up when readView runs again,
 * which the browser does before it asks for images by position.
 */
const numbered = new Map<string, { key: string; images: ViewImage[] }>();

function listKey(repo: Repo, def: ViewDef): string | null {
  const real = dataPath(repo, def);
  if (real === null) return null;
  const st = statSync(real);
  return st.isDirectory() ? `${def.type}|${def.data}|${readdirSync(real).sort().join('/')}` : `${def.type}|${def.data}|${st.size}-${st.mtimeMs}`;
}

function remember(repo: Repo, def: ViewDef, key: string | null, images: ViewImage[]): void {
  if (key === null) return;
  if (numbered.size >= 64) numbered.clear();
  numbered.set(`${fold(repo.real)}\u0000${def.name}`, { key, images });
}

/** The image files a gallery view reaches, in order (their positions are how the browser asks for them), and the paths refused. */
function viewImages(repo: Repo, def: ViewDef): { images: ViewImage[]; refused: string[] } {
  const out: ViewImage[] = [];
  const refused: string[] = [];
  const real = dataPath(repo, def);
  if (real === null) return { images: out, refused };
  if (def.type === 'gallery' && statSync(real).isDirectory()) {
    // A link is followed like any other path (its links checked first): kept when it reaches a file inside the repo.
    const names = readdirSync(real, { withFileTypes: true }).filter((e) => (e.isFile() || e.isSymbolicLink()) && isImage(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const t = targetIn(repo, join(real, name), def.name);
      if ('file' in t) out.push({ file: t.file, caption: '', stamp: t.stamp, name });
      else if ('refused' in t) refused.push(name);
    }
  } else if (def.type === 'gallery') {
    let list: unknown;
    try {
      list = JSON.parse(readCapped(real, def.data, DATA_CAP));
    } catch (e) {
      if (e instanceof SyntaxError) throw new ParseError(`not valid JSON (${e.message})`);
      throw e;
    }
    if (!Array.isArray(list)) throw new ParseError('a gallery list is [ { "file": "...", "caption": "..." }, ... ]');
    for (const item of list) {
      const r = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      if (typeof r['file'] !== 'string' || !isImage(r['file'])) continue;
      const t = targetIn(repo, resolve(dirname(real), r['file']), def.name);
      if ('file' in t && isImage(t.file)) out.push({ file: t.file, caption: typeof r['caption'] === 'string' ? r['caption'] : '', stamp: t.stamp });
      else if ('refused' in t && !refused.includes(r['file'])) refused.push(r['file']);
    }
  }
  return { images: out, refused };
}

const withRefused = (refused: string[]): { refused?: string[] } => (refused.length > 0 ? { refused } : {});

function viewData(repo: Repo, def: ViewDef): ViewData {
  const real = dataPath(repo, def);
  if (real === null) throw new Refused(`${def.data} doesn't exist yet`);
  if (def.type === 'table' || def.type === 'chart') return tableFromText(def.data, readCapped(real, def.data, DATA_CAP));
  if (def.type === 'markdown') return { kind: 'markdown', text: readCapped(real, def.data, DATA_CAP) };
  const key = listKey(repo, def);
  const { images, refused } = viewImages(repo, def);
  remember(repo, def, key, images);
  const listed: GalleryData['images'] = images.map((img, index) => ({ index, name: img.name ?? img.file.split(/[\\/]/).pop() ?? '', caption: img.caption, stamp: img.stamp }));
  return { kind: 'gallery', images: listed, ...withRefused(refused) };
}

/** One view and its parsed data. A data problem is an answer with `error`, never a throw; an unknown view is 404. */
export function readView(root: string, name: string): ViewAnswer {
  const def = registryViews(root).views.get(name);
  if (!def) throw new NexusError(`No view named "${name}"`, 404);
  try {
    return { view: def, data: viewData(repoOf(root), def), error: null };
  } catch (e) {
    if (e instanceof Refused) return { view: def, data: null, error: e.message };
    if (e instanceof ParseError) return { view: def, data: null, error: `${def.data}: ${e.message}` };
    const code = fsCode(e);
    if (code !== null) return { view: def, data: null, error: `${def.data} can't be read: ${code}` };
    throw e;
  }
}

/**
 * A gallery image by position, as an open file the caller streams from and closes; it is never
 * re-opened by path. The canonical path is opened by path once, after it was resolved and checked: a swap in between is
 * the accepted residual (Node can't portably check an open handle's final path, and a swap needs write access to the
 * repo). The fd is judged by fstat: a regular file within IMAGE_CAP. The list comes from `numbered` while its key holds;
 * the one image served is checked again on every call (its links, and that it is a file inside the repo, out of .git).
 */
export function readViewFile(root: string, name: string, n: number): { fd: number; size: number; type: string } {
  const def = registryViews(root).views.get(name);
  if (!def) throw new NexusError(`No view named "${name}"`, 404);
  let file: string | null = null;
  try {
    const repo = repoOf(root);
    const key = listKey(repo, def);
    const hit = numbered.get(`${fold(repo.real)}\u0000${def.name}`);
    let images: ViewImage[];
    if (key !== null && hit?.key === key) images = hit.images;
    else {
      images = viewImages(repo, def).images;
      remember(repo, def, key, images);
    }
    const img = Number.isInteger(n) ? images[n] : undefined;
    // Its path is canonical, so it is judged against the repo's canonical root.
    const now = img === undefined ? null : targetIn({ root: repo.real, real: repo.real }, img.file, def.name);
    if (now !== null && 'file' in now) file = now.file;
  } catch (e) {
    if (!(e instanceof Refused || e instanceof ParseError || fsCode(e) !== null)) throw e;
  }
  if (file === null) throw new NexusError('No file at that position in this view', 404);
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch (e) {
    if (fsCode(e) === null) throw e;
    throw new NexusError('No file at that position in this view', 404);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new NexusError('No file at that position in this view', 404);
    if (st.size > IMAGE_CAP) throw new NexusError('That image is larger than 10 MB; not served', 413);
    return { fd, size: st.size, type: IMAGE_TYPES[extOf(file)] ?? 'application/octet-stream' };
  } catch (e) {
    closeSync(fd); // every way out but the return closes the fd
    if (e instanceof NexusError) throw e;
    if (fsCode(e) === null) throw e;
    throw new NexusError('No file at that position in this view', 404);
  }
}

/**
 * What the repo watcher compares, per declared view: the note's size and time, and the data path's. A data file counts
 * by size and time; a data folder (a gallery) by each entry's name plus, for each image file in it, its size and time
 * (one stat each, or for an image link its checked target's; a stat failure or a refused link records the name with "-"). Images reached through a gallery JSON list are
 * not stat'd per poll, only the list file itself is. A data path that leaves the repo, or is refused, counts as "-".
 */
export function viewSignature(root: string): string {
  let repo: Repo | null = null;
  try {
    repo = repoOf(root);
  } catch {
    repo = null;
  }
  const stat = (p: string): string => {
    try {
      const s = statSync(p);
      if (!s.isDirectory()) return `${s.size}-${s.mtimeMs}`;
      return readdirSync(p, { withFileTypes: true })
        .map((d) => {
          if (!isImage(d.name) || !(d.isFile() || d.isSymbolicLink())) return d.name;
          // An image link counts by its target's stamp, as the gallery serves it; its links are checked first (targetIn).
          if (d.isSymbolicLink()) {
            const t = repo === null ? null : targetIn(repo, join(p, d.name), 'signature');
            return `${d.name}:${t !== null && 'file' in t ? t.stamp : '-'}`;
          }
          try {
            const f = statSync(join(p, d.name));
            return `${d.name}:${f.size}-${f.mtimeMs}`;
          } catch {
            return `${d.name}:-`;
          }
        })
        .sort()
        .join(',');
    } catch {
      return '-';
    }
  };
  const dataSig = (v: ViewDef): string => {
    try {
      const real = repo === null ? null : inRepo(repo, resolve(root, v.data), v.name, NO_TOP_DATA);
      return real === null ? '-' : stat(real);
    } catch {
      return '-';
    }
  };
  return [...registryViews(root).views.values()].map((v) => `${v.file}|${stat(join(root, v.file))}|${dataSig(v)}`).join('\n');
}
