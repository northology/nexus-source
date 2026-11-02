import { formatTime } from '../lib/time.ts';

/** The line above a build document, Markdown or not: its path, its time, and the gate waiting on it when there is one. */
export function PathLine({ path, modified, zone, gate }: { path: string; modified: string | null; zone: string; gate?: string | undefined }) {
  return (
    <div className="path mono">
      <span>{path}</span>
      <span className="path-end">
        {modified && <span data-volatile>{formatTime(modified, zone)}</span>}
        {gate && <a href={gate}>Review in gate ›</a>}
      </span>
    </div>
  );
}
