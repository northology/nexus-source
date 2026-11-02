import { describe, it, expect } from 'vitest';
import { formatTime, isValidZone, zoneChoices } from '../../cockpit/src/lib/time.ts';

describe('display times', () => {
  it('shows a UTC time in permanent UTC-6', () => {
    expect(formatTime('2026-10-02T20:16:29Z', 'America/Regina')).toBe('Oct 2 14:16');
  });
  it('shows an offset time in UTC', () => {
    expect(formatTime('2026-10-02T11:55:00-06:00', 'UTC')).toBe('Oct 2 17:55');
  });
  it('uses a 24-hour clock with midnight as 00', () => {
    expect(formatTime('2026-10-03T06:05:00Z', 'America/Regina')).toBe('Oct 3 00:05');
  });
  it('falls back to UTC for an unknown zone and leaves bad input alone', () => {
    expect(formatTime('2026-10-02T20:16:29Z', 'Alberta Standard Time')).toBe('Oct 2 20:16');
    expect(formatTime('not a time', 'UTC')).toBe('not a time');
  });
  it('knows real zones from made-up ones', () => {
    expect(isValidZone('America/Regina')).toBe(true);
    expect(isValidZone('Alberta Standard Time')).toBe(false);
    expect(isValidZone('')).toBe(false);
  });
  it("offers the current zone, the browser's and UTC without repeats, and no zone of its own", () => {
    const choices = zoneChoices('Asia/Tokyo');
    expect(choices[0]).toBe('Asia/Tokyo');
    expect(choices).toContain('UTC');
    expect(choices).not.toContain('America/Regina');
    expect(new Set(choices).size).toBe(choices.length);
  });
});
