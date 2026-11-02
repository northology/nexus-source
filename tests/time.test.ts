import { describe, it, expect } from 'vitest';
import { isoNow } from '../core/time.ts';
import { validate } from '../core/schemas.ts';

describe('isoNow', () => {
  it('records UTC, so a machine with an unrecognised time zone still writes the right time', () => {
    expect(isoNow(new Date('2026-10-02T20:16:29.123Z'))).toBe('2026-10-02T20:16:29Z');
  });
  it('produces a time the schemas accept', () => {
    const entry = { name: 'trial-entry', text: 'x', status: 'exploring', source: 'test', time: isoNow() };
    expect(validate('questions', { entries: [entry] })).toEqual([]);
  });
});
