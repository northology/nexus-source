import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync, existsSync, cpSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { request, Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, canTryNextPort, type RunningServer } from '../server/server.ts';
import { watchBuilds } from '../server/events.ts';
import { ARTIFACTS, exampleRepo, treeHash, NOW, tempDir } from './helpers.ts';
import { isolatedEnv } from './governance-helpers.ts';

const COCKPIT = join(ARTIFACTS, 'cockpit-placeholder');
const B = 'relay-rebuild';
const JSON_HEADERS = { 'content-type': 'application/json' };
/** Headers the real cockpit page sends: JSON plus the per-run token the server embeds in the page. */
const cockpitHeaders = (s: RunningServer, extra: Record<string, string> = {}) => ({ ...JSON_HEADERS, 'x-nexus-token': s.token, ...extra });
const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function serve(root: string, extra: { port?: number; tries?: number } = {}): Promise<RunningServer> {
  const s = await startServer({ root, cockpitDir: COCKPIT, port: extra.port ?? 0, ...(extra.tries !== undefined ? { tries: extra.tries } : {}), now: () => NOW, inventory: { ...isolatedEnv(tempDir()), ceiling: tmpdir() } });
  open.push(s);
  return s;
}

/** True when each of `count` consecutive ports from `first` can be bound on the loopback right now. */
async function portsFree(first: number, count: number): Promise<boolean> {
  for (let p = first; p < first + count; p += 1) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (!free) return false;
  }
  return true;
}

async function readUntil(stream: ReadableStream<Uint8Array>, text: string, ms: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms));
  while (!buf.includes(text)) {
    const next = await Promise.race([reader.read(), timeout]);
    if (next === 'timeout' || next.done) break;
    buf += decoder.decode(next.value);
  }
  await reader.cancel();
  return buf;
}

describe('API', () => {
  it('lists builds and returns a snapshot', async () => {
    const s = await serve(exampleRepo());
    expect(await (await fetch(`${s.url}api/builds`)).json()).toMatchObject({ builds: [B] });
    const snap = await (await fetch(`${s.url}api/builds/${B}`)).json();
    expect(snap.problems).toEqual([]);
    expect(snap.gates).toHaveLength(3);
  });
  it('lists no builds before one exists', async () => {
    const s = await serve(join(exampleRepo(), 'reference-free'));
    expect(await (await fetch(`${s.url}api/builds`)).json()).toMatchObject({ builds: [] });
  });
  it('serves documents with a content type', async () => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.url}api/builds/${B}/files/documents/specs/relay-rebuild-spec.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(await res.text()).toMatch(/# Relay rebuild: design/);
  });
  it.each([
    ['documents%2F..%2Fbuild.json', 403],
    ['gates/scope.json', 403],
    ['logs/decisions.json', 403],
    ['documents/..%5C..%5Cbuild.json', 403],
    ['documents/specs/missing.md', 404],
  ])('guards file path %s', async (path, status) => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.url}api/builds/${B}/files/${path}`);
    expect(res.status).toBe(status);
    expect(await res.json()).toHaveProperty('error');
  });
  it('serves nothing from a leftover decommission/ folder, the staging area of an earlier design', async () => {
    const root = exampleRepo();
    const dir = join(root, '.build', B, 'decommission', 'files');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), '# Final report\n');
    const s = await serve(root);
    expect((await fetch(`${s.url}api/builds/${B}/files/decommission/files/report.md`)).status).toBe(403);
  });
  describe('a build file path', () => {
    /** The example repo with a note in its documents. */
    function staged(): { root: string; note: string } {
      const root = exampleRepo();
      const files = join(root, '.build', B, 'documents', 'docs');
      mkdirSync(files, { recursive: true });
      const note = join(files, 'note.md');
      writeFileSync(note, '# Staged note\n');
      return { root, note };
    }
    const fileUrl = (s: RunningServer, path: string) => `${s.url}api/builds/${B}/files/documents/${path}`;

    it('serves a document with its type, sandboxed, with no sniffing', async () => {
      const s = await serve(staged().root);
      const res = await fetch(fileUrl(s, 'docs/note.md'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
      expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups allow-forms');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });
    it.each([
      ['a parent segment', '../build.json'],
      ['an encoded parent segment', '%2e%2e/build.json'],
      ['an encoded slash', '..%2Fbuild.json'],
      ['an encoded slash out of docs/', 'docs/..%2F..%2Fbuild.json'],
      ['an encoded backslash', 'docs/..%5C..%5Cbuild.json'],
      ['a climb into another build area', 'docs/..%2F..%2Fgates%2Fscope.json'],
      ['a dot segment', 'docs/.%2Fnote.md'],
    ])('refuses %s', async (_label, path) => {
      const s = await serve(staged().root);
      // Sent raw: fetch would resolve a plain `..` before the request left.
      const res = await rawGet(s.port, `/api/builds/${B}/files/documents/${path}`, `127.0.0.1:${s.port}`);
      expect(res.status).toBe(403);
      expect(res.body).not.toContain('"gates"');
    });
    it("decodes a path once: a double-encoded parent segment is a plain name that isn't there", async () => {
      const s = await serve(staged().root);
      // 404, not 403: a second decode would have turned it into `..` and met the refusal.
      const res = await rawGet(s.port, `/api/builds/${B}/files/documents/%252e%252e/build.json`, `127.0.0.1:${s.port}`);
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('"gates"');
    });
    it('lists no folder and reports a missing file', async () => {
      const s = await serve(staged().root);
      for (const path of ['docs', 'docs/missing.md']) {
        const res = await fetch(fileUrl(s, path));
        expect(res.status, path).toBe(404);
        expect(await res.json(), path).toEqual({ error: 'File not found' });
      }
      const bare = await fetch(`${s.url}api/builds/${B}/files/documents`);
      expect(bare.status).toBe(404);
    });
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s: nothing is written or removed', async (method) => {
      const { root, note } = staged();
      const s = await serve(root);
      const res = await fetch(fileUrl(s, 'docs/note.md'), { method, headers: cockpitHeaders(s), ...(method === 'DELETE' ? {} : { body: '{"text":"changed"}' }) });
      expect(res.status).toBe(404);
      expect(readFileSync(note, 'utf8')).toBe('# Staged note\n');
      const fresh = await fetch(fileUrl(s, 'docs/new.md'), { method, headers: cockpitHeaders(s), ...(method === 'DELETE' ? {} : { body: '{"text":"new"}' }) });
      expect(fresh.status).toBe(404);
      expect(existsSync(join(root, '.build', B, 'documents', 'docs', 'new.md'))).toBe(false);
    });
  });
  it('accepts answers once', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const post = (body: unknown) => fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s), body: JSON.stringify(body) });
    const first = await post({ choice: 'quiet-board' });
    expect(first.status).toBe(201);
    expect((await first.json()).answers).toEqual({ choice: 'quiet-board', gate: 'look', submitted: NOW });
    expect((await post({ choice: 'dense-table' })).status).toBe(409);
  });
  it.each([
    ['bad JSON', '{ nope', 400],
    ['wrong choice', JSON.stringify({ choice: 'third-way' }), 400],
  ])('rejects %s', async (_label, body, status) => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s), body });
    expect(res.status).toBe(status);
  });
  it('404s unknown gates, builds and routes', async () => {
    const s = await serve(exampleRepo());
    expect((await fetch(`${s.url}api/builds/${B}/gates/no-such-gate/answers`, { method: 'POST', headers: cockpitHeaders(s), body: '{"decision":"approve"}' })).status).toBe(404);
    expect((await fetch(`${s.url}api/builds/missing-build`)).status).toBe(404);
    expect((await fetch(`${s.url}api/nothing-here`)).status).toBe(404);
  });
});

describe('only the cockpit can answer', () => {
  it('answers 413 to an oversize body and writes no answers', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s), body: JSON.stringify({ choice: 'quiet-board', note: 'x'.repeat(300 * 1024) }) });
    expect(res.status).toBe(413);
    expect(existsSync(join(root, '.build', B, 'gates', 'look.answers.json'))).toBe(false);
  });
  it('refuses answers that are not sent as JSON', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(415);
    expect(existsSync(join(root, '.build', B, 'gates', 'look.answers.json'))).toBe(false);
  });
  it('refuses answers posted from another origin', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s, { origin: 'http://evil.example' }), body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(403);
    expect(existsSync(join(root, '.build', B, 'gates', 'look.answers.json'))).toBe(false);
  });
  it('accepts answers from its own origin', async () => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s, { origin: s.url.replace(/\/$/, '') }), body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(201);
  });
  it('refuses requests addressed to another host name', async () => {
    const s = await serve(exampleRepo());
    const status = await new Promise<number>((done, fail) => {
      const req = request({ host: '127.0.0.1', port: s.port, path: '/api/builds', headers: { host: `evil.example:${s.port}` } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on('error', fail);
      req.end();
    });
    expect(status).toBe(403);
  });
  it('refuses answers without the cockpit token', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: JSON_HEADERS, body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Answers must come from the cockpit page');
    expect(existsSync(join(root, '.build', B, 'gates', 'look.answers.json'))).toBe(false);
  });
  it('refuses a wrong token', async () => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: { ...JSON_HEADERS, 'x-nexus-token': 'f'.repeat(32) }, body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(403);
  });
  it('embeds its token in the cockpit page', async () => {
    const s = await serve(exampleRepo());
    for (const path of ['', 'logs/issues']) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toContain(`<meta name="nexus-token" content="${s.token}">\n</head>`);
    }
  });
  it('makes a new token each time it starts', async () => {
    const root = exampleRepo();
    const a = await serve(root);
    const b = await serve(root);
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    expect(b.token).not.toBe(a.token);
  });
});

describe('build files cannot act as the cockpit', () => {
  it.each(['concepts/quiet-board.html', 'documents/specs/relay-rebuild-spec.md'])('serves %s sandboxed, with no sniffing', async (path) => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.url}api/builds/${B}/files/${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups allow-forms');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('refuses answers from a sandboxed page (Origin: null), even with the token', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s, { origin: 'null' }), body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(403);
    expect(existsSync(join(root, '.build', B, 'gates', 'look.answers.json'))).toBe(false);
  });
});

/** Sends one request with a raw path and Host header, which fetch would normalise or refuse to set. */
function rawGet(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => done({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

describe('concept pages have their own origin', () => {
  it('names the asset origin in /api/builds, on another port than the cockpit', async () => {
    const s = await serve(exampleRepo());
    const body = (await (await fetch(`${s.url}api/builds`)).json()) as { assets: string };
    expect(body.assets).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(body.assets).toBe(s.assets);
    expect(new URL(body.assets).port).not.toBe(String(s.port));
  });
  it('serves a concept page there, sandboxed with its own origin, with no sniffing', async () => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.assets}${B}/concepts/quiet-board.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-same-origin allow-forms allow-popups');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it.each([
    ['documents/specs/relay-rebuild-spec.md', 403],
    ['concepts/%2e%2e/build.json', 403],
    ['concepts%2F..%2Fbuild.json', 403],
    ['concepts/..%2F..%2Fbuild.json', 403],
    ['concepts/..%5C..%5Cbuild.json', 403],
    // An encoded slash must not climb out of concepts/ into another readable area.
    ['concepts/..%2Fdocuments%2Fspecs%2Frelay-rebuild-spec.md', 403],
    ['concepts/..%2Fnotes%2Fworking.md', 403],
    ['concepts/x/..%2F..%2Fdocuments/specs/relay-rebuild-spec.md', 403],
    ['concepts/.%2Fquiet-board.html', 403],
    ['concepts/missing.html', 404],
  ])('guards asset path %s', async (path, status) => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.assets}${B}/${path}`);
    expect(res.status).toBe(status);
    expect(await res.json()).toHaveProperty('error');
  });
  it('serves no API there', async () => {
    const s = await serve(exampleRepo());
    for (const path of ['api/builds', `api/builds/${B}`, '']) {
      const res = await fetch(`${s.assets}${path}`);
      expect([403, 404]).toContain(res.status);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['error']);
    }
  });
  it('refuses a service worker script, so no page can register one over the concept origin', async () => {
    const root = exampleRepo();
    writeFileSync(join(root, '.build', B, 'concepts', 'sw.js'), "self.addEventListener('fetch', () => {});\n");
    const s = await serve(root);
    for (const method of ['GET', 'HEAD']) {
      const res = await fetch(`${s.assets}${B}/concepts/sw.js`, { method, headers: { 'service-worker': 'script' } });
      expect(res.status, method).toBe(403);
    }
    expect((await fetch(`${s.assets}${B}/concepts/sw.js`)).status).toBe(200);
  });
  it('is read-only', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.assets}${B}/concepts/quiet-board.html`, { method: 'POST', headers: cockpitHeaders(s), body: '{}' });
    expect(res.status).toBe(405);
  });
  it('refuses requests addressed to another host name', async () => {
    const s = await serve(exampleRepo());
    const port = Number(new URL(s.assets).port);
    expect((await rawGet(port, `/${B}/concepts/quiet-board.html`, 'example.com')).status).toBe(403);
    expect((await rawGet(port, `/${B}/concepts/quiet-board.html`, `127.0.0.1:${port}`)).status).toBe(200);
  });
  it('can not answer gates: the cockpit refuses answers from the asset origin, even with the token', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s, { origin: s.assets.replace(/\/$/, '') }), body: '{"choice":"quiet-board"}' });
    expect(res.status).toBe(403);
    expect(existsSync(join(root, '.build', B, 'gates', 'look.answers.json'))).toBe(false);
  });
  it('serves fonts with their types', async () => {
    const root = exampleRepo();
    for (const ext of ['woff', 'woff2', 'ttf', 'otf']) writeFileSync(join(root, '.build', B, 'concepts', `face.${ext}`), 'not really a font');
    const s = await serve(root);
    for (const ext of ['woff', 'woff2', 'ttf', 'otf']) {
      const res = await fetch(`${s.assets}${B}/concepts/face.${ext}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(`font/${ext}`);
    }
  });
  it('closes both listeners', async () => {
    const s = await startServer({ root: exampleRepo(), cockpitDir: COCKPIT, port: 0, watch: false });
    expect((await fetch(`${s.assets}${B}/concepts/quiet-board.html`)).status).toBe(200);
    await s.close();
    await expect(fetch(`${s.assets}${B}/concepts/quiet-board.html`)).rejects.toThrow();
    await expect(fetch(`${s.url}api/builds`)).rejects.toThrow();
  });
  it('closes the asset listener when no cockpit port can be had', async () => {
    const root = exampleRepo();
    const a = await serve(root);
    const listen = vi.spyOn(Server.prototype, 'listen');
    try {
      const err = await startServer({ root, cockpitDir: COCKPIT, port: a.port, tries: 1, watch: false }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/all in use or reserved/);
      // Two listeners were started (the asset one, then the cockpit one); neither is still listening.
      const started = listen.mock.contexts as Server[];
      expect(started).toHaveLength(2);
      expect(started.map((s) => s.listening)).toEqual([false, false]);
    } finally {
      listen.mockRestore();
    }
  });
});

describe('malformed escapes', () => {
  it('answers 400 on the cockpit listener, for the API and for cockpit files', async () => {
    const s = await serve(exampleRepo());
    for (const path of [`api/builds/${B}/files/concepts/%E0%A4%A`, 'api/builds/%E0%A4%A', '%E0%A4%A']) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.status, path).toBe(400);
      expect(await res.json()).toEqual({ error: 'The address has a malformed escape' });
    }
  });
  it('answers 400 on the asset listener', async () => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.assets}${B}/concepts/%E0%A4%A`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The address has a malformed escape' });
  });
});

/** Whether this OS lets a test make a file symlink: Windows refuses without Developer Mode or admin rights. */
const canLinkFiles = (() => {
  try {
    const d = tempDir();
    writeFileSync(join(d, 'target'), 'x');
    symlinkSync(join(d, 'target'), join(d, 'link'), 'file');
    return true;
  } catch {
    return false;
  }
})();

describe('links out of the build', () => {
  /** A file outside the build folder, and the example repo whose concepts/ will link to it. */
  function outside(): { root: string; dir: string } {
    const root = exampleRepo();
    const dir = join(tempDir(), 'outside');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'secret.html'), '<p>secret</p>');
    return { root, dir };
  }
  const routes = (s: RunningServer, path: string) => [`${s.assets}${B}/concepts/${path}`, `${s.url}api/builds/${B}/files/concepts/${path}`];

  // A directory junction needs no privileges on Windows; elsewhere 'junction' makes a plain directory symlink.
  it('refuses a file reached through a linked folder under concepts/, on both routes', async () => {
    const { root, dir } = outside();
    symlinkSync(dir, join(root, '.build', B, 'concepts', 'linked'), 'junction');
    const s = await serve(root);
    for (const url of routes(s, 'linked/secret.html')) {
      const res = await fetch(url);
      expect(res.status, url).toBe(403);
      expect(await res.text()).not.toContain('secret</p>');
    }
  });
  it('refuses a file reached through a linked folder under documents/, at any depth', async () => {
    const { root, dir } = outside();
    mkdirSync(join(root, '.build', B, 'documents', 'deep', 'docs'), { recursive: true });
    symlinkSync(dir, join(root, '.build', B, 'documents', 'linked'), 'junction');
    symlinkSync(dir, join(root, '.build', B, 'documents', 'deep', 'docs', 'linked'), 'junction');
    const s = await serve(root);
    for (const path of ['linked/secret.html', 'deep/docs/linked/secret.html']) {
      const res = await fetch(`${s.url}api/builds/${B}/files/documents/${path}`);
      expect(res.status, path).toBe(403);
      expect(await res.text()).not.toContain('secret</p>');
    }
  });
  it('refuses a documents/ folder that is itself a link out of the build', async () => {
    const { root, dir } = outside();
    rmSync(join(root, '.build', B, 'documents'), { recursive: true, force: true });
    symlinkSync(dir, join(root, '.build', B, 'documents'), 'junction');
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/files/documents/secret.html`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('secret</p>');
  });
  it('refuses a link under documents/ into another part of the build', async () => {
    const root = exampleRepo();
    symlinkSync(join(root, '.build', B, 'gates'), join(root, '.build', B, 'documents', 'gates'), 'junction');
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/files/documents/gates/scope.json`);
    expect(res.status).toBe(403);
  });
  it.skipIf(!canLinkFiles)('refuses a file symlink under documents/ that points outside the build (skipped where the OS refuses file symlinks without privileges)', async () => {
    const { root, dir } = outside();
    symlinkSync(join(dir, 'secret.html'), join(root, '.build', B, 'documents', 'secret.html'), 'file');
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/files/documents/secret.html`);
    expect(res.status).toBe(403);
  });
  it.skipIf(!canLinkFiles)('refuses a file symlink under concepts/ that points outside the build, on both routes (skipped where the OS refuses file symlinks without privileges)', async () => {
    const { root, dir } = outside();
    symlinkSync(join(dir, 'secret.html'), join(root, '.build', B, 'concepts', 'secret.html'), 'file');
    const s = await serve(root);
    for (const url of routes(s, 'secret.html')) {
      const res = await fetch(url);
      expect(res.status, url).toBe(403);
    }
  });
});

describe('framing', () => {
  it('refuses to let other pages frame the cockpit', async () => {
    const s = await serve(exampleRepo());
    for (const path of ['', 'logs/issues']) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });
});

describe('every HTML response from the cockpit origin is unframeable or sandboxed', () => {
  // A concept frame's sandbox is chosen from its first `src` only; a page can navigate its own frame to the cockpit
  // origin, keeping `allow-same-origin`. That is safe only while every page the cockpit origin serves either refuses
  // to be framed or sandboxes itself (server.ts names this invariant).
  it.each([
    ['the cockpit page', ''],
    ['an unknown route', 'logs/issues'],
    ['a cockpit file by name', 'index.html'],
    ['a concept page', `api/builds/${B}/files/concepts/quiet-board.html`],
    ['a document', `api/builds/${B}/files/documents/specs/relay-rebuild-spec.md`],
    ['a static rules file', 'api/rules/0'],
  ])('%s', async (_name, path) => {
    const root = exampleRepo();
    mkdirSync(join(root, '.nexus'), { recursive: true });
    writeFileSync(join(root, '.nexus', 'config.json'), JSON.stringify({ staticRules: ['RULES.md'] }));
    writeFileSync(join(root, 'RULES.md'), '# Rules\n\n<script>parent.postMessage("hi", "*")</script>\n');
    const s = await serve(root);
    const res = await fetch(`${s.url}${path}`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp === "frame-ancestors 'none'" || csp.startsWith('sandbox '), csp).toBe(true);
  });
});

describe('writing rule', () => {
  it('only a valid answers POST changes the build folder, and only its answers file', async () => {
    const root = exampleRepo();
    const dir = join(root, '.build', B);
    const s = await serve(root);
    const before = treeHash(dir);
    await fetch(`${s.url}api/builds`);
    await fetch(`${s.url}api/builds/${B}`);
    await fetch(`${s.url}api/builds/${B}/files/documents/specs/relay-rebuild-spec.md`);
    await fetch(`${s.url}api/builds/${B}/files/gates/scope.json`);
    await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s), body: '{"choice":"third-way"}' });
    await fetch(`${s.url}api/builds/${B}/gates/scope/answers`, { method: 'POST', headers: cockpitHeaders(s), body: '{"decision":"approve"}' });
    await fetch(`${s.url}`);
    expect(treeHash(dir)).toBe(before);
    expect((await fetch(`${s.url}api/builds/${B}/gates/look/answers`, { method: 'POST', headers: cockpitHeaders(s), body: '{"choice":"quiet-board"}' })).status).toBe(201);
    expect(existsSync(join(dir, 'gates', 'look.answers.json'))).toBe(true);
  });
});

describe('cockpit files', () => {
  it('serves index.html at / and for unknown routes', async () => {
    const s = await serve(exampleRepo());
    for (const path of ['', 'logs/issues']) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/<title>nexus<\/title>/);
    }
  });
});

describe('live updates', () => {
  it('pushes a full refresh when a run ledger is written', async () => {
    const root = exampleRepo();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 200 });
    await new Promise((r) => setTimeout(r, 300));
    mkdirSync(join(root, '.superpowers', 'sdd', 'run'), { recursive: true });
    writeFileSync(join(root, '.superpowers', 'sdd', 'run', 'progress.md'), '# SDD ledger — plan: .build/relay-rebuild/documents/plans/p.md\n');
    await new Promise((r) => setTimeout(r, 700));
    stop();
    expect(seen).toContain(null);
  });
  it('pushes a full refresh when only a plan-path marker is written', async () => {
    const root = exampleRepo();
    const dir = join(root, '.superpowers', 'sdd', 'run');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'progress.md'), '# SDD ledger — plan: .build/relay-rebuild/documents/plans/p.md\n');
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 200 });
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(dir, 'plan-path'), '.build/relay-rebuild/documents/plans/p.md\n');
    await new Promise((r) => setTimeout(r, 700));
    stop();
    expect(seen).toContain(null);
  });
  it('pushes nothing while no ledger or marker changes', async () => {
    const root = exampleRepo();
    const dir = join(root, '.superpowers', 'sdd', 'run');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'progress.md'), '# SDD ledger — plan: .build/relay-rebuild/documents/plans/p.md\n');
    writeFileSync(join(dir, 'plan-path'), '.build/relay-rebuild/documents/plans/p.md\n');
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 100 });
    await new Promise((r) => setTimeout(r, 400));
    seen.length = 0;
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(seen).toEqual([]);
  });
  it('keeps reporting after .build/ is removed and recreated', async () => {
    const root = exampleRepo();
    const dir = join(root, '.build');
    const copy = tempDir();
    cpSync(dir, copy, { recursive: true });
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 200 });
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 500));
    cpSync(copy, dir, { recursive: true });
    await new Promise((r) => setTimeout(r, 700));
    expect(seen).toContain(null);
    seen.length = 0;
    writeFileSync(join(dir, B, 'notes', 'after.md'), 'x');
    await new Promise((r) => setTimeout(r, 800));
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });
  it('starts watching once .build/ appears', async () => {
    const root = tempDir();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 200, pollMs: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    mkdirSync(join(root, '.build', 'late-build'), { recursive: true });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toContain(null);
    seen.length = 0;
    writeFileSync(join(root, '.build', 'late-build', 'build.json'), '{}');
    await new Promise((r) => setTimeout(r, 800));
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });
  it('pushes a change event when a build file changes', async () => {
    const root = exampleRepo();
    const s = await serve(root);
    const res = await fetch(`${s.url}api/events`);
    setTimeout(() => writeFileSync(join(root, '.build', B, 'notes', 'new.md'), '# new'), 300);
    const text = await readUntil(res.body!, 'event: change', 8000);
    expect(text).toContain('event: change');
  });
  it('the watcher names the build that changed and debounces bursts', async () => {
    const root = exampleRepo();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 150 });
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 5; i++) writeFileSync(join(root, '.build', B, 'notes', `burst-${i}.md`), String(i));
    await new Promise((r) => setTimeout(r, 1500));
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.length).toBeLessThanOrEqual(2);
    expect(seen[0]).toBe(B);
  });
  it('ignores dotfiles directly in .build/, such as .gitattributes', async () => {
    const root = exampleRepo();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { debounceMs: 50, identityMs: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(root, '.build', '.gitattributes'), '* text=auto');
    await new Promise((r) => setTimeout(r, 600));
    stop();
    expect(seen).toEqual([]);
  });
  it('checks the folder identity in polling mode too', async () => {
    const root = exampleRepo();
    const dir = join(root, '.build');
    const copy = tempDir();
    cpSync(dir, copy, { recursive: true });
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { forcePolling: true, pollMs: 60000, debounceMs: 50, identityMs: 150 });
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 400));
    cpSync(copy, dir, { recursive: true });
    await new Promise((r) => setTimeout(r, 600));
    stop();
    expect(seen).toContain(null);
  });
  it('falls back to polling', async () => {
    const root = exampleRepo();
    const seen: (string | null)[] = [];
    const stop = watchBuilds(root, (b) => seen.push(b), { forcePolling: true, pollMs: 200, debounceMs: 50 });
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(root, '.build', B, 'notes', 'polled.md'), 'x');
    await new Promise((r) => setTimeout(r, 1000));
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ports', () => {
  it('treats Windows reserved ports (EACCES) like ports in use, and nothing else', () => {
    expect(canTryNextPort('EADDRINUSE')).toBe(true);
    expect(canTryNextPort('EACCES')).toBe(true);
    expect(canTryNextPort('EADDRNOTAVAIL')).toBe(false);
    expect(canTryNextPort(undefined)).toBe(false);
  });
  it('takes the next free port when the first is in use', async () => {
    const root = exampleRepo();
    // The OS hands ports out in order, so a is followed by b's own asset server and then whatever other suites open.
    // Take a base only when the ports the search will walk over (a.port + 1 to + 4) are free right now, else try again.
    let a = await serve(root);
    for (let attempt = 0; attempt < 10 && !(await portsFree(a.port + 1, 4)); attempt += 1) {
      open.splice(open.indexOf(a), 1);
      await a.close();
      a = await serve(root);
    }
    const b = await serve(root, { port: a.port, tries: 5 });
    expect(b.port).not.toBe(a.port);
    expect(b.port).toBeGreaterThan(a.port);
  });
});
