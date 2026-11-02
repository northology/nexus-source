import { useEffect, useState } from 'react';
import type { RepoSnapshot } from '../../../core/types.ts';
import type { ViewAnswer } from '../../../core/views/types.ts';
import type { Client } from '../api/client.ts';
import { Empty } from '../components/Empty.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Runner } from '../components/Runner.tsx';
import type { Navigate } from '../hooks/useRoute.ts';
import type { Theme } from '../lib/prefs.ts';
import { withParams, type Route } from '../lib/route.ts';
import { ChartView } from '../renderers/ChartView.tsx';
import { GalleryView } from '../renderers/GalleryView.tsx';
import { TableView } from '../renderers/TableView.tsx';

/** Keyed by view, so what was read for one view is never shown under another's tab. */
type State = { name: string; kind: 'loading' } | { name: string; kind: 'failed'; message: string } | { name: string; kind: 'ready'; answer: ViewAnswer };

/** Repo Markdown resolves no wikilinks. */
const NO_DOCS: string[] = [];

interface ViewsPanelProps { repo: RepoSnapshot; route: Route; navigate: Navigate; client: Client; theme: Theme }

/**
 * The repo's declared views, one per tab, and the open one drawn by its renderer. The open view is read again on every
 * repo change (the change covers its note and data file), keeping the last answer on screen until the new one arrives.
 */
export function ViewsPanel({ repo, route, navigate, client, theme }: ViewsPanelProps) {
  const views = [...repo.views].sort((a, b) => a.title.localeCompare(b.title));
  // The first view opens only when the URL names none: a named view that has gone says so.
  // A blank name names no view.
  const wanted = route.params['view']?.trim() || undefined;
  const current = wanted === undefined ? (views[0] ?? null) : (views.find((v) => v.name === wanted) ?? null);
  const gone = wanted !== undefined && current === null && views.length > 0;
  const name = current?.name ?? null;
  const [read, setRead] = useState<State>({ name: '', kind: 'loading' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (name === null) return;
    let cancelled = false;
    setBusy(true);
    client.view(name).then(
      (answer) => {
        if (cancelled) return;
        setRead({ name, kind: 'ready', answer });
        setBusy(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setRead({ name, kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        setBusy(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // `repo` changes identity on every repo event, which is when a view's note or data may have changed.
  }, [client, name, repo]);
  const state: State = name !== null && read.name === name ? read : { name: name ?? '', kind: 'loading' };

  return (
    <section className="view flush" aria-labelledby="views-title">
      <h1 id="views-title" className="visually-hidden">
        Views
      </h1>
      {views.length > 0 && (
        <Runner label="Views" tabs={views.map((v) => ({ key: v.name, label: v.title, count: v.type }))} current={current?.name ?? ''} onSelect={(k) => navigate(withParams(route, { view: k }))} />
      )}
      <div className="view-body wide" aria-busy={busy && state.kind !== 'loading' ? true : undefined}>
        {gone && (
          <Empty title="That view is no longer here.">
            No view named <code>{wanted}</code> is declared now. Pick another from the tabs.
          </Empty>
        )}
        {/* Views are registry notes, so a repo with no vault has none until nexus init sets one up. */}
        {views.length === 0 && !repo.inventory.vault && (
          <Empty title="No vault yet.">
            Run <code>nexus init</code> or <code>/nexus:init</code> to set the repo up; views are then declared in <code>docs/_meta/views/</code>.{' '}
            <a href="#/guidance/views">How to declare a view</a>.
          </Empty>
        )}
        {views.length === 0 && repo.inventory.vault && (
          <Empty title="No views yet">
            Declare one in docs/_meta/views/: a note naming a view type and the data file it reads. <a href="#/guidance/views">How to declare a view</a>.
          </Empty>
        )}
        {current && current.description && (
          <div className="view-desc">
            <Markdown text={current.description} path={current.file} build={null} client={client} theme={theme} docs={NO_DOCS} />
          </div>
        )}
        {current && state.kind === 'loading' && (
          <p className="reader-msg" aria-busy="true">
            Loading…
          </p>
        )}
        {current && state.kind === 'failed' && <Empty title="This view can't be shown">{state.message}</Empty>}
        {current && state.kind === 'ready' && state.answer.error && <Empty title="This view can't be shown">{state.answer.error}</Empty>}
        {/* Keyed by view: a table's sort and search belong to that view, and survive its rereads. */}
        {current && state.kind === 'ready' && state.answer.data && <ViewBody key={state.name} answer={state.answer} client={client} theme={theme} />}
        {repo.problems.length > 0 && (
          <div className="problems">
            <h2>Views with problems</h2>
            <ul>
              {repo.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function ViewBody({ answer, client, theme }: { answer: ViewAnswer; client: Client; theme: Theme }) {
  const data = answer.data;
  if (!data) return null;
  if (data.kind === 'table' && answer.view.type === 'table') return <TableView data={data} options={answer.view.table} />;
  if (data.kind === 'table' && answer.view.type === 'chart' && answer.view.chart) return <ChartView data={data} options={answer.view.chart} theme={theme} />;
  // Markdown renders its own .md wrapper.
  if (data.kind === 'markdown') return <Markdown text={data.text} path={answer.view.data} build={null} client={client} theme={theme} docs={NO_DOCS} />;
  if (data.kind === 'gallery' && answer.view.type === 'gallery') return <GalleryView data={data} urlFor={(i) => client.viewFileUrl(answer.view.name, i)} />;
  return null;
}
