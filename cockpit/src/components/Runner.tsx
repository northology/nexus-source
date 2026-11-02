export interface Tab {
  key: string;
  label: string;
  count: string;
  needs?: boolean;
}

/** The sub-menu along the top of a section; the active tab is underlined with a drawn rule. */
export function Runner({ label, tabs, current, onSelect }: { label: string; tabs: Tab[]; current: string; onSelect: (key: string) => void }) {
  return (
    <div className="runner" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === current} onClick={() => onSelect(t.key)}>
          {t.label} <span className={`c mono${t.needs ? ' needs' : ''}`}>{t.count}</span>
        </button>
      ))}
    </div>
  );
}
