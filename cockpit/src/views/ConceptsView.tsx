import { useEffect, useState } from 'react';
import { openRounds, outcomeText, topicOf, topicsOf, type Round, type Topic } from '../../../core/concept-text.ts';
import type { FileEntry, GateOption } from '../../../core/types.ts';
import { ConceptFrame } from '../components/ConceptFrame.tsx';
import { ConceptRound, ConceptThumb } from '../components/ConceptRound.tsx';
import { Empty } from '../components/Empty.tsx';
import { PhaseSelect } from '../components/PhaseSelect.tsx';
import { Runner } from '../components/Runner.tsx';
import type { AnswerBody } from '../api/client.ts';
import { useAnswer } from '../hooks/useAnswer.ts';
import { chosenInPhase, CONCEPT_TABS, conceptTab, refinementsOf, roundsInPhase, topicsInPhase, unusedPages, type ConceptTab } from '../lib/concepts.ts';
import { titleFromPath } from '../lib/markdown.ts';
import { ALL_PHASES, phaseInfo, selectedPhase } from '../lib/phases.ts';
import { formatHash, keepBuild, keepPhase, withParams } from '../lib/route.ts';
import { formatTime } from '../lib/time.ts';
import type { ViewProps } from './types.ts';

const TAB_LABEL: Record<ConceptTab, string> = { proposed: 'Proposed', chosen: 'Chosen' };

/** A page shown full size over the section, from the Chosen lineage or pick. */
interface FullPage { label: string; page: string }

export function ConceptsView(props: ViewProps) {
  const { snapshot, route, navigate } = props;
  const info = phaseInfo(snapshot.build);
  const phase = selectedPhase(route, info);
  const phaseParam = route.params['phase'];
  const keep = { ...keepBuild(route), ...(phaseParam ? { phase: phaseParam } : {}) };
  const tab = conceptTab(route.sub);
  const all = topicsOf(snapshot.gates);
  // Open rounds show whatever the phase: topicsInPhase keeps every topic with one.
  const rounds = openRounds(topicsInPhase(all, phase));
  const chosen = chosenInPhase(all, snapshot.logs, phase);
  const pages: ReadonlySet<string> = new Set(snapshot.files.concepts.map((f) => f.path));
  const counts: Record<ConceptTab, { count: string; needs: boolean }> = {
    proposed: { count: String(rounds.length), needs: rounds.length > 0 },
    chosen: { count: String(chosen.length), needs: false },
  };

  return (
    <section className="view flush" aria-labelledby="concepts-title">
      <h1 id="concepts-title" className="visually-hidden">
        Concepts
      </h1>
      <Runner
        label="Concepts"
        tabs={CONCEPT_TABS.map((k) => ({ key: k, label: TAB_LABEL[k], ...counts[k] }))}
        current={tab}
        onSelect={(k) => navigate({ category: 'concepts', sub: conceptTab(k), params: keep })}
      />
      <div className="view-body wide">
        {info.names.length > 1 && (
          <div className="docbar">
            <PhaseSelect info={info} selected={phase} onSelect={(p) => navigate(withParams(route, { phase: p }))} />
          </div>
        )}
        {tab === 'proposed' ? <Proposed {...props} rounds={rounds} pages={pages} /> : <Chosen {...props} topics={chosen} phase={phase} pages={pages} />}
      </div>
    </section>
  );
}

type Shared = ViewProps & { pages: ReadonlySet<string> };

function Proposed(props: Shared & { rounds: Round[] }) {
  const { snapshot, route, navigate, rounds } = props;
  const asked = route.params['round'];
  // The round the address names, open or not (one just answered stays shown), else the oldest open round.
  const named = asked ? topicsOf(snapshot.gates).flatMap((t) => t.rounds).find((r) => r.gate.name === asked) : undefined;
  const current = named ?? rounds[0] ?? null;
  const unused = unusedPages(snapshot.files.concepts, snapshot.gates);
  return (
    <>
      {rounds.some((r) => r.gate.name !== current?.gate.name) && (
        <nav className="crounds" aria-label="Rounds waiting for you">
          <ul>
            {rounds.map((r) => (
              <li key={r.gate.name}>
                <button type="button" aria-current={r.gate.name === current?.gate.name ? 'true' : undefined} onClick={() => navigate(withParams(route, { round: r.gate.name }))}>
                  <span className="ctitle">{r.gate.request.title}</span>
                  <span className="cnum mono">round {r.number}</span>
                  <span className="needs">waiting for you</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {current ? (
        <ProposedRound key={current.gate.name} {...props} round={current} />
      ) : (
        <Empty title="Nothing to choose right now">Rounds appear here when the agent has options to show you.</Empty>
      )}
      {unused.length > 0 && <Unused {...props} unused={unused} />}
    </>
  );
}

/**
 * The selected round: its heading, then the shared round viewer answering through the same path as the Gate view.
 * Sending an answer puts the round in the address first, so it stays shown, read-only, once the reload closes it.
 */
function ProposedRound({ round, build, client, refresh, pages, route, navigate }: Shared & { round: Round }) {
  const gate = round.gate;
  const { submit, sending, error, sent } = useAnswer(client, build, gate.name, refresh);
  const shown = gate.answers || !sent ? gate : { ...gate, answers: sent };
  const send = (body: AnswerBody) => {
    navigate(withParams(route, { round: gate.name }), { replace: true });
    void submit(body);
  };
  return (
    <div className="cproposed">
      <header className="chead">
        <h2>{gate.request.title}</h2>
        <span className="cnum mono">round {round.number}</span>
        <p>{gate.request.why}</p>
      </header>
      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      {shown.answers && (
        <p className="cseen">
          <a href={formatHash({ category: 'concepts', sub: 'chosen', params: { ...keepBuild(route), ...keepPhase(route), topic: topicOf(gate.request) } })}>See it in Chosen</a>
        </p>
      )}
      <ConceptRound build={build} gate={shown} pages={pages} client={client} readOnly={shown.answers !== null} sending={sending} onSubmit={send} />
    </div>
  );
}

/** Concept pages no round uses, each viewable in a sandboxed frame below the list. */
function Unused({ unused, route, navigate, build, client }: Shared & { unused: FileEntry[] }) {
  const current = unused.find((f) => f.path === route.params['page']) ?? null;
  return (
    <section className="cunused" aria-labelledby="cunused-title">
      <h2 id="cunused-title">Not in a round</h2>
      <ul>
        {unused.map((f) => (
          <li key={f.path}>
            <button type="button" aria-pressed={f === current} onClick={() => navigate(withParams(route, { page: f === current ? null : f.path }))}>
              <b>{titleFromPath(f.path)}</b>
              <span className="mono">{f.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {current && <ConceptFrame className="cframe" title={titleFromPath(current.path)} src={client.fileUrl(build, current.path)} />}
    </section>
  );
}

function Chosen({ topics, phase, pages, route, navigate, build, client, zone, snapshot }: Shared & { topics: Topic[]; phase: string | null }) {
  const [full, setFull] = useState<FullPage | null>(null);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const topic = topics.find((t) => t.name === route.params['topic']) ?? topics[0] ?? null;
  if (!topic) return <Empty title="Nothing chosen yet">A topic shows here once you answer its first round.</Empty>;
  const shown = roundsInPhase(topic, phase);
  const refinements = refinementsOf(snapshot.logs, topic.name, phase);
  const hiddenRefinements = refinements.length < refinementsOf(snapshot.logs, topic.name, null).length;
  const open = topic.rounds.find((r) => r.outcome.kind === 'open');
  const pick = topic.pick;
  const thumb = (o: GateOption) => <ConceptThumb build={build} page={o.page} pages={pages} client={client} />;

  return (
    <>
      <nav className="ctopics" aria-label="Topics">
        <ul>
          {topics.map((t) => {
            // The rounds the selected phase holds, as its lineage shows them.
            const n = roundsInPhase(t, phase).length;
            return (
              <li key={t.name}>
                <button type="button" aria-current={t === topic ? 'true' : undefined} onClick={() => navigate(withParams(route, { topic: t.name }))}>
                  <span className="ctitle">{t.title}</span>
                  <span className="cnum mono">
                    {n} {n === 1 ? 'round' : 'rounds'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="chosen">
        <h2 className="ctopic">{topic.title}</h2>
        <div className="cpick-col">
          {open ? (
            <a className="cnext" href={formatHash({ category: 'concepts', sub: 'proposed', params: { ...keepBuild(route), round: open.gate.name } })}>
              Round {open.number} is waiting for you
            </a>
          ) : pick ? (
            <figure className="cpick">
              <div className="copt">
                {thumb(pick)}
                <button type="button" aria-label={`${pick.label}, full view`} onClick={() => setFull({ label: pick.label, page: pick.page })} />
              </div>
              <figcaption>
                <span className="cpick-label">{pick.label}</span>
                {pick.source && <span className="src mono">{pick.source}</span>}
                <span className="cpick-meta">
                  {topic.answered && (
                    <>
                      Chosen{' '}
                      <time className="mono" dateTime={topic.answered} data-volatile>
                        {formatTime(topic.answered, zone)}
                      </time>
                      {' · '}
                    </>
                  )}
                  <a href={formatHash({ category: 'gate', sub: topic.latest.gate.name, params: keepBuild(route) })}>Open its gate</a>
                </span>
              </figcaption>
            </figure>
          ) : (
            <p className="cwait">Waiting for the agent's next round</p>
          )}
        </div>

        <div className="clineage">
          <ol className="lineage">
            {shown.map((r) => {
              const decided = r.outcome.kind !== 'open';
              const note = r.gate.answers?.note;
              return (
                <li key={r.gate.name} data-outcome={r.outcome.kind}>
                  <h3 className="lout">
                    Round {r.number} · {outcomeText(r)}
                  </h3>
                  <p className="ltitle">{r.gate.request.title}</p>
                  {note && <q>{note}</q>}
                  <ul className="lthumbs" aria-label={`Round ${r.number} options`}>
                    {(r.gate.request.options ?? []).map((o) => (
                      <li key={o.name} className="copt">
                        {thumb(o)}
                        <button type="button" data-kept={decided ? r.kept.includes(o.name) : undefined} onClick={() => setFull({ label: o.label, page: o.page })}>
                          <span className="clabel">{o.label}</span>
                          {/* Kept and dropped show by style; a screen reader hears it said. */}
                          {decided && <span className="visually-hidden">{r.kept.includes(o.name) ? ', kept' : ', dropped'}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
          {refinements.length > 0 && (
            <section className="crefine">
              <h3>Refinements</h3>
              <ol>
                {refinements.map(({ log, entry }) => (
                  <li key={`${log}/${entry.name}`}>
                    <p>{entry.text}</p>
                    <span className="cmeta">
                      <time className="mono" dateTime={entry.time} data-volatile>
                        {formatTime(entry.time, zone)}
                      </time>
                      {' · '}
                      {entry.source}
                      {' · '}
                      {log}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(shown.length < topic.rounds.length || hiddenRefinements) && (
            <a className="call" href={formatHash(withParams(route, { phase: ALL_PHASES }))}>
              Show all phases
            </a>
          )}
        </div>
      </div>

      {full && (
        <div className="cfull">
          <div className="cview-bar">
            <span className="cview-label">{full.label}</span>
            <span className="chint">Back to return</span>
            <button type="button" className="btn ghost small" autoFocus onClick={() => setFull(null)}>
              Back
            </button>
          </div>
          {pages.has(full.page) ? (
            <ConceptFrame className="cframe" title={full.label} src={client.fileUrl(build, full.page)} />
          ) : (
            <div className="cframe-missing">Page missing: {full.page}</div>
          )}
        </div>
      )}
    </>
  );
}
