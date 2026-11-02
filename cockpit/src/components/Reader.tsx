import { useEffect, useState } from 'react';
import { ApiError, type Client } from '../api/client.ts';
import { headings } from '../lib/markdown.ts';
import type { Theme } from '../lib/prefs.ts';
import { Empty } from './Empty.tsx';
import { Markdown } from './Markdown.tsx';
import { PathLine } from './PathLine.tsx';

interface ReaderProps {
  build: string;
  path: string;
  modified: string | null;
  client: Client;
  zone: string;
  theme: Theme;
  docs: string[];
  /** Hash of the open gate this document is waiting on, when there is one. */
  gate?: string | undefined;
}

type ReadState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready'; text: string };

/** Reads one markdown file from the build. Re-keyed by path and modified time so live edits reload it. */
export function Reader({ build, path, modified, client, zone, theme, docs, gate }: ReaderProps) {
  const [state, setState] = useState<ReadState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    client.fileText(build, path).then(
      (text) => {
        if (!cancelled) setState({ kind: 'ready', text });
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setState({ kind: 'missing' });
        else setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, build, path]);

  const contents = state.kind === 'ready' ? headings(state.text) : [];
  return (
    <article className="reader">
      <PathLine path={path} modified={modified} zone={zone} gate={gate} />
      {state.kind === 'loading' && (
        <p className="reader-msg" aria-busy="true">
          Loading…
        </p>
      )}
      {state.kind === 'missing' && (
        <Empty title="This file is missing from the build">
          <code>{path}</code> isn't in the build folder. Ask the agent to restore it, or to reopen the gate with the right document.
        </Empty>
      )}
      {state.kind === 'error' && <Empty title="This file could not be loaded">{state.message}</Empty>}
      {state.kind === 'ready' && (
        <>
          {contents.length > 1 && (
            <nav className="toc" aria-label="Contents">
              {contents.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(h.id)?.scrollIntoView({ block: 'start' });
                  }}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          )}
          <Markdown text={state.text} path={path} build={build} client={client} theme={theme} docs={docs} />
        </>
      )}
    </article>
  );
}
