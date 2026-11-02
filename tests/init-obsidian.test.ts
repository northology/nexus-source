import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { downloadAll, HttpError, httpFetcher, mirrorFetcher, pinnedDownloads, readPins } from '../core/init/obsidian.ts';
import { validate } from '../core/schemas.ts';
import { tempDir } from './helpers.ts';
import { FAKE, testStandard } from './init-helpers.ts';

describe('pinned downloads', () => {
  it('turns the pinned list into vault paths and release URLs', () => {
    const { standard } = testStandard();
    expect(pinnedDownloads(readPins(standard)).map((d) => [d.path, d.url])).toEqual([
      ['docs/.obsidian/plugins/alpha/main.js', 'https://github.com/example/alpha/releases/download/1.0.0/main.js'],
      ['docs/.obsidian/plugins/alpha/manifest.json', 'https://github.com/example/alpha/releases/download/1.0.0/manifest.json'],
      ['docs/.obsidian/themes/Plain/theme.css', `https://raw.githubusercontent.com/example/plain/${'a'.repeat(40)}/theme.css`],
      ['docs/.obsidian/themes/Plain/manifest.json', `https://raw.githubusercontent.com/example/plain/${'a'.repeat(40)}/manifest.json`],
    ]);
  });
  it('downloads every file and checks each hash', async () => {
    const { standard, mirror } = testStandard();
    const r = await downloadAll(pinnedDownloads(readPins(standard)), mirrorFetcher(mirror));
    expect(r.problems).toEqual([]);
    expect(new TextDecoder().decode(r.files.get('docs/.obsidian/plugins/alpha/main.js'))).toBe(FAKE.plugin['main.js']);
  });
  it('reports a hash mismatch and keeps nothing from that file', async () => {
    const { standard, mirror } = testStandard();
    writeFileSync(join(mirror, 'github.com', 'example', 'alpha', 'releases', 'download', '1.0.0', 'main.js'), 'tampered');
    const r = await downloadAll(pinnedDownloads(readPins(standard)), mirrorFetcher(mirror));
    expect(r.problems).toEqual([expect.stringMatching(/main\.js doesn't match its pinned hash/)]);
    expect(r.files.has('docs/.obsidian/plugins/alpha/main.js')).toBe(false);
    expect(r.unreachable).toBe(false);
  });
  it('says when a file could not be reached', async () => {
    const { standard } = testStandard();
    const r = await downloadAll(pinnedDownloads(readPins(standard)), mirrorFetcher(tempDir()));
    expect(r.problems).toHaveLength(4);
    expect(r.unreachable).toBe(true);
  });
  it('refuses an invalid pinned list', () => {
    const { standard } = testStandard();
    writeFileSync(join(standard, 'obsidian', 'plugins.json'), '{"plugins": []}');
    expect(() => readPins(standard)).toThrow(/pinned plugin list is invalid/);
  });
});

describe('fetch errors and limits', () => {
  it('says an HTTP error is an HTTP error, not a lost network', async () => {
    const { standard } = testStandard();
    const r = await downloadAll(pinnedDownloads(readPins(standard)).slice(0, 1), async () => {
      throw new HttpError(404);
    });
    expect(r.unreachable).toBe(false);
    expect(r.problems).toEqual([expect.stringMatching(/main\.js couldn't be downloaded: HTTP 404/)]);
  });
  it('gives up on a server that never answers', async () => {
    const server = createServer(() => {});
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(httpFetcher(100)(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/timed out after 0\.1s/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
  it('reports a missing page from the network fetcher as an HTTP error', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(httpFetcher(5000)(`http://127.0.0.1:${port}/x`)).rejects.toBeInstanceOf(HttpError);
    } finally {
      server.close();
    }
  });
  it('the mirror never reads outside its folder', async () => {
    const mirror = tempDir();
    await expect(mirrorFetcher(mirror)('https://github.com/../../outside')).rejects.toThrow(/outside the mirror/);
  });
  it('the pinned list refuses .. as a repo or version', () => {
    const sha = 'a'.repeat(64);
    const plugin = { id: 'x', version: '..', repo: 'a/b', files: [{ name: 'main.js', sha256: sha }] };
    const theme = { name: 'T', version: '1', repo: 'a/b', commit: 'b'.repeat(40), files: [{ name: 'theme.css', sha256: sha }] };
    expect(validate('obsidian-pins', { plugins: [plugin], theme })).not.toEqual([]);
    expect(validate('obsidian-pins', { plugins: [{ ...plugin, version: '1.0.0', repo: '../..' }], theme })).not.toEqual([]);
    expect(validate('obsidian-pins', { plugins: [{ ...plugin, version: '1.0.0' }], theme })).toEqual([]);
  });
});
