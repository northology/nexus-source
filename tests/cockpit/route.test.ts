import { describe, it, expect } from 'vitest';
import { sectionOf } from '../../cockpit/src/lib/repo.ts';
import { DEFAULT_ROUTE, LOG_TABS, formatHash, keepBuild, parseHash, withParams } from '../../cockpit/src/lib/route.ts';

describe('view links', () => {
  it('parses the documented example', () => {
    expect(parseHash('#/logs/issues?show=open,addressed&q=replay')).toEqual({ category: 'logs', sub: 'issues', params: { show: 'open,addressed', q: 'replay' } });
  });
  it('knows the guardrails tab', () => {
    expect(LOG_TABS).toContain('guardrails');
    expect(parseHash('#/logs/guardrails?show=accepted')).toEqual({ category: 'logs', sub: 'guardrails', params: { show: 'accepted' } });
  });
  it('falls back to the gate view', () => {
    expect(parseHash('')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#/')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#/nonsense/thing')).toEqual(DEFAULT_ROUTE);
  });
  it('keeps commas and slashes readable and round-trips', () => {
    const route = { category: 'documents' as const, sub: 'specs', params: { doc: 'documents/specs/relay-rebuild-spec.md', show: 'open,addressed' } };
    expect(formatHash(route)).toBe('#/documents/specs?doc=documents/specs/relay-rebuild-spec.md&show=open,addressed');
    expect(parseHash(formatHash(route))).toEqual(route);
  });
  it('encodes spaces and decodes them back', () => {
    const hash = formatHash({ category: 'logs', sub: null, params: { q: 'lag view' } });
    expect(hash).toBe('#/logs?q=lag%20view');
    expect(parseHash(hash).params).toEqual({ q: 'lag view' });
  });
  it('drops empty parameters', () => {
    expect(formatHash({ category: 'logs', sub: 'decisions', params: { q: '' } })).toBe('#/logs/decisions');
  });
  it('patches parameters, removing null and empty values', () => {
    const route = parseHash('#/logs?q=retry&show=accepted');
    expect(withParams(route, { q: null, show: 'declined', build: 'relay-rebuild' }).params).toEqual({ show: 'declined', build: 'relay-rebuild' });
    expect(withParams(route, { q: '' }).params).toEqual({ show: 'accepted' });
  });
  it('parses and formats repo routes', () => {
    expect(parseHash('#/repo/memory?item=abc')).toEqual({ category: 'repo', sub: 'memory', params: { item: 'abc' } });
    expect(formatHash({ category: 'repo', sub: 'views', params: { view: 'load' } })).toBe('#/repo/views?view=load');
  });
  it('keeps an unknown repo section, which the repo logic falls back from', () => {
    const route = parseHash('#/repo/zzz');
    expect(route).toEqual({ category: 'repo', sub: 'zzz', params: {} });
    expect(sectionOf(route.sub)).toBe('overview');
  });
  it('does not throw on a malformed escape in a repo route', () => {
    expect(() => parseHash('#/repo/%E0%A4%A')).not.toThrow();
    expect(parseHash('#/repo/%E0%A4%A').category).toBe('repo');
  });
  it('round-trips a view name containing a slash and a hash', () => {
    const route = { category: 'repo' as const, sub: 'views', params: { view: 'a/b#c' } };
    expect(parseHash(formatHash(route))).toEqual(route);
  });
  it('carries only the build parameter between sections', () => {
    expect(keepBuild(parseHash('#/logs?q=x&build=second-build'))).toEqual({ build: 'second-build' });
    expect(keepBuild(parseHash('#/logs?q=x'))).toEqual({});
  });
});
