import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type RunningServer } from '../server/server.ts';
import { ARTIFACTS, exampleRepo, NOW, tempDir } from './helpers.ts';
import { isolatedEnv } from './governance-helpers.ts';

const B = 'relay-rebuild';
const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});
async function serve(root: string, cockpitDir = join(ARTIFACTS, 'cockpit-placeholder')): Promise<RunningServer> {
  const s = await startServer({ root, cockpitDir, port: 0, now: () => NOW, inventory: { ...isolatedEnv(tempDir()), ceiling: tmpdir() } });
  open.push(s);
  return s;
}
/** A link inside concepts/ that points at the build's documents/ folder. */
function linkToDocuments(root: string): void {
  symlinkSync(join(root, '.build', B, 'documents'), join(root, '.build', B, 'concepts', 'peek'), 'junction');
}

describe('each area is its own boundary', () => {
  it('the concept-page server refuses a link out of concepts/ into another area', async () => {
    const root = exampleRepo();
    linkToDocuments(root);
    const s = await serve(root);
    const res = await fetch(`${s.assets}${B}/concepts/peek/specs/relay-rebuild-spec.md`);
    expect(res.status).toBe(403);
  });
  it('the cockpit refuses the same link through its concepts area', async () => {
    const root = exampleRepo();
    linkToDocuments(root);
    const s = await serve(root);
    const res = await fetch(`${s.url}api/builds/${B}/files/concepts/peek/specs/relay-rebuild-spec.md`);
    expect(res.status).toBe(403);
  });
  it('still serves a file through a link that stays inside its area', async () => {
    const root = exampleRepo();
    const concepts = join(root, '.build', B, 'concepts');
    mkdirSync(join(concepts, 'kit'));
    writeFileSync(join(concepts, 'kit', 'a.css'), 'p{}');
    symlinkSync(join(concepts, 'kit'), join(concepts, 'kit-link'), 'junction');
    const s = await serve(root);
    expect((await fetch(`${s.assets}${B}/concepts/kit-link/a.css`)).status).toBe(200);
  });
  it('refuses a file outside the build when concepts/ itself is a link out of it', async () => {
    const root = exampleRepo();
    const outside = tempDir('nexus-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'not for the browser');
    const concepts = join(root, '.build', B, 'concepts');
    rmSync(concepts, { recursive: true, force: true });
    symlinkSync(outside, concepts, 'junction');
    const s = await serve(root);
    expect((await fetch(`${s.assets}${B}/concepts/secret.txt`)).status).toBe(403);
    expect((await fetch(`${s.url}api/builds/${B}/files/concepts/secret.txt`)).status).toBe(403);
  });
  it("the concept-page server's refusal doesn't speak of the cockpit", async () => {
    const s = await serve(exampleRepo());
    const res = await fetch(`${s.assets}${B}/concepts/..%2F..%2Fbuild.json`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/cockpit/i);
  });
});

describe("the cockpit's own files", () => {
  it('serves its non-HTML files sandboxed', async () => {
    const cockpit = join(tempDir('nexus-cockpit-'), 'cockpit');
    cpSync(join(ARTIFACTS, 'cockpit-placeholder'), cockpit, { recursive: true });
    writeFileSync(join(cockpit, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const s = await serve(exampleRepo(), cockpit);
    const res = await fetch(`${s.url}logo.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
