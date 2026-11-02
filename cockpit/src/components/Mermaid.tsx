import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { moveTitles } from '../lib/mermaid-titles.ts';
import type { Theme } from '../lib/prefs.ts';

let counter = 0;

/** The body type size in whole pixels; it grows with the window above 1920px, so diagrams redraw to match. */
function bodyPx(): number {
  return Math.round(parseFloat(getComputedStyle(document.body).fontSize)) || 14;
}

function useBodyPx(): number {
  const [px, setPx] = useState(bodyPx);
  useEffect(() => {
    const onResize = () => setPx(bodyPx());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return px;
}

type DiagramState = { kind: 'drawing' } | { kind: 'drawn'; svg: string } | { kind: 'failed'; message: string };

/** Draws a Mermaid diagram in the cockpit's palette. Mermaid is loaded only when a document has a diagram. */
export function Mermaid({ code, theme }: { code: string; theme: Theme }) {
  const [state, setState] = useState<DiagramState>({ kind: 'drawing' });
  const px = useBodyPx();
  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++counter}`;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        // Read the theme's colours now, after the theme attribute on <html> has been applied.
        const css = getComputedStyle(document.documentElement);
        const v = (name: string) => css.getPropertyValue(name).trim();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily: '"Schibsted Grotesk", system-ui, sans-serif',
          themeVariables: {
            background: v('--sheet'),
            primaryColor: v('--sheet'),
            primaryTextColor: v('--ink'),
            primaryBorderColor: v('--g2'),
            secondaryColor: v('--ground'),
            tertiaryColor: v('--ground'),
            lineColor: v('--g1'),
            textColor: v('--ink'),
            fontSize: `${px}px`,
          },
        });
        try {
          const { svg } = await mermaid.render(id, code);
          if (!cancelled) setState({ kind: 'drawn', svg });
        } catch (e) {
          document.getElementById(`d${id}`)?.remove();
          if (!cancelled) setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme, px]);

  if (state.kind === 'drawing') {
    return (
      <div className="md-mermaid" aria-busy="true">
        Drawing diagram…
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className="md-mermaid-error" role="note">
        <strong>This diagram could not be drawn.</strong>
        <pre>{state.message}</pre>
        <pre>{code}</pre>
      </div>
    );
  }
  return <Drawn svg={state.svg} />;
}

function Drawn({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const drawn = ref.current?.querySelector('svg');
    if (drawn) moveTitles(drawn);
  }, [svg]);
  return <div className="md-mermaid" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />;
}
