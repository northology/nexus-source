import { formatHash, parseHash } from './route.ts';

/** The Guidance section's sub-pages, in the order the sub-menu shows them. */
export const GUIDE_PAGES = [
  { key: 'overview', label: 'Overview' },
  { key: 'flow', label: 'How a build runs' },
  { key: 'commands', label: 'Commands' },
  { key: 'views', label: 'Views' },
] as const;
export type GuidePage = (typeof GUIDE_PAGES)[number]['key'];

/**
 * The guide's own links (`#/guidance/...`) with the chosen build added, so following one in a checkout with several
 * builds doesn't drop the cockpit back to the build picker.
 */
export function keepBuildInLinks(text: string, build: string | null): string {
  if (!build) return text;
  return text.replace(/\]\((#\/guidance\/[^)\s]*)\)/g, (_, href: string) => {
    const route = parseHash(href);
    return `](${formatHash({ ...route, params: { build, ...route.params } })})`;
  });
}

/** The sub-page a route names; anything else is the overview. */
export function guidePage(sub: string | null): GuidePage {
  return GUIDE_PAGES.find((p) => p.key === sub)?.key ?? 'overview';
}
