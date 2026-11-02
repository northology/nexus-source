import { describe, it, expect } from 'vitest';
import { isReadableName, assertReadableName, duplicateNames } from '../core/names.ts';

describe('readable names', () => {
  it.each(['scope', 'relay-rebuild', 'spec-review', 'retry-max-3', 'q3-planning', 'phase-2'])('accepts %s', (n) => {
    expect(isReadableName(n)).toBe(true);
  });
  it.each(['D01', 'd01', 'e43', 'x-1', 'Relay', 'relay_rebuild', 'relay--rebuild', '-relay', 'relay-', '', 'a'.repeat(65)])(
    'rejects %s',
    (n) => {
      expect(isReadableName(n)).toBe(false);
    },
  );
  it('rejects non-strings', () => {
    expect(isReadableName(42)).toBe(false);
    expect(isReadableName(null)).toBe(false);
  });
  it('explains the rule when it rejects', () => {
    expect(() => assertReadableName('d01', 'gate name')).toThrow(/gate name "d01" is not a readable name/);
  });
  it('says numbers are fine and bare codes are not, with examples', () => {
    expect(() => assertReadableName('p1', 'phase name')).toThrow(
      'phase name "p1" is not a readable name: use lowercase letters and numbers, starting with a letter, in words joined by hyphens, with at least three letters in a row somewhere (for example "scope", "phase-2" or "relay-rebuild"); bare codes like "p1" or "d01" are not allowed',
    );
  });
  it('finds repeated names', () => {
    expect(duplicateNames([{ name: 'scope' }, { name: 'look' }, { name: 'scope' }])).toEqual(['scope']);
    expect(duplicateNames([{ name: 'scope' }])).toEqual([]);
  });
});
