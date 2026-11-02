import { useEffect, useRef } from 'react';
import commands from '../../../reference/guide/commands.md?raw';
import flow from '../../../reference/guide/flow.md?raw';
import overview from '../../../reference/guide/overview.md?raw';
import views from '../../../reference/guide/views.md?raw';
import { Markdown } from '../components/Markdown.tsx';
import { Runner } from '../components/Runner.tsx';
import { GUIDE_PAGES, guidePage, keepBuildInLinks, type GuidePage } from '../lib/guidance.ts';
import { keepBuild } from '../lib/route.ts';
import type { ViewProps } from './types.ts';

// The generator's comment markers need no stripping: the reader hides HTML comments, as in any document.
const TEXT: Record<GuidePage, string> = { overview, flow, commands, views };

/** The guide for people using nexus, built into the cockpit. It reads no build, so it shows with or without one. */
export function GuidanceView({ route, navigate, client, theme }: Pick<ViewProps, 'route' | 'navigate' | 'client' | 'theme'>) {
  const page = guidePage(route.sub);
  const heading = route.params['h'] ?? null;
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    // A heading named in the address scrolls into view; a missing or unknown one shows the page from the top.
    const target = heading ? document.getElementById(heading) : null;
    if (!heading || !target) {
      document.getElementById('main')?.scrollTo({ top: 0 });
      return;
    }
    target.scrollIntoView({ block: 'start' });
    // Diagrams draw after this and change the page's height around the heading. Until the reader moves, the heading
    // is put back at the top whenever the page resizes; scroll anchoring alone doesn't always hold it.
    const body = article.current;
    if (!body) return;
    let held = true;
    const release = () => {
      held = false;
    };
    const moves = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const m of moves) window.addEventListener(m, release, { passive: true });
    const sizes = new ResizeObserver(() => {
      if (held) document.getElementById(heading)?.scrollIntoView({ block: 'start' });
    });
    sizes.observe(body);
    return () => {
      sizes.disconnect();
      for (const m of moves) window.removeEventListener(m, release);
    };
  }, [page, heading]);
  return (
    <>
      <Runner
        label="Guidance"
        tabs={GUIDE_PAGES.map((p) => ({ key: p.key, label: p.label, count: '' }))}
        current={page}
        onSelect={(k) => navigate({ category: 'guidance', sub: k, params: keepBuild(route) })}
      />
      <div className="view-body wide">
        <article className="reader guide" ref={article}>
          <Markdown text={keepBuildInLinks(TEXT[page], route.params['build'] ?? null)} path={`guide/${page}.md`} build="" client={client} theme={theme} docs={[]} />
        </article>
      </div>
    </>
  );
}
