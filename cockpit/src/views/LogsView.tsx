import type { LogEntry, LogName } from '../../../core/types.ts';
import { GuardrailsPanel } from './GuardrailsPanel.tsx';
import { Empty } from '../components/Empty.tsx';
import { Mark } from '../components/Mark.tsx';
import { PhaseSelect } from '../components/PhaseSelect.tsx';
import { Runner } from '../components/Runner.tsx';
import { ViewBar } from '../components/ViewBar.tsx';
import { LOG_STYLES, defaultShown, styleOf } from '../lib/marks.ts';
import { ALL_PHASES, inPhase, phaseInfo, selectedPhase } from '../lib/phases.ts';
import { LOG_TABS, formatHash, keepBuild, withParams, type LogTab } from '../lib/route.ts';
import { formatTime } from '../lib/time.ts';
import type { ViewProps } from './types.ts';

const TITLES: Record<LogTab, { tab: string; col: string; source: string; when: string; empty: string }> = {
  decisions: { tab: 'Decision log', col: 'Decision', source: 'From', when: 'When', empty: 'Settled items land here, including what you mark at gates.' },
  issues: { tab: 'Issues', col: 'Issue', source: 'Source', when: 'Raised', empty: 'Problems found during the build land here.' },
  changes: { tab: 'Change log', col: 'Change', source: 'Commit', when: 'When', empty: 'Changes to scope or plan land here, each with its commit.' },
  guardrails: { tab: 'Guardrails', col: 'Guardrail', source: 'Raised by', when: 'When', empty: 'Guardrails the agent proposes land here, and apply once you accept them at a gate.' },
  questions: { tab: 'Open questions', col: 'Question', source: 'From', when: 'Raised', empty: 'Items still being explored or researched land here.' },
};

const isLogTab = (v: string | null): v is LogTab => v !== null && (LOG_TABS as readonly string[]).includes(v);

function countBy(entries: LogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.status] = (out[e.status] ?? 0) + 1;
  return out;
}

export function LogsView(props: ViewProps) {
  const { snapshot, route, navigate, zone } = props;
  const log: LogTab = isLogTab(route.sub) ? route.sub : 'decisions';
  const info = phaseInfo(snapshot.build);
  const phase = selectedPhase(route, info);
  const phaseParam = route.params['phase'];
  const keep = { ...keepBuild(route), ...(phaseParam ? { phase: phaseParam } : {}) };
  const entries = snapshot.logs[log].filter((e) => inPhase(e.phase, phase));
  const showParam = route.params['show'];
  const shown = showParam === undefined ? defaultShown(log) : showParam.split(',').filter((s) => s !== '' && s !== '-');
  const q = route.params['q'] ?? '';
  const needle = q.trim().toLowerCase();
  const matches = (e: LogEntry) => needle === '' || [e.text, e.note, e.quote, e.source, e.commit].some((v) => v?.toLowerCase().includes(needle));
  const visible = entries.filter((e) => shown.includes(e.status) && matches(e));
  const hidden = entries.filter((e) => !shown.includes(e.status));
  const counts = countBy(entries);
  const problem = snapshot.problems.find((p) => p.file === `logs/${log}.json`);
  const title = TITLES[log];

  const toggle = (status: string) => {
    const next = shown.includes(status) ? shown.filter((s) => s !== status) : [...shown, status];
    navigate(withParams(route, { show: next.length ? next.join(',') : '-' }));
  };

  return (
    <section className="view flush" aria-labelledby="logs-title">
      <h1 id="logs-title" className="visually-hidden">
        Logs
      </h1>
      <Runner
        label="Logs"
        tabs={LOG_TABS.map((k) => ({ key: k, label: TITLES[k].tab, count: String(k === 'guardrails' ? snapshot.guardrails.length : snapshot.logs[k].filter((e) => inPhase(e.phase, phase)).length) }))}
        current={log}
        onSelect={(k) => navigate({ category: 'logs', sub: k, params: keep })}
      />
      <div className="view-body">
        {log === 'guardrails' ? (
          <GuardrailsPanel {...props} />
        ) : (
          <>
            <ViewBar
              toggles={LOG_STYLES[log].map((s) => ({ key: s.status, label: s.status, count: counts[s.status] ?? 0, mark: s.mark, on: shown.includes(s.status) }))}
              onToggle={toggle}
              search={q}
              onSearch={(value) => navigate(withParams(route, { q: value }), { replace: true })}
              searchLabel={`Search the ${title.tab.toLowerCase()}`}
              shown={visible.length}
              total={entries.length}
              before={<PhaseSelect info={info} selected={phase} onSelect={(p) => navigate(withParams(route, { phase: p }))} />}
            />
            {problem ? (
              <Empty title={`logs/${log}.json could not be read`}>{problem.message}. The other logs still show.</Empty>
            ) : entries.length === 0 && phase !== null && snapshot.logs[log].length > 0 ? (
              <Empty title={`Nothing for ${phase}.`}>
                <a href={formatHash(withParams(route, { phase: ALL_PHASES }))}>Show all phases</a>
              </Empty>
            ) : entries.length === 0 ? (
              <Empty title={`Nothing in the ${title.tab.toLowerCase()} yet`}>{title.empty}</Empty>
            ) : (
              <>
                <div className="ecols" aria-hidden="true">
                  <span />
                  <span>{title.col}</span>
                  <span>Status</span>
                  <span>{title.source}</span>
                  <span>{title.when}</span>
                </div>
                <ul className="entries">
                  {visible.map((e) => (
                    <EntryRow key={e.name} log={log} entry={e} zone={zone} />
                  ))}
                </ul>
                {visible.length === 0 && <p className="hiddennote">Nothing here matches.</p>}
                {hidden.length > 0 && (
                  <p className="hiddennote">
                    {hidden.length} hidden ({[...new Set(hidden.map((e) => e.status))].join(', ')}) ·{' '}
                    <button type="button" onClick={() => navigate(withParams(route, { show: LOG_STYLES[log].map((s) => s.status).join(',') }))}>
                      show all
                    </button>
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EntryRow({ log, entry, zone }: { log: LogName; entry: LogEntry; zone: string }) {
  const style = styleOf(log, entry.status);
  return (
    <li className={`erow${style.struck ? ' struck' : ''}${style.shownByDefault ? '' : ' closed'}`}>
      <span className="emark">
        <Mark kind={style.mark} />
      </span>
      <div className="et">
        <span className="et-text">{entry.text}</span>
        {entry.note && <small>{entry.note}</small>}
        {entry.quote && <small>“{entry.quote}”</small>}
      </div>
      <span className="es mono">{entry.status}</span>
      <span className="ew mono">{log === 'changes' && entry.commit ? entry.commit : entry.source}</span>
      <time className="ed mono" dateTime={entry.time}>
        {formatTime(entry.time, zone)}
      </time>
    </li>
  );
}
