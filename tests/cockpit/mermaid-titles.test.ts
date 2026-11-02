import { describe, it, expect } from 'vitest';
import { moveTitles, titleSpot } from '../../cockpit/src/lib/mermaid-titles.ts';

describe('where a subgraph title goes', () => {
  it('left-aligns it when nothing crosses its row', () => {
    expect(titleSpot(0, 200, 100, [])).toBe(8);
  });
  it('keeps it left of an edge when it fits there', () => {
    expect(titleSpot(0, 300, 100, [180])).toBe(8);
  });
  it('moves it right of an edge when only the right side has room', () => {
    expect(titleSpot(0, 400, 100, [60])).toBe(66);
  });
  it('merges edges that run close together', () => {
    expect(titleSpot(0, 400, 100, [200, 204, 208])).toBe(8);
  });
  it('leaves the title where it is when no clear stretch is wide enough', () => {
    expect(titleSpot(0, 200, 107, [100])).toBeNull();
  });
  it('leaves the title where it is when the box is narrower than the title', () => {
    expect(titleSpot(0, 100, 107, [])).toBeNull();
    expect(titleSpot(0, 110, 107, [])).toBeNull();
  });
});

describe('moving titles is never fatal', () => {
  it('leaves a diagram alone when any step throws', () => {
    const svg = {
      querySelectorAll: () => {
        throw new Error('no geometry here');
      },
    };
    expect(() => moveTitles(svg as unknown as SVGSVGElement)).not.toThrow();
  });
  it('applies nothing when a later cluster throws', () => {
    const attrs: Record<string, string> = { transform: 'translate(10, 5)' };
    const label = {
      getAttribute: (n: string) => attrs[n] ?? null,
      setAttribute: (n: string, v: string) => void (attrs[n] = v),
      querySelector: () => ({ getAttribute: () => '50' }),
      getBoundingClientRect: () => ({ left: 0, right: 50, top: 0, bottom: 20 }),
    };
    const rect = { getBoundingClientRect: () => ({ left: 0, right: 200 }), x: { baseVal: { value: 0 } }, width: { baseVal: { value: 200 } } };
    const good = {
      querySelector: (s: string) => (s.includes('rect') ? rect : label),
      getScreenCTM: () => ({ inverse: () => ({ multiply: () => ({}) }) }),
    };
    const bad = {
      querySelector: () => {
        throw new Error('boom');
      },
    };
    const svg = { querySelectorAll: (s: string) => (s === 'g.cluster' ? [good, bad] : []) };
    expect(() => moveTitles(svg as unknown as SVGSVGElement)).not.toThrow();
    expect(attrs['transform']).toBe('translate(10, 5)');
  });
});
