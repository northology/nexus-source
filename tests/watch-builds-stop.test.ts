import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';

type WatchCb = (event: string, filename: string | null) => void;
const captured: { cb: WatchCb; watcher: FSWatcher }[] = [];

// Wrap the real fs.watch so the test can replay an event the OS had already queued when stop() ran.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: ((...args: unknown[]) => {
      const watcher = (actual.watch as (...a: unknown[]) => FSWatcher)(...args);
      captured.push({ cb: args[2] as WatchCb, watcher });
      return watcher;
    }) as typeof actual.watch,
  };
});

const { watchBuilds } = await import('../server/events.ts');
const { exampleRepo } = await import('./helpers.ts');

afterEach(() => {
  vi.useRealTimers();
  captured.length = 0;
});

function armed(): { cb: WatchCb; watcher: FSWatcher } {
  const last = captured.at(-1);
  if (!last) throw new Error('no watcher was armed');
  return last;
}

describe('watchBuilds stop()', () => {
  it('ignores a watch event delivered after stop', async () => {
    const root = exampleRepo();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 20, identityMs: 60000 });
    const { cb } = armed();
    stop();
    cb('change', join('relay-rebuild', 'notes', 'late.md'));
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).toEqual([]);
  });

  it('starts no polling when the watcher errors after stop', () => {
    const root = exampleRepo();
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 20, identityMs: 100, pollMs: 50 });
    const { watcher } = armed();
    stop();
    expect(vi.getTimerCount()).toBe(0);
    watcher.emit('error', new Error('late'));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it('runs no identity check after stop', () => {
    const root = exampleRepo();
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 20, identityMs: 100 });
    stop();
    rmSync(join(root, '.build'), { recursive: true, force: true });
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
