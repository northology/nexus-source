import type { Build, Stage } from '../../../core/types.ts';
import { phaseInfo, phaseLabel } from '../lib/phases.ts';
import type { Theme } from '../lib/prefs.ts';

const STAGES: { key: Stage; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'plan', label: 'Plan' },
  { key: 'build', label: 'Build' },
  { key: 'close-out', label: 'Close-out' },
];

const REPO_SUBTITLE = "the repo's standing record · opens with or without a build";

export type Mode = 'build' | 'repo';

interface TopBarProps {
  build: Build | null;
  mode: Mode;
  onMode: (m: Mode) => void;
  repoTitle: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
}

export function TopBar({ build, mode, onMode, repoTitle, theme, onTheme }: TopBarProps) {
  const current = build ? STAGES.findIndex((s) => s.key === build.stage) : -1;
  const reach = (current + 1) * 100;
  const phase = build ? phaseLabel(phaseInfo(build), build.name) : null;
  return (
    <header className="top">
      <div className="brand">
        <b>nexus</b>
      </div>
      <div className="build">
        {mode === 'repo' && (
          <div className="build-name">
            <strong>{repoTitle}</strong>
            <span className="mono" title={REPO_SUBTITLE}>{REPO_SUBTITLE}</span>
          </div>
        )}
        {mode === 'build' && build && (
          <>
            <div className="build-name">
              <strong>{build.name}</strong>
              <span className="mono" title={`${build.branch}${phase ? ` · ${phase}` : ''}`}>
                {build.branch}
                {phase ? ` · ${phase}` : ''}
              </span>
            </div>
            <div className="stages">
              <svg className="track" viewBox="0 0 400 2" preserveAspectRatio="none" aria-hidden="true">
                <line className="track-done" x1="0" y1="1" x2={reach} y2="1" />
                <line className="track-todo" x1={reach} y1="1" x2="400" y2="1" />
              </svg>
              <ol aria-label="Stage">
                {STAGES.map((s, i) => (
                  <li key={s.key} className={`stage${i < current ? ' done' : ''}${i === current ? ' now' : ''}`} aria-current={i === current ? 'step' : undefined}>
                    <i className="tick" aria-hidden="true" />
                    <span className="n mono">{i + 1}</span>
                    <span className="l">{s.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
      <div className="mode" role="group" aria-label="Mode">
        {(['build', 'repo'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>
            {m === 'build' ? 'Build' : 'Repo'}
          </button>
        ))}
      </div>
      <div className="theme" role="group" aria-label="Theme">
        {(['light', 'dark'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={theme === t} onClick={() => onTheme(t)}>
            {t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </header>
  );
}
