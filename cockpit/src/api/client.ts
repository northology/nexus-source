import type { InventoryItem } from '../../../core/governance/types.ts';
import type { GateAnswers, RepoSnapshot, ReviewState, Snapshot } from '../../../core/types.ts';
import type { ViewAnswer } from '../../../core/views/types.ts';

/** status 0 means the server could not be reached at all. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Marks = Record<string, 'accepted' | 'research' | 'declined'>;
export type AnswerBody =
  | { marks: Marks; notes?: Record<string, string>; note?: string }
  | { choice: string; note?: string }
  | { choices: string[]; note?: string }
  | { none: true; note: string }
  | { decision: 'approve' | 'send-back'; note?: string };

export interface Client {
  /** Also reads where concept pages are served from, so fileUrl follows the server across a restart. */
  builds(): Promise<string[]>;
  snapshot(build: string): Promise<Snapshot>;
  fileUrl(build: string, path: string): string;
  fileText(build: string, path: string): Promise<string>;
  ruleText(index: number): Promise<string>;
  submit(build: string, gate: string, body: AnswerBody): Promise<GateAnswers>;
  /** The reviews that could be read, and a line naming each one that couldn't. */
  getReviews(): Promise<{ reviews: ReviewState[]; problems: string[] }>;
  postReviewAnswers(name: string, body: AnswerBody): Promise<void>;
  repo(): Promise<RepoSnapshot>;
  repoItem(id: string): Promise<{ item: InventoryItem; text: string }>;
  view(name: string): Promise<ViewAnswer>;
  viewFileUrl(name: string, n: number): string;
  /** Re-reads the token from the cockpit page the server serves now; call it after the server may have restarted. */
  refreshToken(): Promise<void>;
}

/** The server's refusal when the token is missing or stale, for example after it restarted with a new one. */
const STALE_TOKEN = 'Answers must come from the cockpit page';
const TOKEN_META = /<meta name="nexus-token" content="([0-9a-f]+)">/;

/**
 * `token` is the one embedded in the page at load. The server makes a new one each time it starts, so the client
 * keeps its own copy and re-reads it from the page the server serves now: on request, and once when an answer is
 * refused for its token.
 */
export function createClient(opts: { base?: string; token: string | null; fetch?: typeof fetch }): Client {
  const base = (opts.base ?? '').replace(/\/$/, '');
  const doFetch: typeof fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let token = opts.token;
  /** The asset origin's base URL, ending in a slash, as the last /api/builds named it; null for none. */
  let assets: string | null = null;
  const enc = (s: string) => encodeURIComponent(s);
  const encPath = (p: string) => p.split('/').map(enc).join('/');

  async function call(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch {
      throw new ApiError(0, 'Cannot reach the nexus server');
    }
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
      } catch {
        // not a JSON error body; keep the status text
      }
      throw new ApiError(res.status, message);
    }
    return res;
  }

  /** Reads the current token from the cockpit page. Keeps the one it has on any failure. */
  async function readToken(): Promise<void> {
    try {
      const res = await doFetch(`${base}/`, { cache: 'no-store' });
      const found = res.ok ? TOKEN_META.exec(await res.text())?.[1] : undefined;
      if (found) token = found;
    } catch {
      // unreachable or not the cockpit page; keep the current token
    }
  }

  function postAnswers(build: string, gate: string, body: AnswerBody, current: string): Promise<Response> {
    return call(`/api/builds/${enc(build)}/gates/${enc(gate)}/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nexus-token': current },
      body: JSON.stringify(body),
    });
  }

  /** Posts with the current token; on a stale-token refusal, re-reads the token once and retries if it changed. */
  async function withToken(send: (current: string) => Promise<Response>): Promise<Response> {
    if (!token) throw new ApiError(403, 'This page has no cockpit token; reload it from the nexus server');
    const used = token;
    try {
      return await send(used);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403 && e.message === STALE_TOKEN)) throw e;
      // Compare with the token this POST used: a reconnect may already have renewed it while the POST was out.
      await readToken();
      if (!token || token === used) throw e;
      return send(token);
    }
  }

  return {
    async builds() {
      const body = (await (await call('/api/builds')).json()) as { builds?: unknown; assets?: unknown };
      assets = typeof body.assets === 'string' && body.assets ? body.assets.replace(/\/?$/, '/') : null;
      return Array.isArray(body.builds) ? body.builds.filter((b): b is string => typeof b === 'string') : [];
    },
    async snapshot(build) {
      // The server validated every file before building the snapshot; it is trusted as-is here.
      return (await (await call(`/api/builds/${enc(build)}`)).json()) as Snapshot;
    },
    fileUrl(build, path) {
      // Concept pages load from the asset origin, so the fonts, modules and data beside them load too.
      if (assets && path.startsWith('concepts/')) return `${assets}${enc(build)}/${encPath(path)}`;
      return `${base}/api/builds/${enc(build)}/files/${encPath(path)}`;
    },
    async ruleText(index) {
      return (await call(`/api/rules/${index}`)).text();
    },
    async fileText(build, path) {
      return (await call(`/api/builds/${enc(build)}/files/${encPath(path)}`)).text();
    },
    async submit(build, gate, body) {
      const res = await withToken((t) => postAnswers(build, gate, body, t));
      return ((await res.json()) as { answers: GateAnswers }).answers;
    },
    async getReviews() {
      const body = (await (await call('/api/reviews')).json()) as { reviews?: ReviewState[]; problems?: unknown };
      return {
        reviews: Array.isArray(body.reviews) ? body.reviews : [],
        problems: Array.isArray(body.problems) ? body.problems.filter((p): p is string => typeof p === 'string') : [],
      };
    },
    async postReviewAnswers(name, body) {
      await withToken((t) =>
        call(`/api/reviews/${enc(name)}/answers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nexus-token': t },
          body: JSON.stringify(body),
        }),
      );
    },
    async repo() {
      return (await (await call('/api/repo')).json()) as RepoSnapshot;
    },
    async repoItem(id) {
      return (await (await call(`/api/repo/items/${enc(id)}`)).json()) as { item: InventoryItem; text: string };
    },
    async view(name) {
      return (await (await call(`/api/repo/views/${enc(name)}`)).json()) as ViewAnswer;
    },
    viewFileUrl(name, n) {
      return `${base}/api/repo/views/${enc(name)}/files/${n}`;
    },
    async refreshToken() {
      if (token) await readToken();
    },
  };
}
