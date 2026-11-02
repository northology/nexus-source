import { describe, it, expect } from 'vitest';
import { readSnapshot } from '../../core/snapshot.ts';
import { GUIDE_PAGES, guidePage, keepBuildInLinks } from '../../cockpit/src/lib/guidance.ts';
import { railItems } from '../../cockpit/src/lib/rail.ts';
import { formatHash, parseHash } from '../../cockpit/src/lib/route.ts';
import { exampleRepo } from '../helpers.ts';

describe('Guidance', () => {
  it('routes #/guidance and its sub-pages, keeping a heading', () => {
    expect(parseHash('#/guidance')).toMatchObject({ category: 'guidance', sub: null });
    expect(parseHash('#/guidance/commands?h=phase-status')).toMatchObject({ category: 'guidance', sub: 'commands', params: { h: 'phase-status' } });
    expect(formatHash({ category: 'guidance', sub: 'commands', params: { h: 'phase-status' } })).toBe('#/guidance/commands?h=phase-status');
  });
  it('falls back to the overview for a missing or unknown sub-page', () => {
    expect(guidePage(null)).toBe('overview');
    expect(guidePage('flow')).toBe('flow');
    expect(guidePage('nope')).toBe('overview');
    expect(GUIDE_PAGES.map((p) => p.label)).toEqual(['Overview', 'How a build runs', 'Commands', 'Views']);
  });
  it('keeps the chosen build on the guide links, so a checkout with several builds stays on its build', () => {
    const text = 'See [phase status](#/guidance/commands?h=phase-status) and [the wall](#/guidance/flow).';
    expect(keepBuildInLinks(text, 'relay-rebuild')).toBe(
      'See [phase status](#/guidance/commands?build=relay-rebuild&h=phase-status) and [the wall](#/guidance/flow?build=relay-rebuild).',
    );
    expect(keepBuildInLinks(text, null)).toBe(text);
  });
  it('sits last in the rail, never counted and never needing you', () => {
    const items = railItems(readSnapshot(exampleRepo(), 'relay-rebuild'));
    expect(items.at(-1)).toEqual({ category: 'guidance', label: 'Guidance', count: '', needs: false, cells: [] });
  });
});
