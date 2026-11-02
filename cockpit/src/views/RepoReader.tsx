import { useEffect, useState, type ReactNode } from 'react';
import type { InventoryItem } from '../../../core/governance/types.ts';
import { SCOPE_TITLES } from '../../../core/governance/types.ts';
import { ApiError, type Client } from '../api/client.ts';
import { Empty } from '../components/Empty.tsx';
import { Markdown } from '../components/Markdown.tsx';
import type { Theme } from '../lib/prefs.ts';
import { readerFile, readerStateFor, type ReaderState } from '../lib/repo.ts';
import { formatSize } from '../lib/size.ts';
import { formatTime } from '../lib/time.ts';
import { formatHash, keepBuild, type Route } from '../lib/route.ts';

const RECORD_TEXT = { recorded: 'Recorded: a note in docs/', generated: 'Generated from a recorded note', outside: 'Outside the record', build: 'This build: an accepted guardrail' } as const;
/** Repo Markdown resolves no wikilinks. */
const NO_DOCS: string[] = [];

interface RepoReaderProps { item: InventoryItem; client: Client; zone: string; theme: Theme; items: InventoryItem[]; route: Route; reviewSlot?: ReactNode }

/**
 * One standing instruction beside the list: where it lives, when it loads, whether it is recorded, then its text.
 * The text is read again whenever the list's next read shows the item changed, keeping the last text on screen until
 * the new one arrives; a 404 means it went after the list was read.
 */
export function RepoReader({ item, client, zone, theme, items, route, reviewSlot }: RepoReaderProps) {
  const [read, setRead] = useState<ReaderState>({ id: item.id, kind: 'loading' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    client.repoItem(item.id).then(
      (r) => {
        if (cancelled) return;
        setRead({ id: item.id, kind: 'ready', text: r.text });
        setBusy(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setRead({ id: item.id, kind: 'gone', message: e instanceof ApiError && e.status === 404 ? 'It was moved or deleted after the list was read.' : e instanceof Error ? e.message : String(e) });
        setBusy(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, item.id, item.changed, item.size]);

  // What was read for the last item is never shown under this one's title.
  const state = readerStateFor(read, item.id);
  const loaded = item.scope === 'path-scoped' && item.paths ? `${SCOPE_TITLES[item.scope]}: ${item.paths.join(', ')}` : SCOPE_TITLES[item.scope];
  const sourceItem = item.kind === 'generated' ? items.find((i) => i.location === item.source) : undefined;
  const file = state.kind === 'ready' ? readerFile(item.kind, state.text, item.title) : null;
  // To the note in Rules, keeping the open build but not this list's search or toggles, which could hide the note.
  const sourceHash = sourceItem ? formatHash({ category: 'repo', sub: 'rules', params: { ...keepBuild(route), item: sourceItem.id } }) : null;

  return (
    <article className="repo-reader" aria-busy={busy && state.kind !== 'loading' ? true : undefined}>
      <h2>{item.title}</h2>
      {reviewSlot}
      <dl className="facts">
        <dt>Where</dt>
        <dd className="mono">{item.location}</dd>
        <dt>Loaded</dt>
        <dd>
          {loaded}
          {item.launchedFrom && <> · only in sessions launched from <span className="mono">{item.launchedFrom}</span></>}
          {item.conditional && <> · {item.conditional}</>}
        </dd>
        <dt>Record</dt>
        <dd className={item.record === 'outside' ? 'out' : undefined}>{RECORD_TEXT[item.record]}</dd>
        <dt>Size</dt>
        <dd className="mono">{formatSize(item.size)}</dd>
        <dt>Changed</dt>
        <dd className="mono" data-volatile>{formatTime(item.changed, zone)}</dd>
        {item.kind === 'generated' && item.source && (
          <>
            <dt>Generated from</dt>
            <dd className="mono">{sourceHash ? <a href={sourceHash}>{item.source}</a> : item.source}</dd>
          </>
        )}
        {item.kind === 'instructions' && item.source && (
          <>
            <dt>Imported by</dt>
            <dd className="mono">{item.source}</dd>
          </>
        )}
      </dl>
      {file && file.properties.length > 0 && (
        <table className="fm">
          <tbody>
            {file.properties.map(([k, v]) => (
              <tr key={k}>
                <th className="mono">{k}</th>
                <td className="mono">{typeof v === 'string' ? v : JSON.stringify(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {file?.error && <p className="fm-error">Its properties can't be read: {file.error}</p>}
      {state.kind === 'loading' && <p className="reader-msg" aria-busy="true">Loading…</p>}
      {state.kind === 'gone' && <Empty title="This item can't be read">{state.message}</Empty>}
      {/* Markdown renders its own .md wrapper. */}
      {file && <Markdown text={file.body} path={item.location} build={null} client={client} theme={theme} docs={NO_DOCS} comments="show" />}
    </article>
  );
}
