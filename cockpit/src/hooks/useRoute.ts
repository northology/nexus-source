import { useCallback, useEffect, useState } from 'react';
import { formatHash, parseHash, type Route } from '../lib/route.ts';

export type Navigate = (route: Route, opts?: { replace?: boolean }) => void;

export function useRoute(): [Route, Navigate] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback<Navigate>((next, opts) => {
    const hash = formatHash(next);
    if (opts?.replace) {
      window.history.replaceState(null, '', hash);
      setRoute(parseHash(hash));
    } else if (hash !== window.location.hash) {
      window.location.hash = hash;
    } else {
      setRoute(next);
    }
  }, []);
  return [route, navigate];
}
