import { useState } from 'react';

/** Copies the full URL, so the same view opens elsewhere (and links the agent gives land on the same place). */
export function CopyView() {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('manual');
    }
  }
  return (
    <span className="copy">
      <button type="button" className="btn ghost small" onClick={() => void copy()}>
        {state === 'copied' ? 'Copied' : 'Copy this view'}
      </button>
      {state === 'manual' && (
        <input className="copy-manual mono" readOnly value={window.location.href} aria-label="Link to this view" autoFocus onFocus={(e) => e.currentTarget.select()} />
      )}
    </span>
  );
}
