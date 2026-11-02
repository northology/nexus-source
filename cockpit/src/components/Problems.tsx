import type { Problem } from '../../../core/types.ts';

export function Problems({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null;
  return (
    <section className="problems" aria-label="Files that need fixing">
      <h2>{problems.length === 1 ? 'One file needs fixing' : `${problems.length} files need fixing`}</h2>
      <p>
        Everything else still shows. Ask the agent to run <code>nexus check</code> and fix these.
      </p>
      <ul>
        {problems.map((p) => (
          <li key={`${p.file}:${p.message}`}>
            <code>{p.file}</code> {p.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
