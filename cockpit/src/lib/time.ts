/**
 * nexus records times in UTC; the cockpit shows them in a display zone the viewer picks. The machine's own zone
 * can be misread (a new zone the runtime doesn't know), so an unknown zone falls back to UTC.
 */
const FALLBACK = 'UTC';

export function isValidZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === 'string' && zone !== 'Etc/Unknown' && isValidZone(zone) ? zone : FALLBACK;
}

/** "Oct 2 14:16": month, day and 24-hour time in the display zone. */
export function formatTime(iso: string, zone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidZone(zone) ? zone : FALLBACK,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')} ${get('hour')}:${get('minute')}`;
}

export function zoneChoices(current: string): string[] {
  return [...new Set([current, browserZone(), FALLBACK])];
}
