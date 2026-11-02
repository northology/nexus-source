import { useEffect, useState } from 'react';
import type { GuardrailView, RuleFile } from '../../../core/types.ts';
import type { Client } from '../api/client.ts';
import { Empty } from '../components/Empty.tsx';
import { Mark } from '../components/Mark.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { ViewBar } from '../components/ViewBar.tsx';
import { GUARDRAIL_STYLES } from '../lib/marks.ts';
import { raisedByLabel } from '../lib/raised-by.ts';
import type { Theme } from '../lib/prefs.ts';
import { formatHash, keepBuild, withParams, type Route } from '../lib/route.ts';
import { formatTime } from '../lib/time.ts';
import type { ViewProps } from './types.ts';

const styleOf = (state: string) => GUARDRAIL_STYLES.find((x) => x.status === state);

export function GuardrailsPanel({ snapshot, route, navigate, client, zone, theme }: ViewProps) {
  const all = snapshot.guardrails;
  const showParam = route.params['show'];
  const shown = showParam === undefined ? GUARDRAIL_STYLES.filter((x) => x.shownByDefault).map((x) => x.status) : showParam.split(',').filter((v) => v !== '' && v !== '-');
  const q = route.params['q'] ?? '';
  const needle = q.trim().toLowerCase();
  const matches = (g: GuardrailView) => needle === '' || [g.entry.text, g.entry.note, g.entry.quote, g.entry.source].some((v) => v?.toLowerCase().includes(needle));
  const hidden = all.filter((g) => !shown.includes(g.state));
  const visible = all.filter((g) => shown.includes(g.state) && matches(g));
  const counts: Record<string, number> = {};
  for (const g of all) counts[g.state] = (counts[g.state] ?? 0) + 1;
  const problem = snapshot.problems.find((p) => p.file === 'logs/guardrails.json');
  const toggle = (state: string) => {
    const next = shown.includes(state) ? shown.filter((x) => x !== state) : [...shown, state];
    navigate(withParams(route, { show: next.length ? next.join(',') : '-' }));
  };
  return (
    <>
      <ViewBar
        toggles={GUARDRAIL_STYLES.map((x) => ({ key: x.status, label: x.status, count: counts[x.status] ?? 0, mark: x.mark, on: shown.includes(x.status) }))}
        onToggle={toggle}
        search={q}
        onSearch={(value) => navigate(withParams(route, { q: value }), { replace: true })}
        searchLabel="Search the guardrails"
        shown={visible.length}
        total={all.length}
      />
      {problem ? (
        <Empty title="logs/guardrails.json could not be read">{problem.message}. Until it's fixed, no guardrail counts as accepted.</Empty>
      ) : all.length === 0 ? (
        <Empty title="No guardrails in this build yet">The agent proposes guardrails as planning surfaces them. Each applies only once you accept it at a gate.</Empty>
      ) : (
        <>
          <div className="ecols" aria-hidden="true">
            <span />
            <span>Guardrail</span>
            <span>State</span>
            <span>Raised by</span>
            <span>When</span>
          </div>
          <ul className="entries">
            {visible.map((g) => {
              const style = styleOf(g.state);
              return (
                <li key={g.entry.name} className={`erow${style?.struck ? ' struck' : ''}${style?.shownByDefault ? '' : ' closed'}`}>
                  <span className="emark">
                    <Mark kind={style?.mark ?? 'dashed'} />
                  </span>
                  <div className="et">
                    <span className="et-text">{g.entry.text}</span>
                    {g.entry.note && <small>{g.entry.note}</small>}
                    {g.entry.quote && <small>“{g.entry.quote}”</small>}
                  </div>
                  <span className="es mono">{g.state}</span>
                  <span className="ew mono">
                    {raisedByLabel(g.entry.raisedBy)} · {g.entry.source}
                  </span>
                  <time className="ed mono" dateTime={g.decided ?? g.entry.time}>
                    {formatTime(g.decided ?? g.entry.time, zone)}
                  </time>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 && <p className="hiddennote">Nothing here matches.</p>}
          {hidden.length > 0 && (
            <p className="hiddennote">
              {hidden.length} hidden ({[...new Set(hidden.map((g) => g.state))].join(', ')}) ·{' '}
              <button type="button" onClick={() => navigate(withParams(route, { show: GUARDRAIL_STYLES.map((x) => x.status).join(',') }))}>
                show all
              </button>
            </p>
          )}
        </>
      )}
      <StaticRules rules={snapshot.rules} route={route} client={client} theme={theme} />
    </>
  );
}

function StaticRules({ rules, route, client, theme }: { rules: RuleFile[]; route: Route; client: Client; theme: Theme }) {
  // Across to Repo mode, keeping which build is open so coming back skips the picker.
  const repoHash = formatHash({ category: 'repo', sub: 'overview', params: keepBuild(route) });
  return (
    <section className="rules" aria-labelledby="rules-title">
      <h2 id="rules-title">Static rules</h2>
      <p className="rules-intro">Always in force for this repo. nexus reads them and never changes them; a build guardrail reaches them only through decommissioning, one approval at a time.</p>
      <p className="rules-intro">
        <a href={repoHash}>See every standing instruction</a> an agent loads in this repo, recorded or not.
      </p>
      {rules.length === 0 ? (
        <Empty title="No static rules configured">
          List the repo’s rule files under <code>staticRules</code> in <code>.nexus/config.json</code> to see them here.
        </Empty>
      ) : (
        rules.map((r) => <RuleFileView key={r.index} rule={r} client={client} theme={theme} />)
      )}
    </section>
  );
}

/** A repo file, rendered as Repo mode renders it: links resolve to nothing in the build, and outside images are links. */
function RuleFileView({ rule, client, theme }: { rule: RuleFile; client: Client; theme: Theme }) {
  const [text, setText] = useState<string | null>(null);
  // The snapshot's problem is read on every render: a rule file created after the page loaded clears it.
  const [failed, setFailed] = useState<string | null>(null);
  const error = rule.problem ?? failed;
  useEffect(() => {
    setFailed(null);
    if (rule.problem) return;
    let cancelled = false;
    client.ruleText(rule.index).then(
      (t) => {
        if (!cancelled) setText(t);
      },
      (e: unknown) => {
        if (!cancelled) setFailed(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, rule.index, rule.problem, rule.revision]);
  return (
    <article className="rule-file">
      <div className="path mono">{rule.path}</div>
      {error ? <Empty title={`${rule.path} could not be shown`}>{error}</Empty> : text === null ? <p className="reader-msg">Loading…</p> : <Markdown text={text} path={rule.path} build={null} client={client} theme={theme} docs={[]} comments="show" />}
    </article>
  );
}
