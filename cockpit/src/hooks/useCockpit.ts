import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '../../../core/types.ts';
import { ApiError, type Client } from '../api/client.ts';
import { isRepoChange, subscribeEvents } from '../api/events.ts';

export type Load =
  | { state: 'loading' }
  | { state: 'offline'; message: string }
  | { state: 'error'; message: string }
  | { state: 'empty' }
  | { state: 'choose'; builds: string[] }
  | { state: 'ready'; builds: string[]; build: string; snapshot: Snapshot };

/**
 * Loads the build and keeps it current: refetches on every build change event (a repo change is useRepo's) and on
 * every (re)connect, so a restarted server catches the page up; the shared event stream re-reads the page token on a
 * reconnect, since the server renews it each time it starts. Only an unreachable server counts as offline: then it
 * retries every 3 s and, once a build has been shown, keeps showing the last good snapshot. Any other failure (a
 * build gone, a server error) is shown as it is and not retried on a timer; the next build change event tries again.
 */
export function useCockpit(client: Client, requested: string | null): { load: Load; offline: string | null; failed: string | null; refresh: () => void } {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [offline, setOffline] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const builds = await client.builds();
        if (cancelled) return;
        const only = builds.length === 1 ? (builds[0] ?? null) : null;
        const build = requested !== null && builds.includes(requested) ? requested : only;
        if (builds.length === 0) setLoad({ state: 'empty' });
        else if (build === null) setLoad({ state: 'choose', builds });
        else {
          const snapshot = await client.snapshot(build);
          if (cancelled) return;
          setLoad({ state: 'ready', builds, build, snapshot });
        }
        setOffline(null);
        setFailed(null);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        const unreachable = e instanceof ApiError && e.status === 0;
        setOffline(unreachable ? message : null);
        setFailed(unreachable ? null : message);
        setLoad((prev) => (prev.state === 'ready' ? prev : unreachable ? { state: 'offline', message } : { state: 'error', message }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, requested, tick]);

  useEffect(
    () =>
      subscribeEvents(client, {
        change: (data) => {
          if (!isRepoChange(data)) refresh();
        },
        open: refresh,
      }),
    [client, refresh],
  );

  useEffect(() => {
    if (offline === null) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [offline, refresh]);

  return { load, offline, failed, refresh };
}
