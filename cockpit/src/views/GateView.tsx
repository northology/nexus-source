import { useState } from 'react';
import { topicOf, topicsOf } from '../../../core/concept-text.ts';
import type { GateItem, GateType, GateView as Gate, Mark as MarkValue } from '../../../core/types.ts';
import type { AnswerBody } from '../api/client.ts';
import { ConceptRound } from '../components/ConceptRound.tsx';
import { Empty } from '../components/Empty.tsx';
import { SubmitBar, Tally } from '../components/MarkParts.tsx';
import { PhaseSelect } from '../components/PhaseSelect.tsx';
import { MarkIcon } from '../components/Icons.tsx';
import { Reader } from '../components/Reader.tsx';
import { Runner } from '../components/Runner.tsx';
import { useAnswer } from '../hooks/useAnswer.ts';
import { awaiting, displayRows, GATE_TAB_LABEL, gateState, gateTab, isGateTab, orderGates, tabCount, tabGates, visibleTabs, type GateState, type GateTab } from '../lib/gates.ts';
import { filledNotes } from '../lib/reviews.ts';
import { ALL_PHASES, inPhase, phaseInfo, selectedPhase } from '../lib/phases.ts';
import { GATE_MARKS, opensNote } from '../lib/marks.ts';
import { isMarkdown } from '../lib/markdown.ts';
import { lastWrite } from '../lib/rail.ts';
import { formatHash, keepBuild, withParams } from '../lib/route.ts';
import { formatTime } from '../lib/time.ts';
import type { ViewProps } from './types.ts';

const STATE_LABEL: Record<GateState, string> = { open: 'open', answered: 'sent', applied: 'applied' };
const KEY_TO_MARK: Record<string, MarkValue> = { a: 'accepted', r: 'research', d: 'declined' };
const MARK_LABEL: Record<MarkValue, string> = { accepted: 'Accept', research: 'Needs research', declined: 'Decline' };
const MARK_KEY: Record<MarkValue, string> = { accepted: 'A', research: 'R', declined: 'D' };
// A retire row asks a different question, so it has its own words and keys: accepting it retires the guardrail and
// declining keeps it. A and D are dead there, so a habit of "A means agree" can't retire one by accident.
const RETIRE_KEY_TO_MARK: Record<string, MarkValue> = { x: 'accepted', r: 'research', k: 'declined' };
const RETIRE_LABEL: Record<MarkValue, string> = { accepted: 'Retire', research: 'Needs research', declined: 'Keep' };
const RETIRE_KEY: Record<MarkValue, string> = { accepted: 'X', research: 'R', declined: 'K' };
const RETIRE_STATE: Record<MarkValue, string> = { accepted: 'retire', research: 'research', declined: 'keep' };

export function GateView(props: ViewProps) {
  const { snapshot, route, navigate, zone } = props;
  const gates = orderGates(snapshot.gates);
  const info = phaseInfo(snapshot.build);
  const phase = selectedPhase(route, info);
  const phaseParam = route.params['phase'];
  const keep = { ...keepBuild(route), ...(phaseParam ? { phase: phaseParam } : {}) };
  const tabParam = route.params['tab'];
  const asked: GateTab | null = isGateTab(tabParam) ? tabParam : null;
  // Needs-you is never filtered: with no gate and no tab chosen, the open gate shows whatever its phase.
  // A tab chosen by URL shows its open gate whatever the phase, else the first of its gates under the filter.
  const inAsked = asked ? tabGates(gates, asked, phase, null) : [];
  const current =
    route.sub !== null
      ? (gates.find((g) => g.name === route.sub) ?? null)
      : asked
        ? (inAsked.find((g) => gateState(g) === 'open') ?? inAsked[0] ?? null)
        : (gates.find((g) => gateState(g) === 'open') ?? null);
  const tab: GateTab | null = current ? gateTab(current.request) : asked;
  const listed = tab ? tabGates(gates, tab, phase, current) : [];
  const show = (g: Gate) => navigate({ category: 'gate', sub: g.name, params: keep });
  const selectTab = (t: GateTab) => {
    const inTab = tabGates(gates, t, phase, null);
    const target = inTab.find((g) => gateState(g) === 'open') ?? inTab[0];
    navigate(target ? { category: 'gate', sub: target.name, params: keep } : { category: 'gate', sub: null, params: { ...keep, tab: t } });
  };
  return (
    <section className="view flush" aria-labelledby="gate-title">
      {gates.length > 0 && (
        <Runner
          label="Gates"
          tabs={visibleTabs(gates).map((t) => ({
            key: t,
            label: GATE_TAB_LABEL[t],
            count: String(tabCount(gates, t, phase)),
            needs: gates.some((g) => gateTab(g.request) === t && gateState(g) === 'open'),
          }))}
          current={tab ?? ''}
          onSelect={(k) => {
            if (isGateTab(k)) selectTab(k);
          }}
        />
      )}
      <div className="view-body">
        {gates.length > 0 && info.names.length > 1 && (
          <div className="gate-bar">
            <PhaseSelect info={info} selected={phase} onSelect={(p) => navigate(withParams(route, { phase: p }))} />
          </div>
        )}
        {listed.length > 1 && <GateList gates={listed} current={current?.name ?? null} showPhase={phase === null || listed.some((g) => !inPhase(g.request.phase, phase))} zone={zone} onSelect={show} />}
        {current ? (
          <GatePanel key={current.name} gate={current} {...props} />
        ) : route.sub !== null ? (
          <>
            <h1 id="gate-title" className="visually-hidden">
              Gate
            </h1>
            <Empty title={`No gate named "${route.sub}"`}>
              It may have been removed or renamed. <a href={formatHash({ category: 'gate', sub: null, params: keepBuild(route) })}>Show what needs you</a>
            </Empty>
          </>
        ) : asked ? (
          <>
            <h1 id="gate-title" className="visually-hidden">
              Gate
            </h1>
            <Empty title={phase ? `No ${GATE_TAB_LABEL[asked].toLowerCase()} gate in ${phase}` : `No ${GATE_TAB_LABEL[asked].toLowerCase()} gates yet`}>
              {phase ? (
                <a href={formatHash({ category: 'gate', sub: null, params: { ...keepBuild(route), tab: asked, phase: ALL_PHASES } })}>Show all phases</a>
              ) : (
                'The agent opens one when this step needs your review.'
              )}
            </Empty>
          </>
        ) : (
          <BuildStatus {...props} />
        )}
      </div>
    </section>
  );
}

/** The tab's gates, above the one shown, when the tab holds more than one under the phase filter. */
function GateList({ gates, current, showPhase, zone, onSelect }: { gates: Gate[]; current: string | null; showPhase: boolean; zone: string; onSelect: (g: Gate) => void }) {
  return (
    <ul className="gate-list" aria-label="Gates in this tab">
      {gates.map((g) => {
        const state = gateState(g);
        return (
          <li key={g.name}>
            <button type="button" aria-current={g.name === current ? 'true' : undefined} data-state={state} onClick={() => onSelect(g)}>
              <span className="gl-state mono">{STATE_LABEL[state]}</span>
              <span className="gl-title">{g.request.title}</span>
              {showPhase && (
                <span className="gl-phase mono" aria-label={g.request.phase ? undefined : 'no phase'}>
                  {g.request.phase ?? '—'}
                </span>
              )}
              <time className="gl-time mono" dateTime={g.request.opened}>
                {formatTime(g.request.opened, zone)}
              </time>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function caption(type: GateType, state: GateState, count: number): string {
  if (state === 'answered') return 'sent; waiting for the agent to apply it';
  if (state === 'applied') return 'applied';
  if (type === 'mark-list') return count === 0 ? 'every row marked; ready to submit' : `${count} ${count === 1 ? 'row' : 'rows'} awaiting your mark`;
  if (type === 'concept-pick') return 'choose an option, combine some, or none of these';
  return 'approve, or send it back with a note';
}

/** A permit opens when the user approves, and closes after 30 minutes or once the gate is applied; say which state the gate is in. */
function permitLabel(state: string, decision: string | undefined): string {
  if (decision === 'approve') return 'Approved: the agent may change this file for 30 minutes, until the gate is applied';
  if (decision === 'send-back') return 'Sent back: no change allowed';
  if (state === 'open') return 'Approving lets the agent change a protected file';
  return 'Closed: no change allowed';
}

function GatePanel({ gate, build, snapshot, route, client, zone, theme, refresh }: ViewProps & { gate: Gate }) {
  const req = gate.request;
  const state = gateState(gate);
  const { submit: send, sending, error, sent } = useAnswer(client, build, gate.name, refresh);
  // After a successful send the panel stays locked until the reloaded snapshot shows the answer.
  const readOnly = state !== 'open' || sent !== null;
  const [marks, setMarks] = useState<Record<string, MarkValue>>({});
  const [note, setNote] = useState('');
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});

  const answered: Gate = gate.answers || !sent ? gate : { ...gate, answers: sent };
  // Once answered, show the permit the server stamped: that is what the wall uses, whatever the request says now.
  const permit = answered.answers?.permit ?? req.permit;
  const shownMarks = gate.answers?.marks ?? marks;
  const rows = displayRows(req, snapshot.guardrails);
  const savedNotes = answered.answers?.notes ?? {};
  const markRow = (name: string, m: MarkValue) => {
    setMarks((prev) => ({ ...prev, [name]: m }));
    if (opensNote(req.step, m) && !(rowNotes[name] ?? '').trim()) setNoteOpen((prev) => ({ ...prev, [name]: true }));
  };
  const count = readOnly ? 0 : awaiting(req, marks);
  // The panel note goes on a body that has no note of its own (a concept round carries its own).
  const withNote = (body: AnswerBody): AnswerBody => ('note' in body || !note.trim() ? body : { ...body, note: note.trim() });
  const submit = (body: AnswerBody) => send(withNote(body));

  // A later round links back to its topic's earlier rounds in Concepts › Chosen.
  const topic = req.type === 'concept-pick' ? topicsOf(snapshot.gates).find((t) => t.name === topicOf(req)) : undefined;
  const roundNumber = topic?.rounds.find((r) => r.gate.name === gate.name)?.number ?? 1;

  const docEntry = req.document ? [...snapshot.files.documents, ...snapshot.files.notes].find((f) => f.path === req.document) : undefined;
  const docs = [...snapshot.files.documents, ...snapshot.files.notes].map((f) => f.path).filter(isMarkdown);

  return (
    <div className={`gate gate-${req.type}`} data-state={state}>
      <header className="head">
        <span className={`figure${count > 0 ? '' : ' calm'}`} aria-hidden="true">
          {String(count)}
        </span>
        <div>
          <h1 id="gate-title">{req.title}</h1>
          <p>{req.why}</p>
        </div>
        <span className="figcap">
          {caption(req.type, state, count)} · opened {formatTime(req.opened, zone)}
        </span>
      </header>

      {error && (
        <p className="gate-error" role="alert">
          {error}
        </p>
      )}
      {readOnly && <Outcome gate={answered} zone={zone} />}

      {req.type === 'mark-list' && (
        <>
          {/* What the rows are about, read first; the count of rows to mark stays in the head above it. */}
          {req.document && (
            <div className="gate-doc">
              <Reader key={`${req.document}@${docEntry?.modified ?? ''}`} build={build} path={req.document} modified={docEntry?.modified ?? null} client={client} zone={zone} theme={theme} docs={docs} />
            </div>
          )}
          <MarkList
            items={rows}
            marks={shownMarks}
            readOnly={readOnly || sending}
            onMark={markRow}
            notes={rowNotes}
            saved={savedNotes}
            noteOpen={noteOpen}
            onNote={(name, text) => setRowNotes((prev) => ({ ...prev, [name]: text }))}
            onOpenNote={(name) => setNoteOpen((prev) => ({ ...prev, [name]: true }))}
          />
          {state === 'open' && (
            <SubmitBar left={<Tally items={rows} marks={marks} />} hint={count > 0 ? 'Mark every row to submit' : 'Ready to submit'} note={note} onNote={setNote} disabled={sending}>
              <button
                type="button"
                className="btn"
                disabled={count > 0 || sending}
                onClick={() => {
                  const notes = filledNotes(rowNotes);
                  void submit(Object.keys(notes).length ? { marks, notes } : { marks });
                }}
              >
                Submit marks
              </button>
            </SubmitBar>
          )}
        </>
      )}

      {topic && roundNumber > 1 && (
        <p className="crumb">
          Earlier rounds: <a href={formatHash({ category: 'concepts', sub: 'chosen', params: { ...keepBuild(route), topic: topic.name } })}>{topic.title}</a>
        </p>
      )}
      {req.type === 'concept-pick' && (
        <ConceptRound
          build={build}
          gate={answered}
          pages={new Set(snapshot.files.concepts.map((f) => f.path))}
          client={client}
          readOnly={readOnly}
          sending={sending}
          onSubmit={(b) => void submit(b)}
        />
      )}

      {req.type === 'approve' && (
        <>
          {permit && (
            <div className="permit">
              <span className="permit-label">{permitLabel(state, answered.answers?.decision)}</span>
              <code className="mono">{permit.target}</code>
              <p>{permit.change}</p>
            </div>
          )}
          {req.document && (
            <div className="gate-doc">
              <Reader key={`${req.document}@${docEntry?.modified ?? ''}`} build={build} path={req.document} modified={docEntry?.modified ?? null} client={client} zone={zone} theme={theme} docs={docs} />
            </div>
          )}
          {state === 'open' && (
            <SubmitBar hint="Approve, or send it back with a note" note={note} onNote={setNote} disabled={sending}>
              <button type="button" className="btn ghost" disabled={sending} onClick={() => void submit({ decision: 'send-back' })}>
                Send back
              </button>
              <button type="button" className="btn" disabled={sending} onClick={() => void submit({ decision: 'approve' })}>
                Approve
              </button>
            </SubmitBar>
          )}
        </>
      )}
    </div>
  );
}

function Outcome({ gate, zone }: { gate: Gate; zone: string }) {
  const a = gate.answers;
  if (!a) return null;
  const applied = gateState(gate) === 'applied';
  const label = (name: string) => gate.request.options?.find((o) => o.name === name)?.label ?? name;
  const choice = a.choice ? label(a.choice) : null;
  return (
    <p className="outcome" role="status">
      {applied ? `Applied ${formatTime(gate.read ?? a.submitted, zone)}.` : `Sent ${formatTime(a.submitted, zone)}. The agent applies it on your next message.`}
      {a.decision && (
        <>
          {' '}
          You chose <b>{a.decision === 'approve' ? 'approve' : 'send back'}</b>.
        </>
      )}
      {choice && (
        <>
          {' '}
          You picked <b>{choice}</b>.
        </>
      )}
      {a.choices && (
        <>
          {' '}
          You combined <b>{a.choices.map(label).join(' + ')}</b>.
        </>
      )}
      {a.none && (
        <>
          {' '}
          You chose <b>none of these</b>.
        </>
      )}
      {a.note && <> Note: “{a.note}”</>}
    </p>
  );
}

interface RowNoteProps {
  notes: Record<string, string>;
  saved: Record<string, string>;
  noteOpen: Record<string, boolean>;
  onNote: (name: string, text: string) => void;
  onOpenNote: (name: string) => void;
}

function MarkList({ items, marks, readOnly, onMark, notes, saved, noteOpen, onNote, onOpenNote }: { items: GateItem[]; marks: Record<string, MarkValue>; readOnly: boolean; onMark: (name: string, m: MarkValue) => void } & RowNoteProps) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Retire and Keep are words, so a gate with a retire row widens its mark column on every row to keep them aligned.
  const retiring = items.some((i) => i.retire);
  return (
    <>
      <div className={retiring ? 'cols retiring' : 'cols'} aria-hidden="true">
        <span />
        <span>Row</span>
        <span>Statement</span>
        <span>Source</span>
        <span>Your mark</span>
      </div>
      <ol className={retiring ? 'rows retiring' : 'rows'}>
        {items.map((item, i) => {
          const mark = marks[item.name];
          const isOpen = openRow === item.name;
          return (
            <li
              key={item.name}
              className={`row${isOpen ? ' open' : ''}`}
              data-state={mark ?? 'unmarked'}
              data-retire={item.retire ? '' : undefined}
              tabIndex={readOnly ? -1 : 0}
              aria-label={`${item.text}, ${mark ? `marked ${item.retire ? RETIRE_STATE[mark] : mark}` : 'not marked'}`}
              onKeyDown={(e) => {
                if (readOnly || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
                const m = (item.retire ? RETIRE_KEY_TO_MARK : KEY_TO_MARK)[e.key.toLowerCase()];
                if (m) {
                  e.preventDefault();
                  onMark(item.name, m);
                }
              }}
            >
              <span className="mark" aria-hidden="true">
                <svg viewBox="0 0 14 20">
                  <line className="dash" x1="7" y1="0" x2="7" y2="20" />
                  <line className="solid" x1="7" y1="0" x2="7" y2="20" />
                </svg>
              </span>
              <span className="num mono" aria-hidden="true">
                {String(i + 1)}
              </span>
              <div className="stmt">
                {item.retire && <span className="retire-tag mono">Retire</span>}
                {item.quote ? (
                  <button type="button" className="t" aria-expanded={isOpen} onClick={() => setOpenRow(isOpen ? null : item.name)}>
                    {item.text}
                  </button>
                ) : (
                  <span className="t">{item.text}</span>
                )}
                {isOpen && item.quote && <blockquote className="q">{item.quote}</blockquote>}
                {item.conflicts && item.conflicts.length > 0 && <span className="conflicts">conflicts with {item.conflicts.join(', ')}</span>}
                {readOnly ? (
                  saved[item.name] ? <small className="row-note">Note: {saved[item.name]}</small> : null
                ) : noteOpen[item.name] ? (
                  <textarea className="row-note-field" aria-label={`Note on: ${item.text}`} rows={2} maxLength={2000} value={notes[item.name] ?? ''} onChange={(e) => onNote(item.name, e.target.value)} />
                ) : (
                  <button type="button" className="note-link" aria-label={`Add note on: ${item.text}`} onClick={() => onOpenNote(item.name)}>
                    add note
                  </button>
                )}
              </div>
              <span className="src mono">{item.source ?? ''}</span>
              <span className="acts" role="group" aria-label={`Mark: ${item.text}`}>
                {GATE_MARKS.map((m) => {
                  // A retire row spells out Retire and Keep; research keeps its icon.
                  const label = item.retire ? RETIRE_LABEL[m] : MARK_LABEL[m];
                  const key = item.retire ? RETIRE_KEY[m] : MARK_KEY[m];
                  const worded = item.retire && m !== 'research';
                  return (
                    <button key={m} type="button" className={worded ? 'act word' : 'act'} aria-pressed={mark === m} aria-label={label} title={`${label} (${key})`} disabled={readOnly} onClick={() => onMark(item.name, m)}>
                      {worded ? label : <MarkIcon kind={m} />}
                    </button>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function BuildStatus({ snapshot, zone }: ViewProps) {
  const sent = snapshot.gates.filter((g) => gateState(g) === 'answered').length;
  const l = snapshot.logs;
  const facts: [string, string][] = [
    ['Stage', snapshot.build?.stage ?? 'unknown'],
    ['Decisions', String(l.decisions.length)],
    ['Open questions', String(l.questions.filter((e) => e.status !== 'answered').length)],
    ['Open issues', String(l.issues.filter((e) => e.status === 'open').length)],
    ['Changes', String(l.changes.length)],
    ['Documents', String(snapshot.files.documents.length + snapshot.files.notes.length)],
  ];
  const last = lastWrite(snapshot);
  const waiting = sent === 0 ? '' : `; ${sent} ${sent === 1 ? 'answer is' : 'answers are'} waiting for the agent to apply`;
  return (
    <div className="status">
      <header className="head">
        <span className="figure calm" aria-hidden="true">
          0
        </span>
        <div>
          <h1 id="gate-title">Nothing needs you right now</h1>
          <p>No gate is open. The agent opens one when it needs your review{waiting}.</p>
        </div>
      </header>
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
        {last && (
          <div>
            <dt>Last write</dt>
            <dd className="mono" data-volatile>
              {formatTime(last, zone)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
