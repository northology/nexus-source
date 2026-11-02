import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { outcomeText, roundOf } from '../../../core/concept-text.ts';
import type { GateView as Gate, GateOption } from '../../../core/types.ts';
import type { AnswerBody, Client } from '../api/client.ts';
import { ConceptFrame } from './ConceptFrame.tsx';

interface ConceptRoundProps {
  build: string;
  /** The round's gate, with the answers to show: the recorded ones, or the ones just sent. */
  gate: Gate;
  /** Paths of the concept pages the build holds; an option whose page is missing says so. */
  pages: ReadonlySet<string>;
  client: Client;
  readOnly: boolean;
  sending: boolean;
  onSubmit: (body: AnswerBody) => void;
}

/**
 * A concept page scaled down from a 1280x800 frame: a live, sandboxed preview that takes no focus, clicks or reading.
 * It sits beside its option's button, never inside it; the button lies over it, transparent.
 */
export function ConceptThumb({ build, page, pages, client }: { build: string; page: string; pages: ReadonlySet<string>; client: Client }) {
  return (
    <span className="cthumb-box" aria-hidden="true" inert>
      {pages.has(page) ? (
        <ConceptFrame src={client.fileUrl(build, page)} className="cthumb" thumb />
      ) : (
        <span className="cthumb-missing">Page missing</span>
      )}
    </span>
  );
}

/** The shortest frame a cap may leave. With less room than this the round can't fit anyway, so the frame isn't capped. */
const MIN_FRAME = 360;
/** Room kept between the large frame and the window's bottom edge. */
const FOLD_MARGIN = 24;

/**
 * Caps the large frame so the whole round fits the window: sets `--cframe-avail` on the round to the height left below
 * the frame's top (its bar's bottom edge), measured with the main field scrolled to its top. The stylesheet keeps 16:10
 * inside that height. Where that leaves under MIN_FRAME the cap is dropped and the frame keeps its full width. Measured
 * again when the window resizes or the view holding the round changes size (an outcome or alert appearing above it).
 */
function useFrameFit(round: RefObject<HTMLDivElement | null>, bar: RefObject<HTMLDivElement | null>, full: boolean) {
  useLayoutEffect(() => {
    const r = round.current;
    const b = bar.current;
    if (full || !r || !b) return;
    const main = b.closest('main');
    const fit = () => {
      const room = window.innerHeight - (b.getBoundingClientRect().bottom + (main?.scrollTop ?? 0)) - FOLD_MARGIN;
      if (room >= MIN_FRAME) r.style.setProperty('--cframe-avail', `${room}px`);
      else r.style.removeProperty('--cframe-avail');
    };
    fit();
    // The fit itself resizes the view, so the observer's fit waits a frame rather than loop inside one.
    let next = 0;
    const later = () => {
      cancelAnimationFrame(next);
      next = requestAnimationFrame(fit);
    };
    const sizes = new ResizeObserver(later);
    // Everything in main above the round moves it: the view, and the offline banner or problems notice, which come and
    // go beside it. Each child is watched for size, and main for children arriving or leaving.
    const watchChildren = () => {
      for (const child of Array.from(main?.children ?? [r])) sizes.observe(child);
    };
    watchChildren();
    const children = main
      ? new MutationObserver(() => {
          watchChildren();
          later();
        })
      : null;
    if (main) children?.observe(main, { childList: true });
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(next);
      sizes.disconnect();
      children?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [round, bar, full]);
}

/** A concept page large, in its sandboxed frame, or a note where the build lacks the page. */
function LargeFrame({ build, option, pages, client }: { build: string; option: GateOption; pages: ReadonlySet<string>; client: Client }) {
  return pages.has(option.page) ? (
    <ConceptFrame className="cframe" title={option.label} src={client.fileUrl(build, option.page)} />
  ) : (
    <div className="cframe-missing">Page missing: {option.page}</div>
  );
}

/** How two options are compared: side by side, or one page over the other with a slider moving the edge. */
type CompareMode = 'side' | 'swipe';

/**
 * One concept round, one option at a time: a strip of thumbnails, the selected page large in a sandboxed frame, and
 * the answer panel beside it (pick this, combine some, or none of these with a note). With exactly two options ticked
 * the two can be compared, side by side or by swipe; the answer panel then sits below them.
 */
export function ConceptRound({ build, gate, pages, client, readOnly, sending, onSubmit }: ConceptRoundProps) {
  const options = gate.request.options ?? [];
  // An answered round opens on its first kept option.
  const [sel, setSel] = useState(() => Math.max(0, options.findIndex((o) => roundOf(gate, 1).kept.includes(o.name))));
  const [full, setFull] = useState(false);
  // The ticked options: the ones to combine, or on an answered round the ones to compare.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [compare, setCompare] = useState<CompareMode | null>(null);
  // How much of the upper page a swipe shows, in percent from its left edge.
  const [reveal, setReveal] = useState(50);
  const [note, setNote] = useState('');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const roundRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  const firstMode = useRef<HTMLButtonElement>(null);
  useFrameFit(roundRef, barRef, full);

  // The ticked options in option order; compared only while exactly two are ticked.
  const pair = options.filter((o) => ticked.has(o.name));
  const [left, right] = pair;
  const compared = compare !== null && pair.length === 2 && left && right ? ([left, right] as const) : null;
  const comparing = compared !== null;

  // Esc can't be caught once focus is inside the page, so full view starts on Back.
  useEffect(() => {
    if (full) toggle.current?.focus();
  }, [full]);

  // The control that starts or ends compare goes when used; focus moves to its counterpart rather than the page. When
  // compare ends because a pair's tick box was cleared, there's no Compare button to land on, so the option shown takes it.
  const wasComparing = useRef(comparing);
  useEffect(() => {
    // Only when compare starts or ends: on first render nothing moves focus.
    if (wasComparing.current === comparing) return;
    wasComparing.current = comparing;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!lost) return;
    const target = comparing ? firstMode.current : (compareButton.current ?? buttons.current[sel] ?? null);
    target?.focus();
  }, [comparing, sel]);

  // Esc leaves full view first, then compare.
  useEffect(() => {
    if (!full && !comparing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (full) setFull(false);
      else setCompare(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, comparing]);

  // The option list can change under a mounted round (a reloaded snapshot); keep the selection inside it.
  const at = Math.min(sel, Math.max(0, options.length - 1));
  const current = options[at];
  if (!current) return null;

  const round = roundOf(gate, 1);
  const decided = round.outcome.kind !== 'open';
  const text = note.trim();
  const noted = text ? { note: text } : {};
  const picks = pair.map((o) => o.name);

  const go = (i: number) => {
    const next = Math.max(0, Math.min(options.length - 1, i));
    setSel(next);
    buttons.current[next]?.focus();
  };
  const setTick = (name: string, on: boolean) => {
    // Any change to the ticks ends compare, so it never resumes on a pair the user didn't just choose. Clearing a tick
    // shows that option, so focus has a place to land when the pair it sat in goes.
    setCompare(null);
    if (!on && compared) {
      const i = options.findIndex((o) => o.name === name);
      if (i >= 0) setSel(i);
    }
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  };
  const large = (option: GateOption) => <LargeFrame build={build} option={option} pages={pages} client={client} />;
  // The tick box for one option: Combine when the round can be answered, Compare once it is. Beside a compared page
  // its name also carries the option's label, so a screen reader knows which of the two it ticks.
  const tickBox = (option: GateOption, className: string, named: boolean) => (
    <label className={className}>
      <input type="checkbox" checked={ticked.has(option.name)} disabled={sending} onChange={(e) => setTick(option.name, e.target.checked)} />
      {readOnly ? 'Compare' : 'Combine'}
      {named && <span className="visually-hidden"> {option.label}</span>}
    </label>
  );

  return (
    <div className="cround" data-full={full} data-compare={compared ? compare : undefined} ref={roundRef}>
      <div className="cstrip-row">
        <ul
          className="cstrip"
          aria-label="Options"
          onKeyDown={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
            e.preventDefault();
            go(at + (e.key === 'ArrowRight' ? 1 : -1));
          }}
        >
          {options.map((o, i) => (
            <li key={o.name} className="copt">
              <ConceptThumb build={build} page={o.page} pages={pages} client={client} />
              <button
                type="button"
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                aria-pressed={i === at}
                data-kept={decided ? round.kept.includes(o.name) : undefined}
                onClick={() => setSel(i)}
              >
                <span className="clabel">{o.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <span className="ccount mono">
          {at + 1} of {options.length}
        </span>
      </div>
      {gate.answers && <p className="coutcome">{outcomeText(round)}</p>}

      <div className="cview">
        <div className="cview-bar" ref={barRef}>
          {full && !compared && <span className="cview-label">{current.label}</span>}
          {full && <span className="chint">Back to return</span>}
          {compared ? (
            <>
              <div className="cmodes" role="group" aria-label="Compare as">
                <button type="button" ref={firstMode} aria-pressed={compare === 'side'} onClick={() => setCompare('side')}>
                  Side by side
                </button>
                <button type="button" aria-pressed={compare === 'swipe'} onClick={() => setCompare('swipe')}>
                  Swipe
                </button>
              </div>
              <button type="button" className="btn ghost small" onClick={() => setCompare(null)}>
                One at a time
              </button>
            </>
          ) : (
            pair.length === 2 && (
              <button type="button" className="btn ghost small" ref={compareButton} onClick={() => setCompare('side')}>
                Compare
              </button>
            )
          )}
          <button type="button" className="btn ghost small" ref={toggle} onClick={() => setFull(!full)}>
            {full ? 'Back' : 'Full view'}
          </button>
        </div>
        {!compared ? (
          large(current)
        ) : compare === 'side' ? (
          <div className="cpair">
            {compared.map((o) => (
              <figure key={o.name}>
                {large(o)}
                <figcaption>
                  <span className="cpair-label">{o.label}</span>
                  {o.source && <span className="src mono">{o.source}</span>}
                  {tickBox(o, 'ctick', true)}
                  {!readOnly && (
                    <button type="button" className="btn" disabled={sending} onClick={() => onSubmit({ choice: o.name, ...noted })}>
                      Pick
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <>
            {/* The second page underneath, the first over it, cut off at the Reveal edge. */}
            <div className="cswipe" style={{ '--reveal': `${reveal}%` } as CSSProperties}>
              {large(compared[1])}
              <div className="cswipe-top">{large(compared[0])}</div>
              <span className="cswipe-label" data-edge="start">
                {compared[0].label}
              </span>
              <span className="cswipe-label" data-edge="end">
                {compared[1].label}
              </span>
            </div>
            <label className="creveal">
              Reveal
              <input
                type="range"
                min={0}
                max={100}
                value={reveal}
                aria-valuetext={`${reveal}% ${compared[0].label}`}
                onChange={(e) => setReveal(Number(e.target.value))}
              />
            </label>
          </>
        )}
      </div>

      <div className="cpanel">
        {!compared && (
          <>
            <h3>{current.label}</h3>
            {current.source && <span className="src mono">{current.source}</span>}
            <span className="cpath mono">{current.page}</span>
          </>
        )}
        {/* While comparing, each figure carries its own box instead. */}
        {!compared && tickBox(current, 'ccombine', false)}
        {!readOnly && (
          <>
            <div className="cacts">
              {!compared && (
                <button type="button" className="btn" disabled={sending} onClick={() => onSubmit({ choice: current.name, ...noted })}>
                  Pick this
                </button>
              )}
              <button type="button" className="btn ghost" disabled={sending || picks.length < 2} onClick={() => onSubmit({ choices: picks, ...noted })}>
                Combine {picks.length}
              </button>
              <button type="button" className="btn ghost" disabled={sending || !text} onClick={() => onSubmit({ none: true, note: text })}>
                None of these
              </button>
            </div>
            <label className="note-field">
              <span>Note to the agent (needed for none of these)</span>
              <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {!text && <span className="chint">Write a note to send none of these</span>}
          </>
        )}
      </div>
    </div>
  );
}
