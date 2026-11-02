import { useEffect, useState } from 'react';
import type { InventoryItem, InventoryProblem, RecordStatus } from '../../../core/governance/types.ts';
import { HARNESS_NAMES, type Harness } from '../../../core/harness.ts';
import type { RepoSnapshot } from '../../../core/types.ts';
import type { Client } from '../api/client.ts';
import { Empty } from '../components/Empty.tsx';
import { ReviewMarks } from '../components/ReviewMarks.tsx';
import { useReviewDraft } from '../hooks/useReviewDraft.ts';
import { useReviews } from '../hooks/useReviews.ts';
import type { Navigate } from '../hooks/useRoute.ts';
import { currentReview, reviewPhase, rowFor } from '../lib/reviews.ts';
import { formatSize } from '../lib/size.ts';
import type { Theme } from '../lib/prefs.ts';
import { ALL_RECORDS, filterItems, groupByScope, itemsFor, recordCounts, sectionOf, SECTION_TITLES, selectItem, settingNote, splitByFolder, type RepoSection } from '../lib/repo.ts';
import { formatHash, keepBuild, withParams, type Route } from '../lib/route.ts';
import { RepoReader } from './RepoReader.tsx';
import { ReviewBanner } from './ReviewBanner.tsx';
import { ViewsPanel } from './ViewsPanel.tsx';

interface RepoViewProps { repo: RepoSnapshot; route: Route; navigate: Navigate; client: Client; zone: string; theme: Theme }

const RECORD_LABEL: Record<RecordStatus, string> = { recorded: 'recorded', generated: 'generated', outside: 'outside', build: 'this build' };

/** How to add a vault: the no-vault empty state and the overview's one-line hint say the same thing. */
const ADD_VAULT = (
  <>
    Run <code>nexus init</code> or <code>/nexus:init</code> to set the repo up; decisions, rules and issues then live in <code>docs/governance/</code>.
  </>
);

/**
 * What the inventory doesn't list, as one line under the overview: so it never reads as the whole of what an agent
 * loads. reference/cockpit.md says the same, and tests/docs.test.ts pins both.
 */
const NOT_LISTED = (
  <>
    Not listed here: output styles, context added by hooks, skill listings, <code>--append-system-prompt</code> and the managed{' '}
    <code>claudeMd</code> setting. <code>claudeMdExcludes</code> isn't applied: an excluded file still shows. Files in folders below the repo root are
    listed under their folder, found about every 30 seconds. For what one session loaded, ask Claude Code: <code>/context</code> and <code>/memory</code>.
  </>
);

/** The same line under another harness, which loads only AGENTS.md files and keeps no memory nexus reads. */
const notListedFor = (harness: Harness) =>
  harness === 'claude-code' ? NOT_LISTED : (
    <>
      Not listed here: context added by hooks and skill listings. Only the <code>AGENTS.md</code> files {HARNESS_NAMES[harness]} loads are shown. Files
      in folders below the repo root are listed under their folder, found about every 30 seconds.
    </>
  );

/** Inventory items that couldn't be read: each one's location and reason, above the list of everything that could. */
function InventoryProblems({ problems }: { problems: InventoryProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <section className="problems repo-problems" aria-label="Standing instructions that could not be read">
      <h2>{problems.length === 1 ? "One standing instruction couldn't be read" : `${problems.length} standing instructions couldn't be read`}</h2>
      <p>Everything else still shows.</p>
      <ul>
        {problems.map((p) => (
          <li key={`${p.location}:${p.message}`}>
            <code>{p.location}</code>: {p.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Reviews that couldn't be read, or a read of them that failed outright: named above the list, like the inventory's
 * problems, so a review that never shows its banner isn't silently missing.
 */
function ReviewProblems({ problems, error }: { problems: string[]; error: string | null }) {
  if (error === null && problems.length === 0) return null;
  return (
    <section className="problems repo-problems" aria-label="Reviews that could not be read">
      <h2>{error !== null ? "The reviews couldn't be read" : problems.length === 1 ? "One review couldn't be read" : `${problems.length} reviews couldn't be read`}</h2>
      <p>{error !== null ? 'A review shown here is as it was last read. It is read again when the repo next changes.' : 'Everything else still shows.'}</p>
      <ul>
        {error !== null ? (
          <li>{error}</li>
        ) : (
          problems.map((p) => {
            // The server names the file first: "<name>.json: <why>".
            const at = p.indexOf(': ');
            return <li key={p}>{at > 0 ? <><code>{p.slice(0, at)}</code>{p.slice(at)}</> : p}</li>;
          })
        )}
      </ul>
    </section>
  );
}

function emptyFor(section: RepoSection, vault: boolean, harness: Harness) {
  if ((section === 'overview' || section === 'decisions' || section === 'rules' || section === 'issues') && !vault) {
    return <Empty title="No vault yet.">{ADD_VAULT}</Empty>;
  }
  if (section === 'memory' && harness !== 'claude-code') return <Empty title={`${HARNESS_NAMES[harness]} keeps no memory nexus reads.`} />;
  if (section === 'memory') return <Empty title="No memory for sessions in this repo.">Claude Code writes memory here when a session saves something to remember.</Empty>;
  if (section === 'guardrails') return <Empty title="No accepted guardrails in an active build.">They appear here once you accept them at a guardrails gate.</Empty>;
  return <Empty title={`Nothing in ${SECTION_TITLES[section]} yet.`} />;
}

/** Repo mode's main screen: the overview's counts, or one kind, as a list grouped by load scope with a reader beside it. */
export function RepoView({ repo, route, navigate, client, zone, theme }: RepoViewProps) {
  // Before the Views return: hooks run on every render, and the draft survives a visit to Views.
  const { reviews, problems: reviewProblems, error: reviewsError, refresh: refreshReviews } = useReviews(client);
  const review = currentReview(reviews);
  const draft = useReviewDraft(review);
  // The review this tab sent, held here so the banner, the list and the reader lock together, at once, and stay
  // locked if the next read of the reviews never lands.
  const [sentName, setSentName] = useState<string | null>(null);
  // A review whose send was refused as already answered: named here, since its banner goes once it is applied.
  const [refused, setRefused] = useState<{ name: string; title: string } | null>(null);
  // The review whose answers are on their way: its marks and notes lock for as long as the send is out.
  const [sendingName, setSendingName] = useState<string | null>(null);
  const locked = review !== null && (reviewPhase(review) !== 'open' || sentName === review.request.name);
  const sending = review !== null && sendingName === review.request.name;
  const marksFor = (i: InventoryItem) => {
    const row = rowFor(review, i.id);
    return row && review ? <ReviewMarks row={row} draft={draft} readOnly={locked || sending} saved={review.answers} /> : null;
  };
  // A newer review opening takes the refused one's place: its notice would sit above a live banner.
  const supersedes = refused !== null && review !== null && review.request.name !== refused.name && reviewPhase(review) === 'open';
  useEffect(() => {
    if (supersedes) setRefused(null);
  }, [supersedes]);
  const section = sectionOf(route.sub);
  if (section === 'views') return <ViewsPanel repo={repo} route={route} navigate={navigate} client={client} theme={theme} />;
  const all = itemsFor(section, repo.inventory.items);
  const q = route.params['q'] ?? '';
  const showParam = route.params['show'];
  const show = showParam === undefined ? ALL_RECORDS : (showParam.split(',').filter((s) => (ALL_RECORDS as string[]).includes(s)) as RecordStatus[]);
  const visible = filterItems(all, q, show);
  const { selected, missing } = selectItem(all, visible, route.params['item']);
  const counts = recordCounts(repo.inventory.items);
  // All on is the default, so it leaves the URL; all off is "-", since an empty param would read as the default.
  const toggle = (r: RecordStatus) => {
    const next = show.includes(r) ? show.filter((s) => s !== r) : [...show, r];
    navigate(withParams(route, { show: next.length === ALL_RECORDS.length ? null : next.join(',') || '-' }));
  };
  const itemHash = (i: InventoryItem) => formatHash(withParams(route, { item: i.id }));
  // Across to the build side, keeping which build is open so a checkout with several builds skips the picker.
  const guardrailsHash = formatHash({ category: 'logs', sub: 'guardrails', params: keepBuild(route) });
  // One row, at the root of its scope or inside a folder group: the same link and the same review marks either way.
  const itemRow = (i: InventoryItem) => (
    <li key={i.id} className={rowFor(review, i.id) ? 'reviewed' : undefined}>
      <a className="repo-item" data-record={i.record} data-kind={i.kind} href={itemHash(i)} aria-current={selected?.id === i.id ? 'true' : undefined}>
        <span className="dot" aria-hidden="true" />
        <span className="t">
          {i.title}
          <small className="mono">{i.location}</small>
          {i.conditional && <small className="cond">{i.conditional}</small>}
        </span>
        <span className="m mono">{formatSize(i.size)}</span>
      </a>
      {/* Beside the link, never inside it: a button in a link is invalid and would navigate. */}
      {marksFor(i)}
    </li>
  );

  return (
    <section className="view flush" aria-labelledby="repo-title">
      <h1 id="repo-title" className="visually-hidden">
        {SECTION_TITLES[section]}
      </h1>
      <div className="view-body wide">
        <ReviewProblems problems={reviewProblems} error={reviewsError} />
        {/* While the refused review still shows, its banner says so itself. */}
        {refused && !supersedes && review?.request.name !== refused.name && (
          <section className="problems repo-problems" aria-label="Review already answered">
            <h2>“{refused.title}” was already answered</h2>
            <p role="alert">It was answered somewhere else, perhaps in another tab. Your marks here weren't sent.</p>
          </section>
        )}
        {/* Keyed by name, so one review's error never shows on the next. */}
        {review && (
          <ReviewBanner
            key={review.request.name}
            review={review}
            items={repo.inventory.items}
            draft={draft}
            client={client}
            readOnly={locked}
            sending={sending}
            onSending={(on) => setSendingName(on ? review.request.name : null)}
            onSent={() => {
              setSentName(review.request.name);
              setRefused(null);
            }}
            onConflict={() => setRefused({ name: review.request.name, title: review.request.title })}
            refresh={refreshReviews}
            zone={zone}
          />
        )}
        {section === 'overview' && (
          <div className="repo-cards">
            <div className="card">
              <div className={`num mono${counts.outside > 0 ? ' out' : ''}`}>{counts.outside}</div>
              <p className="card-title">Outside the record</p>
              <p>Loaded by agents, but not a decision or rule in docs/.</p>
            </div>
            <div className="card">
              <div className="num mono">{counts.recorded}</div>
              <p className="card-title">Recorded</p>
              <p>Decisions, active rules, open issues and the rule files generated from them.</p>
            </div>
            <div className="card">
              <div className="num mono">{counts.build}</div>
              <p className="card-title">This build</p>
              <p>Accepted guardrails, until the build is decommissioned.</p>
            </div>
          </div>
        )}
        {/* A problem names no kind, so it shows on the overview only. */}
        {section === 'overview' && <InventoryProblems problems={repo.inventory.problems} />}
        {section === 'overview' && !repo.inventory.vault && all.length > 0 && (
          <p className="repo-hint">
            <strong>No vault yet.</strong> {ADD_VAULT}
          </p>
        )}
        {/* With nothing in the section, the empty state is the whole message: nothing to filter or search. */}
        {all.length > 0 && (
          <div className="viewbar">
            {/* Named by its visible label, so "Show" isn't announced twice; "records" is for screen readers. */}
            <div className="toggles" role="group" aria-labelledby="repo-show">
              <span className="lbl" id="repo-show">
                Show<span className="visually-hidden"> records</span>
              </span>
              {ALL_RECORDS.map((r) => (
                <button key={r} type="button" className="tg" aria-pressed={show.includes(r)} onClick={() => toggle(r)}>
                  {RECORD_LABEL[r]} {all.filter((i) => i.record === r).length}
                </button>
              ))}
            </div>
            <input
              className="search"
              type="search"
              aria-label="Search the standing instructions"
              placeholder="Search"
              value={q}
              onChange={(e) => navigate(withParams(route, { q: e.target.value }), { replace: true })}
            />
            <span className="matches mono" aria-live="polite">
              {visible.length} of {all.length}
            </span>
          </div>
        )}
        {all.length === 0 ? (
          emptyFor(section, repo.inventory.vault, repo.inventory.harness)
        ) : (
          <div className="repo-split">
            <div className="repo-list">
              {groupByScope(visible).map((g) => {
                // Subfolder files sit under their folder, below the scope's root items.
                const { root, folders } = splitByFolder(g.items);
                return (
                  <section key={g.scope} className="repo-scope">
                    <h2>{g.title}</h2>
                    {g.scope === 'build' && (
                      <a className="repo-across" href={guardrailsHash}>
                        Open in Logs › Guardrails
                      </a>
                    )}
                    {root.length > 0 && <ul>{root.map(itemRow)}</ul>}
                    {folders.map((f) => (
                      <section key={f.folder} className="repo-folder" aria-label={`In ${f.folder}/`}>
                        {/* Only the path is data: "In" is a word, so it stays in the text face. */}
                        <h3>
                          In <span className="mono">{f.folder}/</span>
                        </h3>
                        <ul>{f.items.map(itemRow)}</ul>
                      </section>
                    ))}
                  </section>
                );
              })}
              {visible.length === 0 && <p className="hiddennote">Nothing matches. Clear the search or turn a record type back on.</p>}
            </div>
            {selected && <RepoReader item={selected} client={client} zone={zone} theme={theme} items={repo.inventory.items} route={route} reviewSlot={marksFor(selected)} />}
            {missing && (
              <article className="repo-reader">
                <Empty title="That standing instruction is no longer here.">It left this list when the repo changed. Pick another from the list.</Empty>
              </article>
            )}
          </div>
        )}
        {section === 'overview' && (
          <>
            {repo.inventory.setting && <p className="repo-foot repo-setting">{settingNote(repo.inventory.setting)}</p>}
            <p className="repo-foot">{notListedFor(repo.inventory.harness)}</p>
          </>
        )}
      </div>
    </section>
  );
}
