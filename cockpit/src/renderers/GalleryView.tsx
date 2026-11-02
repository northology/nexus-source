import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryData } from '../../../core/views/types.ts';

type Image = GalleryData['images'][number];

/**
 * A declared gallery: each image with its caption (else its file name), opened large on a click and stepped with the
 * arrow keys. Images the server refused for leaving the repo are named; one that fails to load shows its name and says
 * so. `urlFor` gives an image's address by position; each image's stamp (its size and time) goes on it, so a
 * regenerated image is fetched again and an unchanged one isn't. `selected` marks one image (a link to it named it) and
 * brings it into view.
 */
export function GalleryView({ data, urlFor, start, selected }: { data: GalleryData; urlFor: (index: number) => string; start?: number; selected?: number | undefined }) {
  const [open, setOpen] = useState<number | null>(start ?? null);
  // Held by address: an image that failed stays failed while its address is unchanged, and is tried again once a
  // reread gives it a new one (its stamp changed).
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [seen, setSeen] = useState(data);
  const panel = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const n = data.images.length;
  const current = open === null ? undefined : data.images[open];
  const src = (img: Image) => `${urlFor(img.index)}?v=${encodeURIComponent(img.stamp)}`;
  if (seen !== data) {
    // A new answer: failures at addresses it no longer has are dropped; the rest stand.
    setSeen(data);
    const now = new Set(data.images.map(src));
    setFailed((f) => new Set([...f].filter((s) => now.has(s))));
  }
  if (open !== null && !current) {
    // A reread dropped the open image: the large view closes, and a later reread that brings it back doesn't reopen it.
    setOpen(null);
  }
  const shown = current ? open : null;
  /** Closes the large view and puts focus back on the image it showed last. */
  const close = useCallback((at: number) => {
    setOpen(null);
    buttons.current[at]?.focus();
  }, []);
  useEffect(() => {
    if (shown === null) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Modified keys belong to the browser (Alt+Left goes back); Shift stays ours, for Shift+Tab.
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') close(shown);
      else if (e.key === 'ArrowRight') setOpen(Math.min(n - 1, shown + 1));
      else if (e.key === 'ArrowLeft') setOpen(Math.max(0, shown - 1));
      // The dialog holds nothing else to focus, so Tab stays on it.
      else if (e.key === 'Tab') panel.current?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, n, close]);
  useEffect(() => {
    if (selected !== undefined) buttons.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const fail = (s: string) => setFailed((f) => new Set(f).add(s));
  const refused = data.refused ?? [];
  return (
    <>
      {refused.length > 0 && <p className="view-note">Not shown, because they lead outside the repo: {refused.join(', ')}</p>}
      {n === 0 && refused.length === 0 && <p className="view-note">No images here yet.</p>}
      {n > 0 && (
        <div className="gallery">
          {data.images.map((img, i) => (
            <figure key={img.index} className={i === selected ? 'selected' : undefined}>
              <button
                type="button"
                aria-label={`Open ${img.name}`}
                aria-current={i === selected ? 'true' : undefined}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                onClick={() => setOpen(i)}
              >
                {failed.has(src(img)) ? (
                  <span className="gallery-failed">
                    <span className="mono">{img.name}</span> couldn’t be shown
                  </span>
                ) : (
                  <img src={src(img)} alt={img.caption || img.name} loading="lazy" onError={() => fail(src(img))} />
                )}
              </button>
              <figcaption>{img.caption || img.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {current && shown !== null && (
        <div className="gallery-large" role="dialog" aria-modal="true" aria-label={current.name} tabIndex={-1} ref={panel} onClick={() => close(shown)}>
          {failed.has(src(current)) ? (
            <p className="gallery-failed" onClick={(e) => e.stopPropagation()}>
              <span className="mono">{current.name}</span> couldn’t be shown
            </p>
          ) : (
            <img src={src(current)} alt={current.caption || current.name} onClick={(e) => e.stopPropagation()} onError={() => fail(src(current))} />
          )}
          <p className="mono">
            {current.caption || current.name} · {shown + 1} of {n} · Esc closes, arrows step
          </p>
        </div>
      )}
    </>
  );
}
