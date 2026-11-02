import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { readSnapshot } from '../../core/snapshot.ts';
import {
  applyComments, commentText, remarkComments, type CommentMode,
  docHref, docLists, headings, isMarkdown, linkWikilinks, pickDocTab, resolveDocTarget, repoUrl, resolveRelative, slugify, tabOf, titleFromPath, viewerOf, docTitle, galleryFolder,
} from '../../cockpit/src/lib/markdown.ts';
import { exampleRepo } from '../helpers.ts';

const PATHS = ['documents/specs/relay-rebuild-spec.md', 'notes/working.md'];

describe('markdown helpers', () => {
  it('makes heading ids', () => {
    expect(slugify('Open items')).toBe('open-items');
    expect(slugify('Retry rules: v2!')).toBe('retry-rules-v2');
  });
  it('lists level 2 and 3 headings outside code', () => {
    const md = '# Title\n\n## First\n\n```\n## not a heading\n```\n\n### Second *part*\n';
    expect(headings(md)).toEqual([
      { depth: 2, text: 'First', id: 'first' },
      { depth: 3, text: 'Second part', id: 'second-part' },
    ]);
  });
  it('links wikilinks that resolve, keeps labels, and leaves code alone', () => {
    const md = 'See [[relay-rebuild-spec|the spec]] and [[missing-page]].\n\n```\n[[relay-rebuild-spec]]\n```';
    const out = linkWikilinks(md, (t) => {
      const p = resolveDocTarget(t, PATHS);
      return p ? docHref(p) : null;
    });
    expect(out).toBe('See [the spec](<#/documents/specs?doc=documents/specs/relay-rebuild-spec.md>) and missing-page.\n\n```\n[[relay-rebuild-spec]]\n```');
  });
  it('wraps link destinations so spaces survive, and leaves inline code alone', () => {
    const paths = ['notes/my note (v2).md'];
    const out = linkWikilinks('Go to [[my note (v2)]]; `[[my note (v2)]]` and ``[[x]] `y` ``.', (t) => {
      const p = resolveDocTarget(t, paths);
      return p ? docHref(p) : null;
    });
    expect(out).toBe('Go to [my note (v2)](<#/documents/notes?doc=notes/my%20note%20(v2).md>); `[[my note (v2)]]` and ``[[x]] `y` ``.');
  });
  it('resolves wikilink targets by path or by name', () => {
    expect(resolveDocTarget('notes/working', PATHS)).toBe('notes/working.md');
    expect(resolveDocTarget('working.md', PATHS)).toBe('notes/working.md');
    expect(resolveDocTarget('relay-rebuild-spec', PATHS)).toBe('documents/specs/relay-rebuild-spec.md');
    expect(resolveDocTarget('nowhere', PATHS)).toBeNull();
  });
  it('resolves relative links inside the build and refuses to climb out', () => {
    expect(resolveRelative('documents/specs/a.md', '../plans/b.md')).toBe('documents/plans/b.md');
    expect(resolveRelative('documents/specs/a.md', './img/x.svg#frag')).toBe('documents/specs/img/x.svg');
    expect(resolveRelative('notes/a.md', '../../../etc/passwd')).toBeNull();
  });
  it('treats backslashes as separators when resolving relative links', () => {
    expect(resolveRelative('notes/a.md', String.raw`..\..\..\x`)).toBeNull();
    expect(resolveRelative('documents/specs/a.md', String.raw`..\plans\b.md`)).toBe('documents/plans/b.md');
  });
  it('maps paths to document tabs and links', () => {
    expect(tabOf('documents/audits/x.md')).toBe('audits');
    expect(tabOf('notes/x.md')).toBe('notes');
    expect(tabOf('files/x.md')).toBeNull();
    expect(docHref('notes/working.md')).toBe('#/documents/notes?doc=notes/working.md');
    expect(isMarkdown('a/B.MD')).toBe(true);
    expect(titleFromPath('documents/specs/relay-rebuild-spec.md')).toBe('Relay rebuild spec');
    expect(titleFromPath('concepts/quiet-board.html')).toBe('Quiet board');
  });
  it('sorts the build files into tabs and picks a sensible default', () => {
    const lists = docLists(readSnapshot(exampleRepo(), 'relay-rebuild').files);
    expect(lists.specs.map((f) => f.path)).toEqual(['documents/specs/relay-rebuild-spec.md']);
    expect(lists.notes.map((f) => f.path)).toEqual(['notes/working.md']);
    expect(lists.plans).toEqual([]);
    expect(pickDocTab(null, lists)).toBe('specs');
    expect(pickDocTab('audits', lists)).toBe('audits');
    expect(pickDocTab('nonsense', lists)).toBe('specs');
  });
  it('renders repo Markdown with no raw HTML, the repo URL transform and strict Mermaid', () => {
    const md = readFileSync(new URL('../../cockpit/src/components/Markdown.tsx', import.meta.url), 'utf8');
    const mermaid = readFileSync(new URL('../../cockpit/src/components/Mermaid.tsx', import.meta.url), 'utf8');
    expect(md).not.toMatch(/rehype-raw|rehypeRaw|skipHtml\s*=\s*\{?\s*false/);
    // Repo Markdown takes repoUrl; build documents keep react-markdown's default transform.
    expect(md.match(/urlTransform=\{[^}]*\}/g)).toEqual(['urlTransform={build === null ? repoUrl : undefined}']);
    expect(mermaid).toContain("securityLevel: 'strict'");
  });
  it('lets repo Markdown address only http(s) and mailto, keeping addresses with no scheme for the link rules', () => {
    for (const ok of ['https://example.com/a', 'http://example.com', 'mailto:a@example.com', 'HTTPS://EXAMPLE.COM', 'other.md', '#down', '#/repo/rules', '/api/repo', '//example.com/x.png', 'a/b:c', '?q=a:b']) {
      expect(repoUrl(ok)).toBe(ok);
    }
    for (const bad of ['irc://irc.example.com/room', 'ircs://irc.example.com', 'xmpp:someone@example.com', 'javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com']) {
      expect(repoUrl(bad)).toBe('');
    }
  });
});

describe('viewable build files', () => {
  it('knows Markdown, table and image files, and nothing else (a .canvas file is not shown)', () => {
    expect(['a.md', 'b.canvas', 'c.csv', 'd.JSON', 'e.svg', 'f.txt'].map(viewerOf)).toEqual(['markdown', null, 'table', 'table', 'image', null]);
    expect(['g.png', 'h.JPG', 'i.jpeg', 'j.gif', 'k.webp', 'l.avif', 'm.html', 'n.canvas.bak'].map(viewerOf)).toEqual(['image', 'image', 'image', 'image', 'image', 'image', null, null]);
  });
  it('lists them in the notes and document tabs', () => {
    const f = (path: string) => ({ path, size: 1, modified: '2026-10-08T00:00:00Z' });
    const lists = docLists({ documents: [f('documents/reports/r.csv'), f('documents/reports/x.txt')], notes: [f('notes/board.canvas'), f('notes/a.md')], files: [], concepts: [] });
    expect(lists.reports.map((x) => x.path)).toEqual(['documents/reports/r.csv']);
    expect(lists.notes.map((x) => x.path)).toEqual(['notes/a.md']);
  });
  it('lists the images in a folder as one gallery entry, where its newest image falls', () => {
    const f = (path: string, modified: string, size = 10) => ({ path, size, modified });
    const lists = docLists({
      documents: [f('documents/reports/r.csv', '2026-10-08T05:00:00Z'), f('documents/reports/chart.png', '2026-10-08T04:00:00Z')],
      notes: [
        f('notes/a.md', '2026-10-08T05:00:00Z'),
        f('notes/s2.png', '2026-10-08T04:00:00Z', 20),
        f('notes/pics/x.svg', '2026-10-08T03:00:00Z'),
        f('notes/b.canvas', '2026-10-08T02:00:00Z'),
        f('notes/s1.svg', '2026-10-08T01:00:00Z', 5),
      ],
      files: [],
      concepts: [],
    });
    expect(lists.notes).toEqual([
      f('notes/a.md', '2026-10-08T05:00:00Z'),
      { path: 'notes/', size: 25, modified: '2026-10-08T04:00:00Z', images: 2 },
      { path: 'notes/pics/', size: 10, modified: '2026-10-08T03:00:00Z', images: 1 },
    ]);
    expect(lists.reports.map((x) => x.path)).toEqual(['documents/reports/r.csv', 'documents/reports/']);
    expect(lists.notes.map(docTitle)).toEqual(['A', 'notes · 2 images', 'notes/pics · 1 image']);
  });
  it('finds the gallery a document address opens', () => {
    expect(['notes/', 'notes/pics/shot.PNG', 'notes/a.md', 'notes/b.canvas', 'documents/reports/'].map(galleryFolder)).toEqual(['notes', 'notes/pics', null, null, 'documents/reports']);
  });
});

describe('HTML comments in Markdown', () => {
  const render = (md: string, mode?: CommentMode): string =>
    renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, [remarkComments, mode === undefined ? {} : { mode }]] }, md));

  it('knows a whole comment from anything else', () => {
    expect(commentText('<!-- nexus:start -->')).toBe('nexus:start');
    expect(commentText('<!-- a\nb -->\n')).toBe('a\nb');
    expect(commentText('<!-- never closed')).toBeNull();
    expect(commentText('<!-- a --> tail <!-- b -->')).toBeNull();
    expect(commentText('<div>x</div>')).toBeNull();
  });
  it('hides a block comment and leaves no gap, by default', () => {
    const html = render('Before\n\n<!-- nexus:start -->\n\nAfter\n');
    expect(html).toBe('<p>Before</p>\n<p>After</p>');
    expect(render('Before\n\n<!-- nexus:start -->\n\nAfter\n', 'hide')).toBe(html);
  });
  it('hides an inline comment', () => {
    expect(render('one <!-- note --> two')).toBe('<p>one  two</p>');
    expect(render('<!-- only -->')).not.toContain('<!--');
    expect(render('x\n\n- item <!-- c -->\n')).toBe('<p>x</p>\n<ul>\n<li>item </li>\n</ul>');
  });
  it('hides a multi-line comment', () => {
    const html = render('A\n\n<!-- generated by nexus\n  from docs/x.md -->\n\nB');
    expect(html).not.toContain('generated');
    expect(html).toContain('<p>A</p>');
    expect(html).toContain('<p>B</p>');
  });
  it('shows a block comment dimmed and labelled, never as markup', () => {
    const html = render('A\n\n<!-- generated by nexus · edit the source -->\n\nB', 'show');
    expect(html).toContain('<div class="md-comment"><span class="md-comment-label">comment</span>generated by nexus · edit the source</div>');
    expect(html).not.toContain('&lt;!--');
    expect(html).not.toContain('<!--');
  });
  it('shows an inline comment as a span', () => {
    const html = render('one <!-- note --> two', 'show');
    expect(html).toContain('<span class="md-comment"><span class="md-comment-label">comment</span>note</span>');
  });
  it('leaves a comment in a fenced block or a code span as written, in both modes', () => {
    for (const mode of ['hide', 'show'] as const) {
      expect(render('```\n<!-- keep -->\n```', mode)).toContain('&lt;!-- keep --&gt;');
      expect(render('use `<!-- keep -->` here', mode)).toContain('<code>&lt;!-- keep --&gt;</code>');
    }
  });
  it('keeps an unclosed comment as text and hides nothing after it, in both modes', () => {
    for (const mode of ['hide', 'show'] as const) {
      const html = render('Intro\n\ntext <!-- never closed\n\nLater paragraph\n', mode);
      expect(html).toContain('Later paragraph');
      expect(html).toContain('&lt;!-- never closed');
      const block = render('Intro\n\n<!-- never closed\n\nLater paragraph\n', mode);
      expect(block).toContain('Later paragraph');
      expect(block).toContain('&lt;!-- never closed');
    }
  });
  it('leaves other raw HTML as literal text', () => {
    for (const mode of ['hide', 'show'] as const) {
      expect(render('<div>raw</div>', mode)).toContain('&lt;div&gt;raw&lt;/div&gt;');
      expect(render('a <b>x</b> b', mode)).toContain('&lt;b&gt;');
    }
  });
});
