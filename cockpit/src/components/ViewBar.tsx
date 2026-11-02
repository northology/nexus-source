import type { ReactNode } from 'react';
import type { MarkKind } from '../lib/marks.ts';
import { CopyView } from './CopyView.tsx';
import { Mark } from './Mark.tsx';

export interface Toggle {
  key: string;
  label: string;
  count: number;
  mark: MarkKind;
  on: boolean;
}

interface ViewBarProps {
  toggles: Toggle[];
  onToggle: (key: string) => void;
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  shown: number;
  total: number;
  before?: ReactNode;
}

/** Under the sub-menu: status toggles, search, a match count and "copy this view". */
export function ViewBar({ toggles, onToggle, search, onSearch, searchLabel, shown, total, before }: ViewBarProps) {
  return (
    <div className="viewbar">
      {before}
      <div className="toggles" role="group" aria-label="Show statuses">
        <span className="lbl">Show</span>
        {toggles.map((t) => (
          <button key={t.key} type="button" className="tg" aria-pressed={t.on} onClick={() => onToggle(t.key)}>
            <Mark kind={t.mark} />
            {t.label} <span className="mono">{t.count}</span>
          </button>
        ))}
      </div>
      <input className="search" type="search" placeholder={searchLabel} aria-label={searchLabel} value={search} onChange={(e) => onSearch(e.target.value)} />
      <span className="matches mono" aria-live="polite">
        {shown} of {total}
      </span>
      <CopyView />
    </div>
  );
}
