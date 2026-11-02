import { isValidElement, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { Client } from '../api/client.ts';
import { docHref, isMarkdown, linkWikilinks, remarkComments, repoUrl, resolveDocTarget, resolveRelative, slugify, type CommentMode } from '../lib/markdown.ts';
import type { Theme } from '../lib/prefs.ts';
import { Mermaid } from './Mermaid.tsx';

interface MarkdownProps {
  text: string;
  path: string;
  /** The build whose files relative links and images reach; null for repo Markdown, whose relative links are text. */
  build: string | null;
  client: Client;
  theme: Theme;
  docs: string[];
  /** HTML comments: hidden in documents (the default); shown dimmed and labelled where a standing-rule file is read. */
  comments?: CommentMode;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

const isMermaidClass = (className: string | undefined) => /\blanguage-mermaid\b/.test(className ?? '');

function isMermaidBlock(children: ReactNode): boolean {
  const child = Array.isArray(children) ? children[0] : children;
  return isValidElement<{ className?: string }>(child) && isMermaidClass(child.props.className);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const isExternal =(href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

function DocLink({ href, path, build, client, children }: { href: string | undefined; path: string; build: string | null; client: Client; children: ReactNode }) {
  if (!href) return <>{children}</>;
  if (href.startsWith('#/')) return <a href={href}>{children}</a>;
  if (href.startsWith('#')) {
    // In-document anchor: scroll to the heading rather than changing the cockpit's route.
    const id = safeDecode(href.slice(1));
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(id)?.scrollIntoView({ block: 'start' });
        }}
      >
        {children}
      </a>
    );
  }
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  // Without a build there is no file route to reach: a relative link is text.
  if (build === null) return <span className="dead-link">{children}</span>;
  const target = resolveRelative(path, href);
  if (!target) return <span className="dead-link">{children}</span>;
  const inCockpit = isMarkdown(target) ? docHref(target) : null;
  if (inCockpit) return <a href={inCockpit}>{children}</a>;
  return (
    <a href={client.fileUrl(build, target)} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function Markdown({ text, path, build, client, theme, docs, comments = 'hide' }: MarkdownProps) {
  const linked = useMemo(
    () =>
      linkWikilinks(text, (target) => {
        const found = resolveDocTarget(target, docs);
        return found ? docHref(found) : null;
      }),
    [text, docs],
  );
  const components = useMemo<Components>(
    () => ({
      h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
      h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
      // Diagrams draw in repo Markdown too: a repo's files come from collaborators (repo-content-collaborator-trust),
      // so the images a diagram names (an image shape, an <img> in a label) may load while Mermaid draws it.
      pre: ({ children }) => (isMermaidBlock(children) ? <>{children}</> : <pre>{children}</pre>),
      code: ({ className, children }) => (isMermaidClass(className) ? <Mermaid code={textOf(children).trim()} theme={theme} /> : <code className={className}>{children}</code>),
      a: ({ href, children }) => (
        <DocLink href={href} path={path} build={build} client={client}>
          {children}
        </DocLink>
      ),
      img: ({ src, alt }) => {
        const source = typeof src === 'string' ? src : undefined;
        if (build === null) {
          // Repo Markdown never loads an image: an outside one becomes a link to it, a local one its alt text.
          if (source && isExternal(source)) {
            return (
              <a href={source} target="_blank" rel="noreferrer">
                {alt || source}
              </a>
            );
          }
          return <span className="dead-link">{alt ?? ''}</span>;
        }
        const local = source && !isExternal(source) ? resolveRelative(path, source) : null;
        return <img src={local ? client.fileUrl(build, local) : source} alt={alt ?? ''} loading="lazy" />;
      },
    }),
    [theme, path, build, client],
  );
  return (
    <div className="md">
      <ReactMarkdown urlTransform={build === null ? repoUrl : undefined} remarkPlugins={[remarkGfm, [remarkComments, { mode: comments }]]} rehypePlugins={[[rehypeHighlight, { detect: false, plainText: ['mermaid'] }]]} components={components}>
        {linked}
      </ReactMarkdown>
    </div>
  );
}
