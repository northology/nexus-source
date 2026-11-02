import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { tempDir } from './helpers.ts';
import { STANDARD } from './vault-helpers.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const COMMIT = 'a'.repeat(40);

/** The bytes the stand-in mirror serves. */
export const FAKE = {
  plugin: { 'main.js': 'console.log("alpha")\n', 'manifest.json': '{"id":"alpha","version":"1.0.0"}\n' },
  theme: { 'theme.css': 'body{}\n', 'manifest.json': '{"name":"Plain"}\n' },
};

/** A copy of standard/ pinning one plugin and a theme, and a mirror folder serving their bytes at their URLs. */
export function testStandard(): { standard: string; mirror: string } {
  const standard = tempDir('nexus-standard-');
  cpSync(STANDARD, standard, { recursive: true });
  const mirror = tempDir('nexus-mirror-');
  const put = (url: string, text: string): void => {
    const path = join(mirror, ...url.replace(/^https:\/\//, '').split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const [name, text] of Object.entries(FAKE.plugin)) put(`https://github.com/example/alpha/releases/download/1.0.0/${name}`, text);
  for (const [name, text] of Object.entries(FAKE.theme)) put(`https://raw.githubusercontent.com/example/plain/${COMMIT}/${name}`, text);
  const pins = {
    plugins: [{ id: 'alpha', version: '1.0.0', repo: 'example/alpha', files: Object.entries(FAKE.plugin).map(([name, text]) => ({ name, sha256: sha(text) })) }],
    theme: { name: 'Plain', version: '1.0.0', repo: 'example/plain', commit: COMMIT, files: Object.entries(FAKE.theme).map(([name, text]) => ({ name, sha256: sha(text) })) },
  };
  mkdirSync(join(standard, 'obsidian'), { recursive: true });
  writeFileSync(join(standard, 'obsidian', 'plugins.json'), `${JSON.stringify(pins, null, 2)}\n`);
  return { standard, mirror };
}
