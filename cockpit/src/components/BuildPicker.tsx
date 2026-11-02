export function BuildPicker({ builds, onPick }: { builds: string[]; onPick: (build: string) => void }) {
  return (
    <div className="empty">
      <strong>This checkout has {builds.length} builds</strong>
      <p>
        Pick one to open. The agent passes <code>--build</code> to choose between them too.
      </p>
      <ul className="picker-list">
        {builds.map((b) => (
          <li key={b}>
            <button type="button" className="btn ghost" onClick={() => onPick(b)}>
              {b}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
