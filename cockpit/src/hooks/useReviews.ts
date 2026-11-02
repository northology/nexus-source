import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewState } from '../../../core/types.ts';
import type { Client } from '../api/client.ts';
import { isRepoChange, subscribeEvents } from '../api/events.ts';

const NO_PROBLEMS: string[] = [];

/**
 * The repo's reviews, refetched on every repo change event (a review file is part of the repo signature) and on
 * every (re)connect, like useRepo. While a read has failed it also retries on any change event. `problems` names
 * each review that couldn't be read; `error` is a read that failed outright, with the last good reviews kept.
 */
export function useReviews(client: Client): { reviews: ReviewState[]; problems: string[]; error: string | null; refresh: () => void } {
  const [read, setRead] = useState<{ reviews: ReviewState[]; problems: string[] }>({ reviews: [], problems: NO_PROBLEMS });
  const [error, setError] = useState<string | null>(null);
  const failing = useRef(false);
  useEffect(() => {
    failing.current = error !== null;
  }, [error]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    client.getReviews().then(
      (r) => {
        if (cancelled) return;
        setRead(r);
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
  return { reviews: read.reviews, problems: read.problems, error, refresh };
}
