import type { RailItem } from '../lib/rail.ts';
import { formatHash, keepBuild, type Route } from '../lib/route.ts';
import { zoneChoices } from '../lib/time.ts';

interface RailProps {
  items: RailItem[];
  route: Route;
  builds: string[];
  build: string;
  zone: string;
  onZone: (zone: string) => void;
  onBuild: (build: string) => void;
}

export function Rail({ items, route, builds, build, zone, onZone, onBuild }: RailProps) {
  return (
    <aside className="rail">
      {builds.length > 1 && (
        <label className="picker">
          <span>Build</span>
          <select value={build} onChange={(e) => onBuild(e.target.value)}>
            {builds.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      )}
      <nav aria-label="Sections">
        {items.map((item) => (
          <a
            key={`${item.category}/${item.sub ?? ''}`}
            href={formatHash({ category: item.category, sub: item.sub ?? null, params: keepBuild(route) })}
            aria-current={route.category === item.category && (item.sub === undefined || item.sub === (route.sub ?? 'overview')) ? 'page' : undefined}
          >
            <span className="lab">{item.label}</span>
            <span className={`cnt mono${item.needs ? ' needs' : ''}`}>{item.count}</span>
            {item.needs && <span className="visually-hidden"> (needs you)</span>}
            <span className="extent" aria-hidden="true">
              {item.cells.map((c, i) => (
                <i key={i} className={c} />
              ))}
            </span>
          </a>
        ))}
      </nav>
      <div className="foot">
        <label className="zone">
          <span>Times in</span>
          <select value={zone} onChange={(e) => onZone(e.target.value)}>
            {zoneChoices(zone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  );
}
