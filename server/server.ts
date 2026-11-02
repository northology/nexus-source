import { randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, posix, resolve, sep } from 'node:path';
import { NexusError } from '../core/errors.ts';
import { inventoryEnv } from '../core/governance/env.ts';
import { governanceInventory, readInventoryItem } from '../core/governance/inventory.ts';
import type { InventoryEnv } from '../core/governance/types.ts';
import { submitAnswers } from '../core/gates.ts';
import { assertReadableName } from '../core/names.ts';
import { BUILD_DIR, buildPath, listBuilds } from '../core/paths.ts';
import { listReviews, submitReviewAnswers } from '../core/reviews.ts';
import { ruleText } from '../core/rules.ts';
import { readSnapshot } from '../core/snapshot.ts';
import { listViews, readView, readViewFile } from '../core/views/read.ts';
import { isoNow } from '../core/time.ts';
import type { RepoSnapshot } from '../core/types.ts';
import { pipeFd } from './fd-stream.ts';
import { subfolderCache, watchBuilds, watchRepo, watchSubfolders } from './events.ts';

/** `assets` is the asset listener's base URL, which `/api/builds` names; startServer sets it. */
export interface ServerOptions { root: string; cockpitDir: string; now?: () => string; watch?: boolean; token?: string; assets?: string; inventory?: InventoryEnv }
/** `assets` is the base URL concept pages are served from, ending in `/`. */
export interface RunningServer { url: string; port: number; assets: string; token: string; close(): Promise<void> }

const READABLE_AREAS: ReadonlySet<string> = new Set(['documents', 'notes', 'files', 'concepts']);
const CONCEPT_AREA: ReadonlySet<string> = new Set(['concepts']);
const TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const MAX_BODY = 256 * 1024;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Blocks DNS rebinding: only requests addressed to this machine by a local name are served. */
function isLocalHost(host: string | undefined): boolean {
  return !!host && LOCAL_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase());
}

/** Answers must come from the cockpit page: JSON only, no foreign origin, and the token embedded in the page. */
function assertFromCockpit(req: IncomingMessage, token: string): void {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new NexusError('Answers must be sent as application/json', 415);
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) throw new NexusError('Answers must come from the cockpit itself', 403);
  if (req.headers['x-nexus-token'] !== token) throw new NexusError('Answers must come from the cockpit page', 403);
}

/** Decodes one percent-escaped path part; a malformed escape is the request's fault, not the server's. */
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new NexusError('The address has a malformed escape', 400);
  }
}

/** The decoded segments of a URL path. Empty segments are dropped. */
function pathParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map(decodePart);
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, e: unknown): void {
  const status = e instanceof NexusError ? e.status : 500;
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { error: e instanceof Error ? e.message : String(e) });
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Keep draining without buffering instead of destroying the socket, so the client reads the 413 rather than
        // a reset connection.
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0;
          fail(new NexusError('Request body is too large', 413));
        }
      } else if (!tooLarge) chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        fail(new NexusError('Request body is not valid JSON'));
      }
    });
    req.on('error', fail);
  });
}

/*
 * Invariant: every HTML response from the cockpit origin carries `frame-ancestors 'none'` (sendPage) or a `sandbox`
 * CSP (build files, rules). The cockpit picks a concept frame's sandbox from its first `src` only, and a page can
 * navigate its own frame; a frame given `allow-same-origin` for the asset origin that a page sends to a cockpit-origin
 * URL is then refused (unframeable) or opaque (sandboxed), never the cockpit with its token. Pinned in server.test.ts
 * ("every HTML response from the cockpit origin is unframeable or sandboxed").
 */

/**
 * Concept pages are served from the asset origin (createAssetServer); the rest of the build files (SVGs, documents,
 * and concept pages when no asset origin is known) are served here, from the cockpit's own origin, so they are
 * sandboxed: a script in one runs in an opaque origin and cannot read the cockpit page's token, and its requests carry
 * `Origin: null`, which answers refuse.
 */
const BUILD_FILE_HEADERS = { 'content-security-policy': 'sandbox allow-scripts allow-popups allow-forms', 'x-content-type-options': 'nosniff' };

function sendFile(res: ServerResponse, file: string, headers: Record<string, string> = {}): void {
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...headers });
  // The file can go between the stat and the open (a decommission while a document loads): the 200 is already sent,
  // so the connection is dropped, as pipeFd does, rather than raising an unhandled stream error.
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  res.on('close', () => {
    if (!res.writableFinished) stream.destroy();
  });
  stream.pipe(res);
}

/**
 * Serves a file under one of `areas` in the build folder. Each decoded segment must be a plain name (an encoded slash
 * or backslash, `.` or `..` is refused), the normalised path must stay in an allowed area, and the real path, after
 * links, must stay inside that same area: a link in concepts/ can't reach documents/. The real path is what's opened,
 * so a link swapped after the check can't redirect the read.
 */
function serveBuildFile(
  root: string,
  build: string,
  segments: string[],
  res: ServerResponse,
  {
    headers = BUILD_FILE_HEADERS,
    areas = READABLE_AREAS,
    refusal = 'That path is not readable from the cockpit',
  }: { headers?: Record<string, string>; areas?: ReadonlySet<string>; refusal?: string } = {},
): void {
  const refuse = (): never => {
    throw new NexusError(refusal, 403);
  };
  if (segments.some((p) => p === '.' || p === '..' || p.includes('/') || p.includes('\\'))) refuse();
  const rel = posix.normalize(segments.join('/'));
  const area = rel.split('/')[0] ?? '';
  if (rel.startsWith('..') || rel.includes('\\') || rel.includes('/../') || !areas.has(area)) refuse();
  const areaDir = resolve(buildPath(root, build), area);
  const file = resolve(buildPath(root, build), rel);
  if (!isInside(areaDir, file)) refuse();
  if (!existsSync(file) || !statSync(file).isFile()) throw new NexusError('File not found', 404);
  // The real path stays inside its area, and inside the build: an area that is itself a link out of the build
  // doesn't carry its files along.
  const real = realpathSync(file);
  if (!isInside(realpathSync(areaDir), real) || !isInside(realpathSync(buildPath(root, build)), real)) refuse();
  sendFile(res, real, headers);
}

/**
 * Concept pages get an origin of their own: a files-only listener on a second port. A page there can load the
 * fonts, modules and data beside it, but it is not the cockpit's origin and has no token, so it can't answer
 * gates; the API sends no CORS headers, so it can't read them either.
 */
const ASSET_HEADERS = { 'content-security-policy': 'sandbox allow-scripts allow-same-origin allow-forms allow-popups', 'x-content-type-options': 'nosniff' };

export function createAssetServer(root: string) {
  return createServer((req, res) => {
    try {
      if (!isLocalHost(req.headers.host)) throw new NexusError('This server only answers requests addressed to 127.0.0.1 or localhost', 403);
      // A browser fetches a service worker's script with this header. Refusing it means no concept page can register a
      // worker that would outlive its frame and answer later requests to the concept origin.
      if (req.headers['service-worker'] === 'script') throw new NexusError('Concept pages cannot register service workers', 403);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new NexusError('Concept files are read-only', 405);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const [build, area, ...rest] = pathParts(url.pathname);
      if (!build || !area) throw new NexusError('Not found', 404);
      if (area !== 'concepts') throw new NexusError('Only concept pages are served here', 403);
      if (rest.length === 0) throw new NexusError('Not found', 404);
      assertReadableName(build, 'build name');
      serveBuildFile(root, build, ['concepts', ...rest], res, { headers: ASSET_HEADERS, areas: CONCEPT_AREA, refusal: 'That path is not a concept page' });
    } catch (e) {
      sendError(res, e);
    }
  });
}

/**
 * Serves an HTML page with the run's token embedded, so only pages this server served can answer gates. No other
 * page may frame it, so a page cannot trick the user into clicking through the cockpit (clickjacking).
 */
function sendPage(res: ServerResponse, file: string, token: string): void {
  const html = readFileSync(file, 'utf8');
  const meta = `<meta name="nexus-token" content="${token}">`;
  const body = html.includes('</head>') ? html.replace('</head>', `${meta}\n</head>`) : `${meta}\n${html}`;
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
  });
  res.end(body);
}

function serveStatic(cockpitDir: string, pathname: string, res: ServerResponse, token: string): void {
  const base = resolve(cockpitDir);
  const rel = posix.normalize(decodePart(pathname)).replace(/^\/+/, '');
  let file = resolve(base, rel || 'index.html');
  if (!isInside(base, file) || !existsSync(file) || statSync(file).isDirectory()) file = join(base, 'index.html');
  if (!existsSync(file)) throw new NexusError('The cockpit files are missing; rebuild the plugin with `pnpm build`.', 500);
  if (extname(file).toLowerCase() === '.html') sendPage(res, file, token);
  // Scripts and styles load as usual under this header; an SVG opened on its own can't run on the cockpit origin.
  else sendFile(res, file, { 'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff' });
}

export function createNexusServer(opts: ServerOptions) {
  const token = opts.token ?? randomBytes(16).toString('hex');
  const now = opts.now ?? (() => isoNow());
  const env = opts.inventory ?? inventoryEnv();
  const clients = new Set<ServerResponse>();
  const broadcast = (build: string | null): void => {
    const message = `event: change\ndata: ${JSON.stringify({ build })}\n\n`;
    for (const c of clients) c.write(message);
  };
  const stopWatching = opts.watch === false ? () => {} : watchBuilds(opts.root, broadcast);
  const repoChanged = (): void => {
    for (const c of clients) c.write(`event: change\ndata: ${JSON.stringify({ repo: true })}\n\n`);
  };
  const stopRepo = opts.watch === false ? () => {} : watchRepo(opts.root, env, repoChanged);
  const subfolders = subfolderCache(opts.root, env, { onChange: repoChanged });
  const stopSubfolders = opts.watch === false ? () => {} : watchSubfolders(subfolders, repoChanged);
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': keep-alive\n\n');
  }, 25_000);
  heartbeat.unref();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLocalHost(req.headers.host)) throw new NexusError('This server only answers requests addressed to 127.0.0.1 or localhost', 403);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = pathParts(url.pathname);
    if (parts[0] !== 'api') return serveStatic(opts.cockpitDir, url.pathname, res, token);

    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'builds') {
      const builds = existsSync(join(opts.root, BUILD_DIR)) ? listBuilds(opts.root) : [];
      return sendJson(res, 200, { root: opts.root, builds, assets: opts.assets ?? null });
    }
    if (req.method === 'GET' && parts[1] === 'rules' && parts.length === 3) {
      if (!/^\d+$/.test(parts[2] ?? '')) throw new NexusError('Not found', 404);
      const text = ruleText(opts.root, Number(parts[2]));
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache', ...BUILD_FILE_HEADERS });
      res.end(text);
      return;
    }
    if (parts[1] === 'reviews') {
      // Reviews sit beside the repo routes, not under them: /api/repo stays read-only. The one write is the cockpit's
      // answers to a review, which only the server writes, as for build gates.
      if (parts.length === 2) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new NexusError('Reviews are listed here; answers go to /api/reviews/<name>/answers', 405);
        const problems: string[] = [];
        const reviews = listReviews(opts.root, problems);
        return sendJson(res, 200, { reviews, problems });
      }
      if (parts.length === 4 && parts[3] === 'answers') {
        if (req.method !== 'POST') throw new NexusError('Review answers are only posted', 405);
        const name = parts[2] ?? '';
        assertReadableName(name, 'review name');
        assertFromCockpit(req, token);
        const body = await readBody(req);
        return sendJson(res, 201, { ok: true, answers: submitReviewAnswers(opts.root, name, body, now(), env) });
      }
      throw new NexusError('Not found', 404);
    }
    if (parts[1] === 'repo') {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new NexusError('The repo view is read-only', 405);
      if (parts.length === 2) {
        const { views, problems } = listViews(opts.root);
        const walk = subfolders.get();
        const body: RepoSnapshot = { inventory: governanceInventory(opts.root, env, { subfolders: walk.found, subfolderProblems: walk.problems }), views, problems };
        return sendJson(res, 200, body);
      }
      if (parts[2] === 'items' && parts.length === 4) {
        if (!/^[0-9a-f]{12}$/.test(parts[3] ?? '')) throw new NexusError("That isn't a standing-instruction id", 404);
        const walk = subfolders.get();
        return sendJson(res, 200, readInventoryItem(opts.root, env, parts[3] ?? '', { subfolders: walk.found, subfolderProblems: walk.problems }));
      }
      if (parts[2] === 'views' && parts[3]) {
        const name = parts[3];
        if (parts.length === 4) return sendJson(res, 200, readView(opts.root, name));
        if (parts[4] === 'files' && parts.length === 6) {
          if (!/^\d+$/.test(parts[5] ?? '')) throw new NexusError('No file at that position in this view', 404);
          // readViewFile hands back an open, already-checked fd; the image streams from it and is never re-opened by path.
          const f = readViewFile(opts.root, name, Number(parts[5]));
          const headers = {
            'content-type': f.type,
            'content-length': f.size,
            'cache-control': 'no-cache',
            'content-security-policy': 'sandbox',
            'x-content-type-options': 'nosniff',
          };
          if (req.method === 'HEAD' || f.size === 0) {
            closeSync(f.fd);
            res.writeHead(200, headers);
            res.end();
            return;
          }
          pipeFd(res, f.fd, f.size, headers);
          return;
        }
      }
      throw new NexusError('Not found', 404);
    }
    if (parts[1] === 'builds' && parts[2]) {
      const build = parts[2];
      assertReadableName(build, 'build name');
      if (req.method === 'GET' && parts.length === 3) return sendJson(res, 200, readSnapshot(opts.root, build));
      if (req.method === 'GET' && parts[3] === 'files' && parts.length > 4) return serveBuildFile(opts.root, build, parts.slice(4), res);
      if (req.method === 'POST' && parts[3] === 'gates' && parts[4] && parts[5] === 'answers' && parts.length === 6) {
        assertFromCockpit(req, token);
        const body = await readBody(req);
        const answers = submitAnswers(opts.root, build, parts[4], body, now());
        return sendJson(res, 201, { ok: true, answers });
      }
    }
    throw new NexusError('Not found', 404);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => sendError(res, e));
  });
  const stop = (): void => {
    stopWatching();
    stopRepo();
    stopSubfolders();
    clearInterval(heartbeat);
    for (const c of clients) c.end();
    clients.clear();
  };
  return { server, stop, token };
}

/** Ports we skip and retry: in use, or (on Windows) inside a reserved/excluded range. */
export function canTryNextPort(code: string | undefined): boolean {
  return code === 'EADDRINUSE' || code === 'EACCES';
}

/** Stops a listener and drops its open connections, so nothing reaches it after this resolves. */
function closeListener(server: Server): Promise<void> {
  return new Promise<void>((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
}

export async function startServer(opts: ServerOptions & { port?: number; host?: string; tries?: number }): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1';
  // The asset listener starts first, on any free port: if it fails, the start fails, with nothing else to stop.
  const assetServer = createAssetServer(opts.root);
  await new Promise<void>((done, fail) => {
    assetServer.once('error', fail);
    assetServer.listen(0, host, () => {
      assetServer.off('error', fail);
      done();
    });
  });
  const assets = `http://${host}:${(assetServer.address() as AddressInfo).port}/`;
  const { server, stop, token } = createNexusServer({ ...opts, assets });
  const first = opts.port ?? 4410;
  const tries = first === 0 ? 1 : (opts.tries ?? 20);
  const giveUp = async (): Promise<void> => {
    stop();
    await closeListener(assetServer);
  };
  for (let port = first; port < first + tries; port++) {
    const ok = await new Promise<boolean>((done, fail) => {
      const onError = (e: NodeJS.ErrnoException): void => {
        server.off('listening', onListening);
        if (canTryNextPort(e.code)) done(false);
        else fail(e);
      };
      const onListening = (): void => {
        server.off('error', onError);
        done(true);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    }).catch(async (e: unknown) => {
      await giveUp();
      throw e;
    });
    if (ok) {
      const actual = (server.address() as AddressInfo).port;
      return {
        url: `http://${host}:${actual}/`,
        port: actual,
        assets,
        token,
        close: async () => {
          stop();
          await Promise.all([closeListener(server), closeListener(assetServer)]);
        },
      };
    }
  }
  await giveUp();
  throw new NexusError(`Ports ${first} to ${first + tries - 1} are all in use or reserved; pass --port`, 500);
}
