import { ALL_PHASES, type PhaseInfo } from '../lib/phases.ts';

/** Shown only when a build has more than one phase. Choosing the current phase drops the URL parameter. */
export function PhaseSelect({ info, selected, onSelect, all = true }: { info: PhaseInfo; selected: string | null; onSelect: (phase: string | null) => void; all?: boolean }) {
  if (info.names.length <= 1) return null;
  const value = selected ?? (all ? ALL_PHASES : (info.current ?? ALL_PHASES));
  return (
    <label className="phase-select">
      <span className="lbl">Phase</span>
      <select value={value} onChange={(e) => onSelect(e.target.value === info.current ? null : e.target.value)}>
        {info.names.map((n) => (
          <option key={n} value={n}>
            {n === info.current ? `${n} (current)` : n}
          </option>
        ))}
        {all && <option value={ALL_PHASES}>All phases</option>}
      </select>
    </label>
  );
}
