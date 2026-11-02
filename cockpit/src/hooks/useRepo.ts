import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoSnapshot } from '../../../core/types.ts';
import type { Client } from '../api/client.ts';
import { isRepoChange, subscribeEvents } from '../api/events.ts';

/**
 * The repo's inventory and views, refetched on every repo change event and on every (re)connect. While a read has
 * failed it also retries on any change event: the server announces no repo change when its own read recovers.
 */
export function useRepo(client: Client): { repo: RepoSnapshot | null; error: string | null; refresh: () => void } {
  const [repo, setRepo] = useState<RepoSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failing = useRef(false);
  useEffect(() => {
    failing.current = error !== null;
  }, [error]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    client.repo().then(
      (r) => {
        if (cancelled) return;
        setRepo(r);
        setError(null);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, tick]);
  useEffect(
    () =>
      subscribeEvents(client, {
        change: (data) => {
          if (isRepoChange(data) || failing.current) refresh();
        },
        open: refresh,
      }),
    [client, refresh],
  );
  return { repo, error, refresh };
}
