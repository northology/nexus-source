import { plansOf, stateText, summarize } from '../../../core/plan-text.ts';
import type { PlanEntry, PlanProgress, TaskProgress } from '../../../core/types.ts';
import { useEffect, useRef } from 'react';
import { CopyView } from '../components/CopyView.tsx';
import { Empty } from '../components/Empty.tsx';
import { PhaseSelect } from '../components/PhaseSelect.tsx';
import { phaseInfo, selectedPhase } from '../lib/phases.ts';
import { COLUMNS, cardMeta, columnOf, glyphOf, linkFocus, pickPlan, planMode, stepsText, taskProgress, type Glyph } from '../lib/plan.ts';
import { formatHash, keepBuild, withParams } from '../lib/route.ts';
import { formatTime } from '../lib/time.ts';
import type { ViewProps } from './types.ts';

const fileName = (path: string): string => path.split('/').at(-1) ?? path;

/** Spec 2026-10-04-nexus-plan-section-design.md §6: an approved plan's tasks and how execution is going, read-only. */
export function PlanView({ snapshot, route, navigate, zone }: ViewProps) {
  const info = phaseInfo(snapshot.build);
  const phase = selectedPhase(route, info) ?? info.current;
  const plans = plansOf(snapshot.plan, phase);
  const plan = pickPlan(plans, route.params['plan']);
  const problem = snapshot.problems.find((p) => p.file === 'plan.json');
  const keep = keepBuild(route);
  const keepPhase = route.params['phase'] ? { phase: route.params['phase'] } : {};
  const docHref = (doc: string | null) => formatHash({ category: 'documents', sub: 'plans', params: doc ? { ...keep, doc } : keep });
  const phaseSelect = <PhaseSelect info={info} selected={phase} all={false} onSelect={(p) => navigate(withParams(route, { phase: p, plan: null, task: null }))} />;

  if (problem || !plan) {
    return (
      <section className="view" aria-labelledby="plan-title">
        <header className="head plain">
          <div>
            <h1 id="plan-title">Plan</h1>
            <p>
              Plans as written are in <a href={docHref(null)}>Documents › Plans</a>.
            </p>
          </div>
        </header>
        <div className="plan-bar">{phaseSelect}</div>
        {problem ? (
          <Empty title="plan.json could not be read">{problem.message}. The other sections still show.</Empty>
        ) : (
          <Empty title={`No approved plan for ${phase ?? 'this build'} yet`}>It appears here once its plan gate is approved.</Empty>
        )}
      </section>
    );
  }

  const progress = snapshot.planProgress[plan.id];
  const newest = plans.at(-1);
  const summary = summarize(plan, progress, { replaced: plan !== newest });
  const older = plans[plans.indexOf(plan) - 1];
  const planLink = (id?: string) => formatHash({ category: 'plan', sub: null, params: { ...keep, ...keepPhase, ...(route.params['mode'] ? { mode: route.params['mode'] } : {}), ...(id ? { plan: id } : {}) } });
  const mode = planMode(route.params['mode']);
  const openTask = route.params['task'] ?? null;
  const toggleTask = (id: string) => navigate(withParams(route, { task: openTask === id ? null : id }), { replace: true });

  return (
    <section className="view" aria-labelledby="plan-title">
      <header className="head plain">
        <div>
          <h1 id="plan-title">{plan.title}</h1>
          <p className="plan-meta">
            Approved at <a href={formatHash({ category: 'gate', sub: plan.gate, params: keep })}>{plan.gate}</a> · <a href={docHref(plan.document)}>{fileName(plan.document)}</a>
          </p>
          {plan !== newest && (
            <p className="plan-meta">
              A newer plan replaced this one. <a href={planLink()}>Show the current plan</a>
            </p>
          )}
          {older && (
            <p className="plan-meta">
              Replaced an earlier plan (<a href={planLink(older.id)}>{older.gate}</a>).
            </p>
          )}
        </div>
      </header>
      <div className="plan-bar">
        {phaseSelect}
        <p className="plan-summary mono">
          {summary.text}
          {summary.when && (
            <>
              {' · '}
              {summary.when.label}{' '}
              <time dateTime={summary.when.time} data-volatile>
                {formatTime(summary.when.time, zone)}
              </time>
            </>
          )}
        </p>
        <div className="plan-modes" role="group" aria-label="Show tasks as">
          {(['list', 'board'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => navigate(withParams(route, { mode: m === 'list' ? null : m }))}>
              {m === 'list' ? 'List' : 'Board'}
            </button>
          ))}
        </div>
        <CopyView />
      </div>
      {summary.notice && <p className="plan-notice">{summary.notice}</p>}
      {plan.tasks.length === 0 ? (
        <Empty title="This plan has no tasks nexus can read">
          The plan itself is in <a href={docHref(plan.document)}>{fileName(plan.document)}</a>.
        </Empty>
      ) : mode === 'board' ? (
        <PlanBoard plan={plan} progress={progress} openTask={openTask} onToggle={toggleTask} />
      ) : (
        <PlanList plan={plan} progress={progress} openTask={openTask} onToggle={toggleTask} allDone={summary.done === summary.total} />
      )}
    </section>
  );
}

interface ModeProps {
  plan: PlanEntry;
  progress: PlanProgress | undefined;
  openTask: string | null;
  onToggle: (id: string) => void;
}

function PlanList({ plan, progress, openTask, onToggle, allDone }: ModeProps & { allDone: boolean }) {
  const rows = plan.tasks.map((task) => ({ task, p: taskProgress(progress, task.id) }));
  return (
    <>
      <div className="plan-strip" aria-hidden="true">
        {rows.map(({ task, p }) => (
          <span key={task.id} className={`ps ps-${glyphOf(p.state)}`} />
        ))}
      </div>
      <div className="pcols" aria-hidden="true">
        <span />
        <span>Task</span>
        <span>State</span>
        <span>Commits</span>
        <span>Rulings</span>
        <span>Minors</span>
      </div>
      <ul className="ptasks" aria-label="Tasks">
        {rows.map(({ task, p }) => {
          const open = openTask === task.id;
          return (
            <li key={task.id} className={`ptask${open ? ' open' : ''}`}>
              <button type="button" className="prow" aria-expanded={open} aria-controls={`detail-${task.id}`} onClick={() => onToggle(task.id)}>
                <TaskGlyph kind={glyphOf(p.state)} />
                <span className="pt">
                  <span className="pt-title">{task.title}</span>
                  <small>{stepsText(task.steps, p)}</small>
                </span>
                <span className="mono">{stateText(p)}</span>
                <span className="mono">{p.commits ?? ''}</span>
                <span className="mono">{p.rulings.length || '–'}</span>
                <span className="mono">{p.minors.length || '–'}</span>
              </button>
              {open && <TaskDetail id={`detail-${task.id}`} p={p} showDone />}
            </li>
          );
        })}
      </ul>
      <FinalReview progress={progress} allDone={allDone} />
    </>
  );
}

function TaskGlyph({ kind }: { kind: Glyph }) {
  return (
    <span className={`pg pg-${kind}`} aria-hidden="true">
      {kind === 'unknown' ? '?' : null}
    </span>
  );
}

function Notes({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </>
  );
}

/** `showDone`: the list opens with a Done line; the board's state line above already says so, so it shows the note alone. */
function TaskDetail({ id, p, showDone = false }: { id: string; p: TaskProgress; showDone?: boolean }) {
  const done = p.state === 'done';
  const nothing = !p.fixRounds.length && !p.parkedFindings.length && !p.rulings.length && !p.minors.length;
  return (
    <div className="pdetail" id={id}>
      {done && showDone && (
        <p className="pd-done">
          Done
          {p.commits ? <span className="mono"> · {p.commits}</span> : null}
          {p.note ? <span className="mono"> · {p.note}</span> : null}
        </p>
      )}
      {done && !showDone && p.note && <p className="pd-done mono">{p.note}</p>}
      {nothing && !done && <p className="pd-none">Nothing recorded for this task yet.</p>}
      {p.fixRounds.length > 0 && (
        <>
          <h3>Fix rounds</h3>
          <ul>
            {p.fixRounds.map((r, i) => (
              <li key={i}>
                <span className="mono">round {r.round}</span> {r.addressed} addressed, {r.open} open
                {r.findings ? ` — ${r.findings}` : ''}
                {r.commits ? <span className="mono"> · {r.commits}</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {p.parkedFindings.length > 0 && <Notes title="Parked" items={p.parkedFindings} />}
      {p.rulings.length > 0 && <Notes title="Rulings" items={p.rulings} />}
      {p.minors.length > 0 && <Notes title="Deferred minors" items={p.minors} />}
    </div>
  );
}

function FinalReview({ progress, allDone }: { progress: PlanProgress | undefined; allDone: boolean }) {
  const f = progress?.final;
  const empty = !f || (!f.rulings.length && !f.minors.length);
  return (
    <section className="pfinal" aria-labelledby="final-title">
      <h2 id="final-title">Final review</h2>
      {empty || !f ? (
        <p>{allDone ? 'Nothing recorded from the final review.' : 'Not yet: runs after the last task.'}</p>
      ) : (
        <>
          {f.rulings.length > 0 && <Notes title="Rulings" items={f.rulings} />}
          {f.minors.length > 0 && <Notes title="Deferred minors" items={f.minors} />}
        </>
      )}
    </section>
  );
}

function PlanBoard({ plan, progress, openTask, onToggle }: ModeProps) {
  const cards = plan.tasks.map((task) => ({ task, p: taskProgress(progress, task.id) }));
  const open = cards.find((c) => c.task.id === openTask);
  const openId = open?.task.id;
  const detail = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // A deep link scrolls its detail into view but leaves focus alone; a click moves focus (lib/plan.ts linkFocus). A
  // switch from List to Board keeps the task open from the address, so focus stays on the button pressed.
  const focusFor = useRef(linkFocus(openId)).current;
  useEffect(() => {
    if (!openId) {
      focusFor(openId);
      return;
    }
    detail.current?.scrollIntoView({ block: 'nearest' });
    if (focusFor(openId)) heading.current?.focus({ preventScroll: true });
  }, [openId, focusFor]);
  return (
    <>
      <div className="board">
        {COLUMNS.map((col) => {
          const inColumn = cards.filter((c) => columnOf(c.p.state) === col.key);
          return (
            <section key={col.key} className="bcol" aria-label={`${col.label}: ${inColumn.length}`}>
              <h2 className="bcol-head">
                <span>{col.label}</span>
                <span className="mono">{inColumn.length}</span>
              </h2>
              {inColumn.length === 0 && <p className="bcol-none">None</p>}
              <ul>
                {inColumn.map(({ task, p }) => (
                  <li key={task.id}>
                    <button type="button" className={`bcard bcard-${glyphOf(p.state)}`} aria-expanded={task.id === openTask} aria-controls={`detail-${task.id}`} onClick={() => onToggle(task.id)}>
                      <span className="bcard-title">{task.title}</span>
                      <span className="bcard-meta mono">{cardMeta(task.steps, p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {open && (
        <div className="board-detail" ref={detail}>
          <h2 tabIndex={-1} ref={heading}>
            {open.task.title}
          </h2>
          <p className="mono">
            {stateText(open.p)}
            {open.p.commits ? ` · ${open.p.commits}` : ''}
          </p>
          <TaskDetail id={`detail-${open.task.id}`} p={open.p} />
        </div>
      )}
    </>
  );
}
