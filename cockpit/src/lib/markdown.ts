import type { FileEntry, Snapshot } from '../../../core/types.ts';
import { DOC_TABS, formatHash, type DocTab } from './route.ts';

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Splits markdown into prose and fenced-code segments, so rewrites never touch code. */
function segments(md: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = (code: boolean) => {
    if (buf.length) out.push({ code, text: buf.join('\n') });
    buf = [];
  };
  for (const line of md.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) {
      flush(false);
      fence = marker;
      buf.push(line);
    } else if (fence !== null && marker && marker[0] === fence[0] && marker.length >= fence.length) {
      buf.push(line);
      flush(true);
      fence = null;
    } else {
      buf.push(line);
    }
  }
  flush(fence !== null);
  return out;
}

export function headings(md: string): Heading[] {
  const out: Heading[] = [];
  for (const seg of segments(md)) {
    if (seg.code) continue;
    for (const line of seg.text.split('\n')) {
      const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
      const hashes = m?.[1];
      const raw = m?.[2];
      if (!hashes || !raw) continue;
      const text = raw.replace(/[*_`]/g, '');
      out.push({ depth: hashes.length === 2 ? 2 : 3, text, id: slugify(text) });
    }
  }
  return out;
}

const escapeLabel = (s: string) => s.replace(/([[\]])/g, '\\$1');

/** Inline code spans (any backtick run length) and wikilinks, matched together so code always wins. */
const INLINE = /(`+)(?:(?!\1)[\s\S])+?(?<!`)\1(?!`)|\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** [[target]] and [[target|label]] become links when they resolve inside the build, plain text otherwise. */
export function linkWikilinks(md: string, resolve: (target: string) => string | null): string {
  return segments(md)
    .map((seg) =>
      seg.code
        ? seg.text
        : seg.text.replace(INLINE, (all, _ticks: string, target: string | undefined, label: string | undefined) => {
            if (target === undefined) return all;
            const text = (label ?? target).trim();
            const href = resolve(target.trim());
            return href ? `[${escapeLabel(text)}](<${href}>)` : text;
          }),
    )
    .join('\n');
}

export function resolveDocTarget(target: string, paths: string[]): string | null {
  const t = target.replace(/\\/g, '/').replace(/^\.?\//, '');
  const withMd = isMarkdown(t) ? t : `${t}.md`;
  return paths.find((p) => p === t || p === withMd) ?? paths.find((p) => p.endsWith(`/${withMd}`)) ?? null;
}

/** A link relative to a document, as a build-relative path; null if it leaves the build folder. */
export function resolveRelative(fromDoc: string, href: string): string | null {
  const clean = (href.split('#')[0]?.split('?')[0] ?? '').replace(/\\/g, '/');
  if (!clean) return null;
  const parts = clean.startsWith('/') ? [] : fromDoc.split('/').slice(0, -1);
  for (const seg of clean.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length ? parts.join('/') : null;
}

export function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** Which renderer a build file uses in the Documents section; null for files it doesn't show. */
export function viewerOf(path: string): 'markdown' | 'table' | 'image' | null {
  if (isMarkdown(path)) return 'markdown';
  if (/\.(csv|json)$/i.test(path)) return 'table';
  if (IMAGE_EXT.test(path)) return 'image';
  return null;
}

export function tabOf(path: string): DocTab | null {
  if (path.startsWith('notes/')) return 'notes';
  const m = /^documents\/([^/]+)\//.exec(path)?.[1];
  return m && (DOC_TABS as readonly string[]).includes(m) ? (m as DocTab) : null;
}

export function docHref(path: string): string | null {
  const tab = tabOf(path);
  return tab ? formatHash({ category: 'documents', sub: tab, params: { doc: path } }) : null;
}

export function titleFromPath(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * One entry in a Documents tab: a file, or a folder's images as one gallery. A gallery's `path` is its folder with a
 * trailing slash, `images` how many it holds, `size` their total and `modified` its newest image's time.
 */
export type DocEntry = FileEntry & { images?: number };

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');

/** The folder whose gallery a document address opens: a gallery's own (`notes/pics/`) or an image's; null otherwise. */
export function galleryFolder(path: string): string | null {
  if (path.endsWith('/')) return path.slice(0, -1);
  return viewerOf(path) === 'image' ? dirOf(path) : null;
}

/** An entry's title in the list: a file's from its name, a gallery's from its folder and count. */
export function docTitle(entry: DocEntry): string {
  if (entry.images === undefined) return titleFromPath(entry.path);
  return `${entry.path.slice(0, -1)} · ${entry.images} image${entry.images === 1 ? '' : 's'}`;
}

/**
 * Every file with a viewer, in documents/<tab>/ and notes/, in the order given. A folder's images are one gallery
 * entry, where its newest image falls (the snapshot lists the newest first).
 */
function entries(files: FileEntry[]): DocEntry[] {
  const out: DocEntry[] = [];
  const galleries = new Map<string, DocEntry & { images: number }>();
  for (const f of files) {
    const viewer = viewerOf(f.path);
    if (viewer === null) continue;
    if (viewer !== 'image') {
      out.push(f);
      continue;
    }
    const path = `${dirOf(f.path)}/`;
    const g = galleries.get(path);
    if (g) {
      g.images++;
      g.size += f.size;
      if (f.modified > g.modified) g.modified = f.modified;
    } else {
      const entry = { path, size: f.size, modified: f.modified, images: 1 };
      galleries.set(path, entry);
      out.push(entry);
    }
  }
  return out;
}

/** The entries each Documents tab lists. */
export function docLists(files: Snapshot['files']): Record<DocTab, DocEntry[]> {
  const inFolder = (prefix: string) => entries(files.documents.filter((f) => f.path.startsWith(prefix)));
  return {
    plans: inFolder('documents/plans/'),
    specs: inFolder('documents/specs/'),
    audits: inFolder('documents/audits/'),
    reports: inFolder('documents/reports/'),
    notes: entries(files.notes),
  };
}

export function pickDocTab(sub: string | null, lists: Record<DocTab, DocEntry[]>): DocTab {
  if (sub && (DOC_TABS as readonly string[]).includes(sub)) return sub as DocTab;
  return DOC_TABS.find((t) => lists[t].length > 0) ?? 'plans';
}

const REPO_SCHEMES = /^(https?|mailto)$/i;

/**
 * The URL transform for repo Markdown: an address with a scheme stays only for http(s) and mailto (react-markdown's
 * default also lets irc, ircs and xmpp through); one with no scheme is kept for the link rules, which make it text.
 * A colon after the first `/`, `?` or `#` isn't a scheme, as in react-markdown's own transform.
 */
export function repoUrl(value: string): string {
  const colon = value.indexOf(':');
  const before = (c: string) => {
    const at = value.indexOf(c);
    return at !== -1 && at < colon;
  };
  if (colon === -1 || before('/') || before('?') || before('#')) return value;
  return REPO_SCHEMES.test(value.slice(0, colon)) ? value : '';
}

/** How HTML comments in Markdown show: `hide` drops them (documents); `show` renders them dimmed and labelled (standing-rule files). */
export type CommentMode = 'hide' | 'show';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

/** The inner text of an html node that is one whole comment, `<!-- … -->`; null for anything else (an unclosed `<!--` included). */
export function commentText(html: string): string | null {
  const t = html.trim();
  if (!t.startsWith('<!--') || !t.endsWith('-->') || t.length < 7) return null;
  const inner = t.slice(4, -3);
  // Only one comment: a second `-->` inside means something else follows the first, so the node isn't a whole comment.
  if (inner.includes('-->')) return null;
  return inner.trim();
}

/**
 * Applies the comment rule to a Markdown tree (mdast): only `html` nodes are looked at, so a comment inside a fenced
 * block or a code span (`code`, `inlineCode`) stays as written. A whole comment is dropped (hide) or becomes a
 * `.md-comment` element with a `comment` label and its inner text (show). Other raw HTML is left alone, and a comment
 * that is never closed is not a comment, so nothing after it is hidden. A paragraph left empty by hiding goes too.
 */
export function applyComments(tree: MdNode, mode: CommentMode): void {
  const walk = (node: MdNode): void => {
    if (!node.children) return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      const inner = child.type === 'html' && typeof child.value === 'string' ? commentText(child.value) : null;
      if (inner === null) {
        walk(child);
        next.push(child);
        continue;
      }
      if (mode === 'hide') continue;
      const block = BLOCK_PARENTS.has(node.type);
      next.push({
        type: 'paragraph',
        data: { hName: block ? 'div' : 'span', hProperties: { className: 'md-comment' } },
        children: [
          { type: 'emphasis', data: { hName: 'span', hProperties: { className: 'md-comment-label' } }, children: [{ type: 'text', value: 'comment' }] },
          { type: 'text', value: inner },
        ],
      });
    }
    // A paragraph left with no children by hiding goes too.
    node.children = next.filter((c) => !(mode === 'hide' && c.type === 'paragraph' && c.children !== undefined && c.children.length === 0));
  };
  walk(tree);
}

/** The remark plugin form of applyComments; `mode` defaults to hide. */
export function remarkComments(options?: { mode?: CommentMode }): (tree: MdNode) => void {
  const mode = options?.mode ?? 'hide';
  return (tree) => applyComments(tree, mode);
}
