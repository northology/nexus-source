import type { Round, Topic } from '../../../core/concept-text.ts';
import type { FileEntry, GateView, LogEntry, LogName, Snapshot } from '../../../core/types.ts';
import { inPhase } from './phases.ts';

export const CONCEPT_TABS = ['proposed', 'chosen'] as const;
export type ConceptTab = (typeof CONCEPT_TABS)[number];

/** The Concepts sub-page; anything else opens Proposed. */
export function conceptTab(sub: string | null): ConceptTab {
  return sub === 'chosen' ? 'chosen' : 'proposed';
}

/** Topics with a round in the phase. An open round needs the user whatever the phase, so its topic always shows. */
export function topicsInPhase(topics: Topic[], phase: string | null): Topic[] {
  return topics.filter((t) => t.rounds.some((r) => r.outcome.kind === 'open' || inPhase(r.gate.request.phase, phase)));
}

/** The topic's rounds in the phase, keeping their numbers in the whole topic. */
export function roundsInPhase(topic: Topic, phase: string | null): Round[] {
  return topic.rounds.filter((r) => inPhase(r.gate.request.phase, phase));
}

/** Topics with at least one answered round, in `topicsOf` order (most recently answered first). */
export function chosenTopics(topics: Topic[]): Topic[] {
  return topics.filter((t) => t.rounds.some((r) => r.outcome.kind !== 'open'));
}

/** Concept pages that no gate's options name. */
export function unusedPages(pages: FileEntry[], gates: GateView[]): FileEntry[] {
  const used = new Set(gates.flatMap((g) => (g.request.options ?? []).map((o) => o.page)));
  return pages.filter((f) => /\.html$/i.test(f.path) && !used.has(f.path));
}

/**
 * The topics Chosen lists under the phase: answered topics with rounds there or refinements there, so a concept
 * chosen in one phase and refined in a later one shows under both.
 */
export function chosenInPhase(topics: Topic[], logs: Snapshot['logs'], phase: string | null): Topic[] {
  return chosenTopics(topics).filter((t) => roundsInPhase(t, phase).length > 0 || refinementsOf(logs, t.name, phase).length > 0);
}

export interface Refinement { log: LogName; entry: LogEntry }

/** Log entries tagged with the topic (live-mode refinements), oldest first, in the phase. */
export function refinementsOf(logs: Snapshot['logs'], topic: string, phase: string | null): Refinement[] {
  return (Object.entries(logs) as [LogName, LogEntry[]][])
    .flatMap(([log, entries]) => entries.filter((e) => e.topic === topic && inPhase(e.phase, phase)).map((entry) => ({ log, entry })))
    // By the moment, not the text: entries written with different offsets still read oldest first.
    .sort((a, b) => Date.parse(a.entry.time) - Date.parse(b.entry.time));
}
