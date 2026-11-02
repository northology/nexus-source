/**
 * Chooses a subgraph title's left edge inside a box from `left` to `right`, or null to leave the title where Mermaid put
 * it. `blocked` holds the x values where an edge crosses the title's row. The title keeps `gap` clear of each, and `pad`
 * from the box's sides, and sits as far left as it can (left-aligned). When the title is wider than the box or no
 * stretch between the edges is wide enough, nothing moves: the box is never resized.
 */
export function titleSpot(left: number, right: number, width: number, blocked: number[], pad = 8, gap = 6): number | null {
  const end = right - pad;
  let from = left + pad;
  if (end - from < width) return null;
  const xs = [...blocked].sort((a, b) => a - b);
  // The stretches of the row an edge crosses, merged.
  const spans: [number, number][] = [];
  for (const x of xs) {
    const last = spans[spans.length - 1];
    if (last && x - gap <= last[1]) last[1] = Math.max(last[1], x + gap);
    else spans.push([x - gap, x + gap]);
  }
  for (const [a, b] of spans) {
    if (a - from >= width) return from;
    from = Math.max(from, b);
  }
  return end - from >= width ? from : null;
}

/**
 * Mermaid centres each subgraph's title at the top of its box, which is where an edge entering the box from above runs
 * straight down. Moves each title to a stretch of its row that no edge crosses (left-aligned when it can be). A title
 * with no clear stretch stays where Mermaid put it, and no box is ever resized. Every move is worked out before any is
 * made, and any failure leaves the diagram exactly as Mermaid drew it: this pass must never break a page.
 */
export function moveTitles(svg: SVGSVGElement): void {
  try {
    const edges = Array.from(svg.querySelectorAll<SVGPathElement>('.edgePaths path'));
    const moves: { label: SVGGElement; transform: string }[] = [];
    for (const cluster of Array.from(svg.querySelectorAll<SVGGElement>('g.cluster'))) {
      const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
      const label = cluster.querySelector<SVGGElement>(':scope > .cluster-label');
      const box = label?.querySelector('foreignObject');
      const own = cluster.getScreenCTM();
      if (!rect || !label || !box || !own) continue;
      const move = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(label.getAttribute('transform') ?? '');
      const width = Number(box.getAttribute('width'));
      const height = Number(box.getAttribute('height'));
      const top = Number(move?.[2]);
      if (!move || !(width > 0) || !(height > 0) || !Number.isFinite(top)) continue;
      const x = rect.x.baseVal.value;
      const w = rect.width.baseVal.value;
      const row = label.getBoundingClientRect();
      const across = rect.getBoundingClientRect();
      const toBox = own.inverse();
      // Where edges cross the title row, in the box's own units. An edge that doesn't reach the row isn't walked.
      const blocked: number[] = [];
      for (const edge of edges) {
        const near = edge.getBoundingClientRect();
        if (near.bottom < row.top - 2 || near.top > row.bottom + 2 || near.right < across.left - 8 || near.left > across.right + 8) continue;
        const m = edge.getScreenCTM();
        if (!m) continue;
        const to = toBox.multiply(m);
        const length = edge.getTotalLength();
        for (let at = 0; at <= length; at += 4) {
          const p = edge.getPointAtLength(at).matrixTransform(to);
          if (p.y >= top - 2 && p.y <= top + height + 2 && p.x >= x - 4 && p.x <= x + w + 4) blocked.push(p.x);
        }
      }
      const spot = titleSpot(x, x + w, width, blocked);
      if (spot !== null) moves.push({ label, transform: `translate(${spot}, ${top})` });
    }
    for (const m of moves) m.label.setAttribute('transform', m.transform);
  } catch {
    // The diagram stays as Mermaid drew it.
  }
}
