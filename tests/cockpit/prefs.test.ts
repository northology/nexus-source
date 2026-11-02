import { describe, it, expect } from 'vitest';
import { PREF_KEYS, initialTheme, initialZone, readPref, writePref, type KeyValueStore } from '../../cockpit/src/lib/prefs.ts';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const blocked: KeyValueStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};
const valid = (z: string) => z === 'America/Regina' || z === 'UTC';

describe('viewer settings', () => {
  it('remembers a theme', () => {
    const store = memory();
    expect(writePref(store, PREF_KEYS.theme, 'dark')).toBe(true);
    expect(initialTheme(store, false)).toBe('dark');
  });
  it('follows the system theme until one is chosen', () => {
    expect(initialTheme(memory(), true)).toBe('dark');
    expect(initialTheme(memory(), false)).toBe('light');
  });
  it('ignores a stored value that is not a theme', () => {
    const store = memory();
    store.data.set(PREF_KEYS.theme, 'sepia');
    expect(initialTheme(store, false)).toBe('light');
  });
  it('survives blocked or missing storage', () => {
    expect(readPref(blocked, PREF_KEYS.theme)).toBeNull();
    expect(writePref(blocked, PREF_KEYS.theme, 'dark')).toBe(false);
    expect(initialTheme(blocked, true)).toBe('dark');
    expect(initialTheme(null, false)).toBe('light');
    expect(initialZone(blocked, 'UTC', valid)).toBe('UTC');
  });
  it('uses a stored zone only when it is real', () => {
    const store = memory();
    store.data.set(PREF_KEYS.zone, 'America/Regina');
    expect(initialZone(store, 'UTC', valid)).toBe('America/Regina');
    store.data.set(PREF_KEYS.zone, 'Mars/Olympus');
    expect(initialZone(store, 'UTC', valid)).toBe('UTC');
  });
});
