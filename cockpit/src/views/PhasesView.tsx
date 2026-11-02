import { Empty } from '../components/Empty.tsx';
import type { ViewProps } from './types.ts';

/** Spec 2026-10-14-phases-tab-design.md: the build's planned phases from phases.json, numbered by their place. */
export function PhasesView({ snapshot }: ViewProps) {
  const problem = snapshot.problems.find((p) => p.file === 'phases.json');
  // A file that read but names a phase twice keeps its list, with the problem above it.
  const unread = problem && snapshot.phases === null ? problem : null;
  const phases = snapshot.phases ?? [];
  return (
    <section className="view" aria-labelledby="phases-title">
      <header className="head plain">
        <div>
          <h1 id="phases-title">Phases</h1>
          <p>The phases this build plans to run, in order. The agent keeps the list in phases.json as they change.</p>
        </div>
      </header>
      {problem && !unread && (
        <p className="reader-msg" role="note">
          phases.json: {problem.message}. Give each phase its own name.
        </p>
      )}
      {unread ? (
        <Empty title="phases.json could not be read">{unread.message}. The other sections still show.</Empty>
      ) : phases.length === 0 ? (
        <Empty title="No phases planned yet">
          When ideation lays out more than one phase, the agent lists them in .build/{snapshot.name}/phases.json, and
          keeps the list current as phases are added, split, reordered or dropped.
        </Empty>
      ) : (
        <div className="vtable-wrap">
          <table className="vtable phases-table">
            <thead>
              <tr>
                <th scope="col" className="num">Phase</th>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p, i) => (
                <tr key={`${i}-${p.name}`}>
                  <td className="num mono">{i + 1}</td>
                  <td className="mono">{p.name}</td>
                  <td>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
