/** View state lives in the URL hash: #/<category>[/<sub-page>][?<params>]. See reference/cockpit.md. */
export const CATEGORIES = ['gate', 'plan', 'phases', 'logs', 'concepts', 'documents', 'repo', 'guidance'] as const;
export type Category = (typeof CATEGORIES)[number];
export const LOG_TABS = ['decisions', 'issues', 'changes', 'questions', 'guardrails'] as const;
export type LogTab = (typeof LOG_TABS)[number];
export const DOC_TABS = ['plans', 'specs', 'audits', 'reports', 'notes'] as const;
export type DocTab = (typeof DOC_TABS)[number];

export interface Route {
  category: Category;
  sub: string | null;
  params: Record<string, string>;
}

export const DEFAULT_ROUTE: Route = { category: 'gate', sub: null, params: {} };

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function parseHash(hash: string): Route {
  const [path, query] = splitOnce(hash.replace(/^#\/?/, ''), '?');
  const [first = '', second] = path.split('/').filter(Boolean).map(safeDecode);
  if (!isCategory(first)) return { ...DEFAULT_ROUTE, params: {} };
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) if (v !== '') params[k] = v;
  return { category: first, sub: second ?? null, params };
}

function encodeValue(v: string): string {
  return encodeURIComponent(v).replace(/%2C/gi, ',').replace(/%2F/gi, '/');
}

export function formatHash(route: Route): string {
  const path = [route.category, ...(route.sub ? [route.sub] : [])].map(encodeURIComponent).join('/');
  const query = Object.entries(route.params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeValue(v)}`)
    .join('&');
  return `#/${path}${query ? `?${query}` : ''}`;
}

export function withParams(route: Route, patch: Record<string, string | null>): Route {
  const params: Record<string, string> = { ...route.params };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete params[k];
    else params[k] = v;
  }
  return { ...route, params };
}

/** The selected phase, for a link that should land in the same phase it was followed from. */
export function keepPhase(route: Route): Record<string, string> {
  const phase = route.params['phase'];
  return phase ? { phase } : {};
}

/** Moving between sections drops section-specific filters but keeps which build is open. */
export function keepBuild(route: Route): Record<string, string> {
  const build = route.params['build'];
  return build ? { build } : {};
}
