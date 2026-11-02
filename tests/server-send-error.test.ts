import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { startServer, type RunningServer } from '../server/server.ts';
import { isolatedEnv } from './governance-helpers.ts';
import { ARTIFACTS, exampleRepo, NOW, tempDir } from './helpers.ts';

// A file that goes between the stat and the open (a decommission while a document loads): its stream errors.
const gone = vi.hoisted(() => ({ name: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    createReadStream: (path: Parameters<typeof fs.createReadStream>[0], opts?: Parameters<typeof fs.createReadStream>[1]) => {
      if (gone.name && String(path).endsWith(gone.name)) {
        const stream = new Readable({ read() {} });
        queueMicrotask(() => stream.destroy(Object.assign(new Error(`ENOENT: no such file or directory, open '${String(path)}'`), { code: 'ENOENT' })));
        return stream as unknown as ReturnType<typeof fs.createReadStream>;
      }
      return fs.createReadStream(path, opts);
    },
  };
});

const open: RunningServer[] = [];
afterEach(async () => {
  gone.name = '';
  await Promise.all(open.splice(0).map((s) => s.close()));
});

describe('a build file that goes while it is sent', () => {
  it('ends the response without an unhandled error, and the server keeps serving', async () => {
    const s = await startServer({ root: exampleRepo(), cockpitDir: join(ARTIFACTS, 'cockpit-placeholder'), port: 0, now: () => NOW, inventory: { ...isolatedEnv(tempDir()), ceiling: tmpdir() } });
    open.push(s);
    gone.name = 'relay-rebuild-spec.md';
    const failed = await fetch(`${s.url}api/builds/relay-rebuild/files/documents/specs/relay-rebuild-spec.md`).then(
      (res) => res.text().then(() => 'ended', () => 'ended'),
      () => 'ended',
    );
    expect(failed).toBe('ended');
    gone.name = '';
    expect((await fetch(`${s.url}api/builds/relay-rebuild/files/documents/specs/relay-rebuild-spec.md`)).status).toBe(200);
  });
});
