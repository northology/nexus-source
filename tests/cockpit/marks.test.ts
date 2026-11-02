import { describe, it, expect } from 'vitest';
import { LOG_STATUSES } from '../../core/schema-files.ts';
import { GATE_MARKS, LOG_STYLES, defaultShown, opensNote, styleOf } from '../../cockpit/src/lib/marks.ts';

describe('opensNote', () => {
  it('opens a row note for research or decline, but not for a decline on a decommission gate', () => {
    expect(opensNote(undefined, 'accepted')).toBe(false);
    expect(opensNote(undefined, 'research')).toBe(true);
    expect(opensNote('scope', 'declined')).toBe(true);
    // Declining there only leaves the guardrail with the build: there is no why to give.
    expect(opensNote('decommission', 'declined')).toBe(false);
    expect(opensNote('decommission', 'research')).toBe(true);
  });
});

describe('line-form state', () => {
  it('styles exactly the statuses the schemas allow', () => {
    for (const [log, statuses] of Object.entries(LOG_STATUSES)) {
      expect(LOG_STYLES[log as keyof typeof LOG_STYLES].map((s) => s.status)).toEqual(statuses);
    }
  });
  it('draws accepted solid, research half, exploring dashed and declined struck', () => {
    expect(styleOf('decisions', 'accepted')).toMatchObject({ mark: 'solid', struck: false });
    expect(styleOf('questions', 'research').mark).toBe('half');
    expect(styleOf('questions', 'exploring').mark).toBe('dashed');
    expect(styleOf('decisions', 'declined')).toMatchObject({ mark: 'faint', struck: true });
  });
  it('never uses the needs-you mark for log statuses', () => {
    for (const styles of Object.values(LOG_STYLES)) for (const s of styles) expect(s.mark).not.toBe('needs');
  });
  it('hides settled statuses by default', () => {
    expect(defaultShown('decisions')).toEqual(['accepted']);
    expect(defaultShown('issues')).toEqual(['open']);
    expect(defaultShown('questions')).toEqual(['exploring', 'research']);
    expect(defaultShown('changes')).toEqual(['applied']);
  });
  it('treats an unknown status as pending and shown', () => {
    expect(styleOf('issues', 'triaged')).toEqual({ status: 'triaged', mark: 'dashed', struck: false, shownByDefault: true });
  });
  it('offers the three gate marks in order', () => {
    expect(GATE_MARKS).toEqual(['accepted', 'research', 'declined']);
  });
});
