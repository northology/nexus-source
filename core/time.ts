/**
 * ISO 8601 in UTC, to the second, e.g. 2026-10-02T20:16:29Z. Recorded in UTC because a machine's zone can be
 * misread (new or renamed zones the runtime doesn't know); the cockpit converts to a display zone.
 */
export function isoNow(date: Date = new Date()): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
