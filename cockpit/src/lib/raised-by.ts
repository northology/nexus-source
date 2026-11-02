import type { RaisedBy } from '../../../core/types.ts';

/** Who raised a guardrail, as the cockpit says it: the stored values stay `user`, `claude` and `agent`. */
const LABELS: Record<RaisedBy, string> = { user: 'you', claude: 'the agent', agent: 'a helper agent' };

export function raisedByLabel(v: RaisedBy | undefined): string {
  return v ? LABELS[v] : 'unknown';
}
