import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pinAll } from '../scripts/obsidian-pin.ts';
import { validate } from '../core/schemas.ts';
import { HttpError } from '../core/init/obsidian.ts';
import { tempDir } from './helpers.ts';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const COMMIT = 'c'.repeat(40);

function setup() {
  const vault = tempDir('nexus-pin-vault-');
  writeFileSync(join(vault, 'community-plugins.json'), JSON.stringify(['alpha']));
  writeFileSync(join(vault, 'appearance.json'), JSON.stringify({ cssTheme: 'Plain' }));
  const from = tempDir('nexus-pin-from-');
  mkdirSync(join(from, 'plugins', 'alpha'), { recursive: true });
  writeFileSync(join(from, 'plugins', 'alpha', 'manifest.json'), JSON.stringify({ id: 'alpha', version: '2.0.0' }));
  const texts: Record<string, string> = {
    'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json': JSON.stringify([{ id: 'alpha', repo: 'example/alpha' }]),
    'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json': JSON.stringify([{ name: 'Plain', repo: 'example/plain' }]),
    'https://api.github.com/repos/example/plain/commits/HEAD': JSON.stringify({ sha: COMMIT }),
  };
  const bytes: Record<string, string> = {
    'https://github.com/example/alpha/releases/download/2.0.0/main.js': 'main',
    'https://github.com/example/alpha/releases/download/2.0.0/manifest.json': '{"version":"2.0.0"}',
    [`https://raw.githubusercontent.com/example/plain/${COMMIT}/theme.css`]: 'css',
    [`https://raw.githubusercontent.com/example/plain/${COMMIT}/manifest.json`]: '{"version":"1.2.3"}',
  };
  const fetchText = async (url: string): Promise<string> => {
    const t = texts[url];
    if (t === undefined) throw new Error(`HTTP 404 ${url}`);
    return t;
  };
  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    const t = bytes[url];
    if (t === undefined) throw new HttpError(404);
    return new TextEncoder().encode(t);
  };
  return { vault, from, fetchText, fetchBytes, bytes };
}

describe('pinAll', () => {
  it('pins each plugin at the version installed in the vault given, and the theme at a commit', async () => {
    const s = setup();
    const pins = await pinAll({ vault: s.vault, from: s.from }, s.fetchText, s.fetchBytes);
    expect(validate('obsidian-pins', pins)).toEqual([]);
    expect(pins).toEqual({
      plugins: [{ id: 'alpha', version: '2.0.0', repo: 'example/alpha', files: [{ name: 'main.js', sha256: sha('main') }, { name: 'manifest.json', sha256: sha('{"version":"2.0.0"}') }] }],
      theme: { name: 'Plain', version: '1.2.3', repo: 'example/plain', commit: COMMIT, files: [{ name: 'theme.css', sha256: sha('css') }, { name: 'manifest.json', sha256: sha('{"version":"1.2.3"}') }] },
    });
  });
  it('leaves out a styles.css only when it is really missing, not when the fetch failed', async () => {
    const s = setup();
    const flaky = async (url: string): Promise<Uint8Array> => {
      if (url.endsWith('/styles.css')) throw new Error('socket hang up');
      return s.fetchBytes(url);
    };
    await expect(pinAll({ vault: s.vault, from: s.from }, s.fetchText, flaky)).rejects.toThrow(/styles\.css: socket hang up/);
  });
  it('names a plugin the registry does not know', async () => {
    const s = setup();
    writeFileSync(join(s.vault, 'community-plugins.json'), JSON.stringify(['alpha', 'ghost']));
    await expect(pinAll({ vault: s.vault, from: s.from }, s.fetchText, s.fetchBytes)).rejects.toThrow(/ghost isn't in Obsidian's plugin registry/);
  });
});
