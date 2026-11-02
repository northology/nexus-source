import { useMemo } from 'react';
import { DocFile } from '../components/DocFile.tsx';
import { Empty } from '../components/Empty.tsx';
import { PhaseSelect } from '../components/PhaseSelect.tsx';
import { Reader } from '../components/Reader.tsx';
import { Runner } from '../components/Runner.tsx';
import { gateState } from '../lib/gates.ts';
import { docLists, docTitle, galleryFolder, isMarkdown, pickDocTab, viewerOf } from '../lib/markdown.ts';
import { ALL_PHASES, fileInPhase, phaseInfo, selectedPhase } from '../lib/phases.ts';
import { DOC_TABS, formatHash, keepBuild, withParams, type DocTab } from '../lib/route.ts';
import { formatTime } from '../lib/time.ts';
import type { ViewProps } from './types.ts';

const DOC_TITLES: Record<DocTab, { tab: string; empty: string }> = {
  plans: { tab: 'Plans', empty: 'Plans and task breakdowns land in documents/plans/ and appear here.' },
  specs: { tab: 'Specs', empty: 'Designs to review land in documents/specs/ and appear here.' },
  audits: { tab: 'Audits', empty: 'Reviews of finished pieces land in documents/audits/ and appear here.' },
  reports: { tab: 'Reports', empty: 'Progress and close-out reports land in documents/reports/ and appear here.' },
  notes: { tab: 'Notes', empty: "Your steering notes and the agent's working notes land in notes/ and appear here." },
};

export function DocumentsView({ build, snapshot, route, navigate, client, zone, theme }: ViewProps) {
  const info = phaseInfo(snapshot.build);
  const phase = selectedPhase(route, info);
  // Document path -> the open gate it is attached to.
  const review = new Map<string, string>();
  for (const g of snapshot.gates) {
    if (gateState(g) === 'open' && typeof g.request.document === 'string' && !review.has(g.request.document)) review.set(g.request.document, g.name);
  }
  const all = docLists(snapshot.files);
  const lists = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.filter((f) => review.has(f.path) || fileInPhase(f.path, phase, info.names))])) as typeof all;
  const phaseParam = route.params['phase'];
  const keep = { ...keepBuild(route), ...(phaseParam ? { phase: phaseParam } : {}) };
  const tab = pickDocTab(route.sub, lists);
  const list = lists[tab];
  const requested = route.params['doc'];
  // An image's address opens its folder's gallery. A doc param that isn't in the list still opens its own reader,
  // which says the file is missing.
  const entryOf = (path: string) => {
    const folder = galleryFolder(path);
    return list.find((f) => f.path === path || (folder !== null && f.images !== undefined && f.path === `${folder}/`));
  };
  const current: { path: string; modified: string | null; size?: number } | null = requested
    ? (entryOf(requested) ?? { path: requested, modified: null })
    : (list[0] ?? null);
  const docs = [...snapshot.files.documents, ...snapshot.files.notes].map((f) => f.path).filter(isMarkdown);
  // What a build file's gallery resolves against; held while the snapshot's files are unchanged.
  const files = useMemo(() => [...snapshot.files.documents, ...snapshot.files.notes, ...snapshot.files.files], [snapshot.files]);
  const gateHash = (name: string) => formatHash({ category: 'gate', sub: name, params: keepBuild(route) });
  const gate = current && review.has(current.path) ? gateHash(review.get(current.path) ?? '') : undefined;
  // What DocFile opens: the address asked for (one image in a gallery), else the entry; with that file's own time.
  const docPath = requested ?? current?.path ?? '';
  const docFile = files.find((f) => f.path === docPath);
  // Red means "needs you" and is never phase-filtered: waiting counts come from every document.
  const tabCount = (everything: { path: string }[], shown: { path: string }[]) => {
    const waiting = everything.filter((f) => review.has(f.path)).length;
    return { count: String(waiting > 0 ? waiting : shown.length), needs: waiting > 0 };
  };

  return (
    <section className="view flush" aria-labelledby="documents-title">
      <h1 id="documents-title" className="visually-hidden">
        Documents
      </h1>
      <Runner
        label="Documents"
        tabs={DOC_TABS.map((k) => ({ key: k, label: DOC_TITLES[k].tab, ...tabCount(all[k], lists[k]) }))}
        current={tab}
        onSelect={(k) => navigate({ category: 'documents', sub: k, params: keep })}
      />
      <div className="view-body wide">
        {info.names.length > 1 && (
          <div className="docbar">
            <PhaseSelect info={info} selected={phase} onSelect={(p) => navigate(withParams(route, { phase: p, doc: null }))} />
          </div>
        )}
        {current ? (
          <div className="docs">
            <nav className="dlist" aria-label={`${DOC_TITLES[tab].tab} in this build`}>
              {list.map((f) => (
                <div key={f.path} className="dli">
                  <a href={formatHash({ category: 'documents', sub: tab, params: { ...keep, doc: f.path } })} aria-current={f.path === current.path ? 'true' : undefined}>
                    <b>{docTitle(f)}</b>
                    <span className="mono">
                      {f.path} · <span data-volatile>{formatTime(f.modified, zone)}</span>
                    </span>
                  </a>
                  {review.has(f.path) && (
                    <a className="needs-note" href={gateHash(review.get(f.path) ?? '')}>
                      Needs your review ›
                    </a>
                  )}
                </div>
              ))}
            </nav>
            {/* Modified times are to the second, so DocFile's key adds the size: a same-second rewrite that changes it reloads. */}
            {viewerOf(current.path) === 'markdown' ? (
              <Reader key={`${current.path}@${current.modified}`} build={build} path={current.path} modified={current.modified} client={client} zone={zone} theme={theme} docs={docs} gate={gate} />
            ) : (
              <DocFile
                key={`${docPath}@${current.modified}@${current.size ?? ''}`}
                build={build}
                path={docPath}
                modified={docFile?.modified ?? current.modified}
                files={files}
                client={client}
                zone={zone}
              />
            )}
          </div>
        ) : phase !== null && all[tab].length > 0 ? (
          <Empty title={`Nothing for ${phase}.`}>
            <a href={formatHash(withParams(route, { phase: ALL_PHASES, doc: null }))}>Show all phases</a>
          </Empty>
        ) : (
          <Empty title={`Nothing in ${DOC_TITLES[tab].tab.toLowerCase()} yet`}>{DOC_TITLES[tab].empty}</Empty>
        )}
      </div>
    </section>
  );
}
