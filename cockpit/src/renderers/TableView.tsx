import { useMemo, useState } from 'react';
import type { TableData } from '../../../core/views/types.ts';
import type { ViewDef } from '../../../core/vault/types.ts';
import { columnIndex, filterRows, formatCell, nthOf, pickColumns, RENDER_CAP, sortRows, type ColumnSort } from '../lib/table.ts';

/**
 * A declared table: its columns, sorted as declared until a header is clicked, searchable over the cells shown. The sort
 * is held by column name, so a reread that adds or drops a column keeps it on its column, and a changed sort in the
 * view's note replaces the one chosen here. At most RENDER_CAP rows are drawn.
 */
export function TableView({ data, options }: { data: TableData; options?: ViewDef['table'] | undefined }) {
  const wanted = options?.columns;
  const pick = useMemo(() => pickColumns(data, wanted), [data, wanted]);
  const declared: ColumnSort | null = options?.sort ? { column: options.sort.column, nth: 0, dir: options.sort.dir ?? 'asc' } : null;
  const declaredKey = declared ? `${declared.column}\n${declared.dir}` : '';
  const [seen, setSeen] = useState(declaredKey);
  const [chosen, setChosen] = useState<ColumnSort | null>(null);
  if (seen !== declaredKey) {
    // The note's sort changed on a reread: it replaces the one chosen here.
    setSeen(declaredKey);
    setChosen(null);
  }
  // A chosen sort whose column a reread dropped gives way to the declared sort, and is named.
  const chosenGone = chosen !== null && columnIndex(data.columns, chosen.column, chosen.nth) < 0;
  const sort = chosen && !chosenGone ? chosen : declared;
  const sortIndex = sort ? columnIndex(data.columns, sort.column, sort.nth) : -1;
  const dir = sort?.dir ?? 'asc';
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const filtered = filterRows(data.rows, q, pick.indexes);
    return sortIndex >= 0 ? sortRows(filtered, sortIndex, dir) : filtered;
  }, [data.rows, q, pick.indexes, sortIndex, dir]);
  const shown = rows.length > RENDER_CAP ? rows.slice(0, RENDER_CAP) : rows;
  const numeric = new Set(data.numeric);
  const onSort = (index: number) => {
    const column = data.columns[index] ?? '';
    setChosen(sortIndex === index ? { column, nth: nthOf(data.columns, index), dir: dir === 'asc' ? 'desc' : 'asc' } : { column, nth: nthOf(data.columns, index), dir: 'asc' });
  };
  let sortNote: string | null = null;
  if (declared && sort === declared) {
    if (sortIndex < 0) sortNote = `Not sorted by ${declared.column}: the data has no such column.`;
    else if (!pick.indexes.includes(sortIndex)) sortNote = `Sorted by ${declared.column}, which this view doesn’t show.`;
  }
  return (
    <div className="table-view">
      <div className="viewbar">
        <input className="search" type="search" aria-label="Search this table" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="matches mono" aria-live="polite">
          {rows.length.toLocaleString()} of {data.total.toLocaleString()}
        </span>
      </div>
      {pick.missing.length > 0 && <p className="view-note">Not in the data: {pick.missing.join(', ')}</p>}
      {chosen && chosenGone && <p className="view-note">Not sorted by {chosen.column}: it’s no longer in the data.</p>}
      {sortNote && <p className="view-note">{sortNote}</p>}
      <div className="vtable-wrap">
        <table className="vtable">
          <thead>
            <tr>
              {pick.columns.map((c, i) => {
                const index = pick.indexes[i] ?? 0;
                const d = sortIndex === index ? dir : null;
                return (
                  <th key={i} className={numeric.has(c) ? 'num' : undefined} aria-sort={d === 'asc' ? 'ascending' : d === 'desc' ? 'descending' : 'none'}>
                    <button type="button" onClick={() => onSort(index)}>
                      {c} <span aria-hidden="true">{d === 'asc' ? '↑' : d === 'desc' ? '↓' : ''}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, n) => (
              <tr key={n}>
                {pick.indexes.map((index, i) => (
                  <td key={i} className={numeric.has(pick.columns[i] ?? '') ? 'num' : undefined}>
                    {formatCell(r[index] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length && (
        <p className="view-note">
          Showing the first {RENDER_CAP.toLocaleString()} of {rows.length.toLocaleString()} rows. Search or sort to reach the rest.
        </p>
      )}
      {data.total > data.rows.length && (
        <p className="view-note">
          First {data.rows.length.toLocaleString()} of {data.total.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}
