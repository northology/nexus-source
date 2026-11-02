import type { Theme } from '../lib/prefs.ts';

/**
 * Okabe–Ito, in one hue order for both themes: sky blue, bluish green, yellow, reddish purple, vermillion, blue. The
 * dark theme uses the original values. The light theme darkens each one (scaling it towards black in linear RGB, so
 * its hue and saturation hold) only as far as 3:1 against the cockpit's ground and sheet needs. Orange and grey are
 * left out of both: darkened that far, orange can't be told from yellow under protanopia or from vermillion under
 * deuteranopia, and with them in, no eight or seven of these hues stay apart (tests/cockpit/chart.test.ts holds the
 * contrast and the ΔE separation, normal and simulated). The one palette every chart uses.
 */
export const PALETTE = {
  light: ['#4696C3', '#009E73', '#989026', '#C574A1', '#D55E00', '#0072B2'],
  dark: ['#56B4E9', '#009E73', '#F0E442', '#CC79A7', '#D55E00', '#0072B2'],
} as const;

/** A series' colour; past the palette the colours repeat, with a dash. */
export function seriesStyle(i: number, theme: Theme): { color: string; dash: string | null } {
  const colors = PALETTE[theme];
  return { color: colors[i % colors.length] ?? '#5C5C59', dash: i >= colors.length ? '6 4' : null };
}

/** Which time round the palette a series is: 0 for the first colours (a circle), then a new marker shape each time. */
export function seriesMarker(i: number): number {
  return Math.floor(i / PALETTE.light.length);
}
