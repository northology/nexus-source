import type { Inventory } from './governance/types.ts';
import type { ViewSummary } from './views/types.ts';
export type Stage = 'planning' | 'plan' | 'build' | 'close-out';
export interface GateRecord { opened: string; read: string | null }
export interface PhaseRecord { name: string; branch: string; started: string; finished: string | null }

export interface Build {
  name: string;
  stage: Stage;
  branch: string;
  summary: string;
  created: string;
  gates: Record<string, GateRecord>;
  phase?: string;
  phases?: PhaseRecord[];
}

export type LogName = 'decisions' | 'issues' | 'changes' | 'questions' | 'guardrails';
export type RaisedBy = 'user' | 'claude' | 'agent';
export interface LogEntry {
  phase?: string;
  name: string;
  text: string;
  status: string;
  source: string;
  time: string;
  quote?: string;
  note?: string;
  commit?: string;
  raisedBy?: RaisedBy;
  task?: string;
  /** The concept topic a live-mode refinement belongs to; Concepts › Chosen lists it. */
  topic?: string;
}
export interface LogFile { entries: LogEntry[] }

export type GateStep = 'guardrails' | 'scope' | 'spec' | 'plan' | 'finish' | 'decommission';
export type GateType = 'mark-list' | 'concept-pick' | 'approve' | 'review';
export interface GateItem {
  name: string;
  text: string;
  source?: string;
  quote?: string;
  conflicts?: string[];
  /** review only: the inventory id of the row's item. */
  item?: string;
  /** review only: the item's location, as the inventory lists it. */
  target?: string;
  /** guardrails gates only: accepting the row retires the accepted guardrail it names. */
  retire?: true;
}
export type ConceptSource = 'self' | 'impeccable' | 'superpowers';
export interface GateOption { name: string; label: string; page: string; source?: ConceptSource }
export interface GateRequest {
  phase?: string;
  step?: GateStep;
  name: string;
  type: GateType;
  title: string;
  why: string;
  opened: string;
  items?: GateItem[];
  options?: GateOption[];
  /** concept-pick only: gates sharing a topic are rounds of one question. */
  topic?: string;
  document?: string;
  log?: 'guardrails';
  /** Approve gates only; the server copies it into the answers file at submission. */
  permit?: StampedPermit;
}
export type Mark = 'accepted' | 'research' | 'declined';
export interface GateAnswers {
  gate: string;
  submitted: string;
  marks?: Record<string, Mark>;
  choice?: string;
  choices?: string[];
  none?: true;
  decision?: 'approve' | 'send-back';
  note?: string;
  notes?: Record<string, string>;
  /** Stamped by the server at submission; the only record of what the user saw. */
  log?: 'guardrails';
  texts?: Record<string, string>;
  permit?: StampedPermit;
  /** Stamped by the server on review answers: the files each row's mark may change. */
  targets?: Record<string, string[]>;
}
/** A repo-level review in .nexus/reviews/: its request, its answers once the user submits, when it opened and was applied. */
export interface ReviewState { request: GateRequest; answers: GateAnswers | null; opened: string; read: string | null }
export interface StampedPermit { target: string; change: string }

export interface PlanTask { id: string; number: number; title: string; steps: number }
export interface FixRound { round: number; addressed: number; open: number; findings: string | null; commits: string | null }
export interface TaskRecord { state: 'done' | 'incomplete'; commits: string | null; note?: string | null; parked: number; fixRounds: FixRound[] }
export interface PlanRecord { imported: string; ledger: string; tasks: Record<string, TaskRecord>; final: { rulings: number; minors: number } }
export interface PlanEntry {
  id: string;
  phase: string;
  gate: string;
  document: string;
  title: string;
  indexed: string;
  tasks: PlanTask[];
  record: PlanRecord | null;
}
export interface PlanFile { plans?: PlanEntry[] }
/** A planned phase in phases.json: the build's roadmap, numbered in the cockpit by its place. */
export interface PlannedPhase { name: string; description: string }
export interface PhasesFile { phases: PlannedPhase[] }
export type TaskState = 'pending' | 'in-progress' | 'fix-round' | 'done' | 'incomplete' | 'unknown';
export interface TaskProgress {
  state: TaskState;
  commits: string | null;
  /** The note on the task's completion line, such as its test command or review result. */
  note: string | null;
  /** From "complete (commits …, K parked)". */
  parked: number;
  fixRounds: FixRound[];
  parkedFindings: string[];
  rulings: string[];
  minors: string[];
}
export interface PlanProgress {
  source: 'ledger' | 'record' | 'none';
  /** When the ledger was last written, or when the record was kept. */
  read: string | null;
  ledger: string | null;
  tasks: Record<string, TaskProgress>;
  final: { rulings: string[]; minors: string[] };
}

export interface FileEntry { path: string; size: number; modified: string }
export interface Problem { file: string; message: string }
export interface GateView { name: string; request: GateRequest; answers: GateAnswers | null; read: string | null }
export type FileArea = 'documents' | 'notes' | 'files' | 'concepts';
/** `retired`: accepted once, then retired at a later gate's retire row. Derived, never stored. */
export type GuardrailState = 'proposed' | 'accepted' | 'declined' | 'withdrawn' | 'retired';
export interface GuardrailView { entry: LogEntry; state: GuardrailState; gate: string | null; decided: string | null }
/** `revision` changes whenever the file does (`<modified>-<size>`); null when it can't be read. */
export interface RuleFile { index: number; path: string; problem: string | null; revision: string | null }

export interface Snapshot {
  name: string;
  build: Build | null;
  logs: Record<LogName, LogEntry[]>;
  plan: PlanFile | null;
  /** The planned phases from phases.json, in order; null when the build has none or the file doesn't match its
   * schema. Two phases with one name keep the list and add a problem, which the Phases tab shows instead. */
  phases: PlannedPhase[] | null;
  /** Each plan entry's progress, keyed by plan ID: from the live ledger, the kept record, or none. */
  planProgress: Record<string, PlanProgress>;
  gates: GateView[];
  guardrails: GuardrailView[];
  rules: RuleFile[];
  files: Record<FileArea, FileEntry[]>;
  problems: Problem[];
}

/** What /api/repo answers: the inventory and the declared views. */
export interface RepoSnapshot { inventory: Inventory; views: ViewSummary[]; problems: string[] }
