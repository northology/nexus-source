/** Per-viewer settings. Storage can be blocked or throw (private windows, cleared site data), so every access is guarded. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type Theme = 'light' | 'dark';
export const PREF_KEYS = { theme: 'nexus.theme', zone: 'nexus.zone' } as const;

export function safeStorage(): KeyValueStore | null {
  try {
    return (globalThis as { localStorage?: KeyValueStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readPref(store: KeyValueStore | null, key: string): string | null {
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

export function writePref(store: KeyValueStore | null, key: string, value: string): boolean {
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function initialTheme(store: KeyValueStore | null, prefersDark: boolean): Theme {
  const stored = readPref(store, PREF_KEYS.theme);
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function initialZone(store: KeyValueStore | null, fallback: string, valid: (zone: string) => boolean): string {
  const stored = readPref(store, PREF_KEYS.zone);
  return stored && valid(stored) ? stored : fallback;
}
