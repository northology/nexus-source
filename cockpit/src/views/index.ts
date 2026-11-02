import type { ComponentType } from 'react';
import type { Category } from '../lib/route.ts';
import { ConceptsView } from './ConceptsView.tsx';
import { DocumentsView } from './DocumentsView.tsx';
import { GateView } from './GateView.tsx';
import { GuidanceView } from './GuidanceView.tsx';
import { LogsView } from './LogsView.tsx';
import { PhasesView } from './PhasesView.tsx';
import { PlanView } from './PlanView.tsx';
import type { ViewProps } from './types.ts';

/** The build side's views. Repo mode renders RepoView from App, before VIEWS is consulted. */
export const VIEWS: Record<Exclude<Category, 'repo'>, ComponentType<ViewProps>> = {
  gate: GateView,
  plan: PlanView,
  phases: PhasesView,
  logs: LogsView,
  concepts: ConceptsView,
  documents: DocumentsView,
  guidance: GuidanceView,
};
