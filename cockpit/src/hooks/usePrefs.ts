import { useCallback, useEffect, useMemo, useState } from 'react';
import { PREF_KEYS, initialTheme, initialZone, safeStorage, writePref, type Theme } from '../lib/prefs.ts';
import { browserZone, isValidZone } from '../lib/time.ts';

export function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function usePrefs(): { theme: Theme; setTheme: (t: Theme) => void; zone: string; setZone: (z: string) => void } {
  const store = useMemo(() => safeStorage(), []);
  const [theme, setThemeState] = useState<Theme>(() => initialTheme(store, prefersDark()));
  const [zone, setZoneState] = useState<string>(() => initialZone(store, browserZone(), isValidZone));
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      writePref(store, PREF_KEYS.theme, t);
    },
    [store],
  );
  const setZone = useCallback(
    (z: string) => {
      if (!isValidZone(z)) return;
      setZoneState(z);
      writePref(store, PREF_KEYS.zone, z);
    },
    [store],
  );
  return { theme, setTheme, zone, setZone };
}
