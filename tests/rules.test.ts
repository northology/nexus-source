import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { readSnapshot } from '../core/snapshot.ts';
import { startServer, type RunningServer } from '../server/server.ts';
import { ARTIFACTS, exampleRepo, NOW } from './helpers.ts';

const B = 'relay-rebuild';
const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

function withRules(config: unknown): string {
  const root = exampleRepo();
  mkdirSync(join(root, '.nexus'));
  writeFileSync(join(root, '.nexus', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  writeFileSync(join(root, 'RULES.md'), '# Working rules\n\n- Never push without a go.\n');
  return root;
}

describe('static rules', () => {
  it('are listed in the snapshot, with missing files named', () => {
    const s = readSnapshot(withRules({ staticRules: ['RULES.md', 'missing.md'] }), B);
    expect(s.rules).toEqual([
      { index: 0, path: 'RULES.md', problem: null, revision: expect.any(String) },
      { index: 1, path: 'missing.md', problem: 'missing', revision: null },
    ]);
    expect(s.problems).toEqual([]);
  });
  it('are empty without a config, and a bad config is a problem', () => {
    expect(readSnapshot(exampleRepo(), B).rules).toEqual([]);
    const s = readSnapshot(withRules('{ nope'), B);
    expect(s.rules).toEqual([]);
    expect(s.problems.map((p) => p.file)).toContain('.nexus/config.json');
  });
  it('are served read-only, sandboxed, by index only', async () => {
    const s = await startServer({ root: withRules({ staticRules: ['RULES.md', 'missing.md'] }), cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, watch: false, now: () => NOW });
    open.push(s);
    const ok = await fetch(`${s.url}api/rules/0`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(await ok.text()).toContain('# Working rules');
    expect((await fetch(`${s.url}api/rules/1`)).status).toBe(404);
    expect((await fetch(`${s.url}api/rules/7`)).status).toBe(404);
    expect((await fetch(`${s.url}api/rules/..%2FRULES.md`)).status).toBe(404);
  });
  it('read a folder named like a markdown file as missing, and the route answers 404', async () => {
    const root = withRules({ staticRules: ['RULES.md', 'folder.md'] });
    mkdirSync(join(root, 'folder.md'));
    expect(readSnapshot(root, B).rules[1]).toEqual({ index: 1, path: 'folder.md', problem: 'missing', revision: null });
    const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, watch: false, now: () => NOW });
    open.push(s);
    expect((await fetch(`${s.url}api/rules/1`)).status).toBe(404);
  });
  it('refuse a non-markdown entry in the config, so the list is empty and the route answers 404', async () => {
    const root = withRules({ staticRules: ['RULES.md', 'notes.txt'] });
    writeFileSync(join(root, 'notes.txt'), 'plain');
    const snapshot = readSnapshot(root, B);
    expect(snapshot.rules).toEqual([]);
    expect(snapshot.problems.map((p) => p.file)).toContain('.nexus/config.json');
    const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, watch: false, now: () => NOW });
    open.push(s);
    expect((await fetch(`${s.url}api/rules/0`)).status).toBe(404);
    expect((await fetch(`${s.url}api/rules/1`)).status).toBe(404);
  });
  it('read a rules path that cannot be statted (a symlink loop) as missing, without breaking the snapshot', async () => {
    const root = withRules({ staticRules: ['RULES.md', 'loop.md'] });
    try {
      symlinkSync('loop.md', join(root, 'loop.md'));
    } catch {
      return; // symlinks are not allowed here
    }
    const snapshot = readSnapshot(root, B);
    expect(snapshot.rules).toEqual([
      { index: 0, path: 'RULES.md', problem: null, revision: expect.any(String) },
      { index: 1, path: 'loop.md', problem: 'missing', revision: null },
    ]);
    const s = await startServer({ root, cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, watch: false, now: () => NOW });
    open.push(s);
    expect((await fetch(`${s.url}api/rules/1`)).status).toBe(404);
  });
  it('refuse a non-local Host', async () => {
    const s = await startServer({ root: withRules({ staticRules: ['RULES.md'] }), cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, watch: false, now: () => NOW });
    open.push(s);
    const port = new URL(s.url).port;
    const status = await new Promise<number>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/rules/0', headers: { host: 'evil.example' } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on('error', fail);
      req.end();
    });
    expect(status).toBe(403);
  });
});
