import { describe, it, expect } from 'vitest';
import type { GateRequest, GateView, GuardrailView } from '../../core/types.ts';
import { readSnapshot } from '../../core/snapshot.ts';
import { submitAnswers } from '../../core/gates.ts';
import { awaiting, gateState, orderGates, displayRows, GATE_TABS, gateTab, isGateTab, tabCount, tabGates, visibleTabs } from '../../cockpit/src/lib/gates.ts';
import { raisedByLabel } from '../../cockpit/src/lib/raised-by.ts';
import { exampleRepo, NOW } from '../helpers.ts';

describe('gate state', () => {
  it('reads open, applied and answered', () => {
    const root = exampleRepo();
    submitAnswers(root, 'relay-rebuild', 'look', { choice: 'quiet-board' }, NOW);
    const byName = Object.fromEntries(readSnapshot(root, 'relay-rebuild').gates.map((g) => [g.name, gateState(g)]));
    expect(byName).toEqual({ look: 'answered', scope: 'applied', 'spec-review': 'open' });
  });
  it('orders open gates first, newest first', () => {
    const gates = orderGates(readSnapshot(exampleRepo(), 'relay-rebuild').gates);
    expect(gates.map((g) => g.name)).toEqual(['spec-review', 'look', 'scope']);
  });
  it('counts what still needs the user', () => {
    const gates = readSnapshot(exampleRepo(), 'relay-rebuild').gates;
    const scope = gates.find((g) => g.name === 'scope')?.request;
    const look = gates.find((g) => g.name === 'look')?.request;
    const review = gates.find((g) => g.name === 'spec-review')?.request;
    if (!scope || !look || !review) throw new Error('example gates missing');
    expect(awaiting(scope, {})).toBe(3);
    expect(awaiting(scope, { 'replay-window': 'accepted', 'alerting-channel': 'research' })).toBe(1);
    expect(awaiting(look, {})).toBe(1);
    expect(awaiting(review, {})).toBe(1);
  });
});

const req = (fields: Partial<GateRequest>): GateRequest => ({ name: 'g', type: 'approve', title: 't', why: 'w', opened: NOW, ...fields });
const view = (fields: Partial<GateRequest>, answered = false): GateView => ({
  name: fields.name ?? 'g',
  request: req(fields),
  answers: answered ? { gate: fields.name ?? 'g', submitted: NOW, decision: 'approve' } : null,
  read: answered ? NOW : null,
});

describe('gate tabs', () => {
  it('files a gate by its step, else by what it carries, never by its name', () => {
    expect(gateTab(req({ step: 'spec', document: 'documents/specs/x.md' }))).toBe('spec');
    expect(gateTab(req({ name: 'finish-replay' }))).toBe('other');
    expect(gateTab(req({ permit: { target: 'CLAUDE.md', change: 'x' } }))).toBe('permits');
    expect(gateTab(req({ type: 'mark-list', log: 'guardrails', items: [{ name: 'a', text: 'a' }] }))).toBe('guardrails');
    expect(gateTab(req({ name: 'scope' }))).toBe('other');
    expect(gateTab(req({ step: 'decommission', type: 'mark-list', document: 'decommission/files/docs/x.md' }))).toBe('decommission');
    expect(isGateTab('finish')).toBe(true);
    expect(isGateTab('scope-replay')).toBe(false);
    expect(isGateTab(undefined)).toBe(false);
  });
  it('lists a tab for the selected phase; gates from before phases show in every phase', () => {
    const gates = [
      view({ name: 'scope-replay', step: 'scope', type: 'mark-list', phase: 'replay', opened: '2026-10-02T19:00:00Z' }, true),
      view({ name: 'scope-dashboard', step: 'scope', type: 'mark-list', phase: 'dashboard', opened: '2026-10-02T20:00:00Z' }),
      view({ name: 'old-scope', step: 'scope', type: 'mark-list', opened: '2026-10-02T18:00:00Z' }, true),
    ];
    expect(tabGates(gates, 'scope', 'dashboard', null).map((g) => g.name)).toEqual(['scope-dashboard', 'old-scope']);
    expect(tabGates(gates, 'scope', null, null).map((g) => g.name)).toEqual(['scope-dashboard', 'scope-replay', 'old-scope']);
    expect(tabGates(gates, 'finish', null, null)).toEqual([]);
  });
  it('keeps the gate on screen in its list whatever the filter', () => {
    const replay = view({ name: 'scope-replay', step: 'scope', type: 'mark-list', phase: 'replay' });
    expect(tabGates([replay], 'scope', 'dashboard', replay).map((g) => g.name)).toEqual(['scope-replay']);
  });
  it('keeps the gate on screen by name, so a gate rebuilt from a fresh snapshot is still listed', () => {
    const replay = view({ name: 'scope-replay', step: 'scope', type: 'mark-list', phase: 'replay' });
    expect(tabGates([replay], 'scope', 'dashboard', { ...replay }).map((g) => g.name)).toEqual(['scope-replay']);
  });
  it('lists an open gate from another phase under a phase filter, as needs-you is never filtered', () => {
    const gates = [
      view({ name: 'plan-replay', step: 'plan', type: 'approve', phase: 'replay' }),
      view({ name: 'old-plan', step: 'plan', type: 'approve', phase: 'replay' }, true),
    ];
    expect(tabGates(gates, 'plan', 'dashboard', null).map((g) => g.name)).toEqual(['plan-replay']);
  });
});

describe('the decommission tab', () => {
  const request: GateRequest = {
    name: 'decommission-relay-rebuild',
    type: 'mark-list',
    step: 'decommission',
    title: 'Decommission relay-rebuild',
    why: 'Mark what becomes governance.',
    opened: NOW,
    document: 'decommission/files/docs/superpowers/archive/relay-rebuild/relay-rebuild final report.md',
    items: [{ name: 'replay-cap-rule', text: 'Rule: replays are capped' }],
  };
  const gate = { name: request.name, request, answers: null, read: null } as unknown as GateView;
  it('files a decommission gate under Decommission, after Finish', () => {
    expect(gateTab(request)).toBe('decommission');
    expect(GATE_TABS.indexOf('decommission')).toBe(GATE_TABS.indexOf('finish') + 1);
  });
  it('shows the tab only while the build has a decommission gate', () => {
    expect(visibleTabs([gate])).toEqual(['guardrails', 'scope', 'spec', 'plan', 'finish', 'decommission', 'permits', 'other']);
    const others = readSnapshot(exampleRepo(), 'relay-rebuild').gates;
    expect(visibleTabs(others)).toEqual(['guardrails', 'scope', 'spec', 'plan', 'finish', 'permits', 'other']);
    expect(visibleTabs([])).not.toContain('decommission');
  });
});

describe('gate tab counts', () => {
  it('counts what the tab lists: its gates for the selected phase, plus its open gates from any phase', () => {
    const gates = [
      view({ name: 'plan-replay', step: 'plan', type: 'mark-list', phase: 'replay' }),
      view({ name: 'scope-replay', step: 'scope', type: 'mark-list', phase: 'replay' }, true),
      view({ name: 'scope-dashboard', step: 'scope', type: 'mark-list', phase: 'dashboard' }),
    ];
    expect(tabCount(gates, 'plan', 'dashboard')).toBe(1);
    expect(tabCount(gates, 'scope', 'dashboard')).toBe(1);
    expect(tabCount(gates, 'scope', 'replay')).toBe(2);
    expect(tabCount(gates, 'scope', null)).toBe(2);
    expect(tabCount(gates, 'finish', 'dashboard')).toBe(0);
  });
});

describe('guardrail rows', () => {
  const guardrails: GuardrailView[] = [
    { entry: { name: 'replay-read-only', text: 'Replay never writes', status: 'proposed', source: 'chat 11:12', raisedBy: 'user', quote: 'Never touch the sources.', time: NOW }, state: 'proposed', gate: null, decided: null },
  ];
  it('shows who raised each guardrail and where from, from the guardrail log', () => {
    const rows = displayRows(req({ type: 'mark-list', log: 'guardrails', items: [{ name: 'replay-read-only', text: 'Replay never writes', source: 'written by Claude' }, { name: 'gone', text: 'Gone' }] }), guardrails);
    expect(rows).toEqual([
      { name: 'replay-read-only', text: 'Replay never writes', source: 'you · chat 11:12', quote: 'Never touch the sources.' },
      { name: 'gone', text: 'Gone', source: 'not in the guardrail log' },
    ]);
  });
  it('gives a row no quote key when the guardrail was logged without one', () => {
    const bare: GuardrailView[] = [{ entry: { name: 'no-quote', text: 'No quote', status: 'proposed', source: 'chat 09:00', raisedBy: 'user', time: NOW }, state: 'proposed', gate: null, decided: null }];
    const [row] = displayRows(req({ type: 'mark-list', log: 'guardrails', items: [{ name: 'no-quote', text: 'No quote' }] }), bare);
    expect(row).toEqual({ name: 'no-quote', text: 'No quote', source: 'you · chat 09:00' });
    expect(row).not.toHaveProperty('quote');
  });
  it('labels who raised each guardrail', () => {
    expect(raisedByLabel('user')).toBe('you');
    expect(raisedByLabel('claude')).toBe('the agent');
    expect(raisedByLabel('agent')).toBe('a helper agent');
    expect(raisedByLabel(undefined)).toBe('unknown');
  });
  it('shows a guardrail the agent raised as the agent, never Claude', () => {
    const byAgent: GuardrailView[] = [{ entry: { name: 'by-agent', text: 'By agent', status: 'proposed', source: 'handoff note', raisedBy: 'claude', time: NOW }, state: 'proposed', gate: null, decided: null }];
    const [row] = displayRows(req({ type: 'mark-list', log: 'guardrails', items: [{ name: 'by-agent', text: 'By agent' }] }), byAgent);
    expect(row?.source).toBe('the agent · handoff note');
  });
  it('reads a guardrail with no raiser as unknown', () => {
    const anon: GuardrailView[] = [{ entry: { name: 'anon', text: 'Anon', status: 'proposed', source: 'chat 09:05', time: NOW }, state: 'proposed', gate: null, decided: null }];
    const [row] = displayRows(req({ type: 'mark-list', log: 'guardrails', items: [{ name: 'anon', text: 'Anon' }] }), anon);
    expect(row?.source).toBe('unknown · chat 09:05');
  });
  it('leaves other gates as written', () => {
    const items = [{ name: 'a', text: 'A', source: 'chat 10:00' }];
    expect(displayRows(req({ type: 'mark-list', items }), guardrails)).toEqual(items);
  });
});
