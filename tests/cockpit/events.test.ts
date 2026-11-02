import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRepoChange, subscribeEvents, type ChangeData } from '../../cockpit/src/api/events.ts';

/** Stands in for the browser's EventSource: records each one made and lets a test fire its events. */
class FakeSource {
  static made: FakeSource[] = [];
  closed = false;
  private readonly handlers = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data?: string): void {
    for (const fn of this.handlers.get(type) ?? []) fn(data === undefined ? {} : { data });
  }
}

const leftovers: (() => void)[] = [];
const subscribe = (...args: Parameters<typeof subscribeEvents>): (() => void) => {
  const off = subscribeEvents(...args);
  leftovers.push(off);
  return off;
};
const client = () => ({ refreshToken: vi.fn(() => Promise.resolve()) });

beforeEach(() => {
  FakeSource.made = [];
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => {
  for (const off of leftovers.splice(0)) off();
  vi.unstubAllGlobals();
});

describe('the shared event subscription', () => {
  it('opens one EventSource for every subscriber, lazily, and closes it when the last one leaves', () => {
    const c = client();
    expect(FakeSource.made).toHaveLength(0);
    const offA = subscribe(c, { change: () => {} });
    const offB = subscribe(c, { open: () => {} });
    expect(FakeSource.made).toHaveLength(1);
    expect(FakeSource.made[0]?.url).toBe('/api/events');
    offA();
    offA();
    expect(FakeSource.made[0]?.closed).toBe(false);
    offB();
    expect(FakeSource.made[0]?.closed).toBe(true);
    subscribe(c, { change: () => {} });
    expect(FakeSource.made).toHaveLength(2);
  });

  it('hands every subscriber each change, parsed, and null for data that is not JSON', () => {
    const c = client();
    const a: ChangeData[] = [];
    const b: ChangeData[] = [];
    subscribe(c, { change: (d) => a.push(d) });
    subscribe(c, { change: (d) => b.push(d) });
    const source = FakeSource.made[0];
    source?.emit('change', '{"repo":true}');
    source?.emit('change', '{"build":"relay-rebuild"}');
    source?.emit('change', 'not json');
    expect(a).toEqual([{ repo: true }, { build: 'relay-rebuild' }, null]);
    expect(b).toEqual(a);
  });

  it('re-reads the page token once per reconnect, not on the first connect, then tells every subscriber', () => {
    const c = client();
    const opens: string[] = [];
    subscribe(c, { open: () => opens.push('a') });
    subscribe(c, { open: () => opens.push('b') });
    const source = FakeSource.made[0];
    source?.emit('open');
    expect(c.refreshToken).not.toHaveBeenCalled();
    expect(opens).toEqual(['a', 'b']);
    source?.emit('open');
    expect(c.refreshToken).toHaveBeenCalledTimes(1);
    expect(opens).toEqual(['a', 'b', 'a', 'b']);
  });

  it('starts counting connects again once the last subscriber has left', () => {
    const c = client();
    const off = subscribe(c, { open: () => {} });
    FakeSource.made[0]?.emit('open');
    off();
    subscribe(c, { open: () => {} });
    FakeSource.made[1]?.emit('open');
    expect(c.refreshToken).not.toHaveBeenCalled();
  });
});

describe('isRepoChange', () => {
  it('is true only for the repo event', () => {
    expect([isRepoChange({ repo: true }), isRepoChange({ build: 'b' }), isRepoChange({ build: null }), isRepoChange(null)]).toEqual([true, false, false, false]);
  });
});
