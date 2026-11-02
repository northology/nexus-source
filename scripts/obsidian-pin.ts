// Maintainer-only, not shipped: pins standard/obsidian/plugins.json. Run by a person: `pnpm obsidian:pin --from-vault <.obsidian>`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { fetchBytes as networkBytes, HttpError, type Fetcher, type PinList, type PinnedFile } from '../core/init/obsidian.ts';
import { validate } from '../core/schemas.ts';
import { sha256 } from '../core/vault/generated.ts';

const REGISTRY = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD';
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** The hash of each file under base; an optional file is left out only when the server says it isn't there (404). */
async function files(base: string, names: string[], optional: string[], fetch: Fetcher): Promise<PinnedFile[]> {
  const out: PinnedFile[] = [];
  for (const name of [...names, ...optional]) {
    try {
      out.push({ name, sha256: sha256(await fetch(`${base}/${name}`)) });
    } catch (e) {
      const missing = optional.includes(name) && e instanceof HttpError && e.status === 404;
      if (!missing) throw new Error(`${base}/${name}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** The pinned list for the plugins and theme a shipped vault enables. Versions come from `from` (an installed .obsidian), else the latest release. */
export async function pinAll(opts: { vault: string; from: string | null }, fetchText: (url: string) => Promise<string>, fetch: Fetcher): Promise<PinList> {
  const ids = readJson(join(opts.vault, 'community-plugins.json')) as string[];
  const themeName = (readJson(join(opts.vault, 'appearance.json')) as { cssTheme?: string }).cssTheme ?? '';
  const plugins = JSON.parse(await fetchText(`${REGISTRY}/community-plugins.json`)) as { id: string; repo: string }[];
  const themes = JSON.parse(await fetchText(`${REGISTRY}/community-css-themes.json`)) as { name: string; repo: string }[];
  const pins: PinList = { plugins: [], theme: { name: themeName, version: '', repo: '', commit: '', files: [] } };
  for (const id of [...ids].sort()) {
    const repo = plugins.find((p) => p.id === id)?.repo;
    if (!repo) throw new Error(`${id} isn't in Obsidian's plugin registry`);
    const installed = opts.from ? join(opts.from, 'plugins', id, 'manifest.json') : '';
    const version = installed && existsSync(installed)
      ? String((readJson(installed) as { version?: string }).version)
      : String((JSON.parse(await fetchText(`https://api.github.com/repos/${repo}/releases/latest`)) as { tag_name?: string }).tag_name);
    pins.plugins.push({ id, version, repo, files: await files(`https://github.com/${repo}/releases/download/${version}`, ['main.js', 'manifest.json'], ['styles.css'], fetch) });
  }
  const repo = themes.find((t) => t.name === themeName)?.repo;
  if (!repo) throw new Error(`${themeName} isn't in Obsidian's theme registry`);
  const commit = String((JSON.parse(await fetchText(`https://api.github.com/repos/${repo}/commits/HEAD`)) as { sha?: string }).sha);
  const base = `https://raw.githubusercontent.com/${repo}/${commit}`;
  const manifest = JSON.parse(new TextDecoder().decode(await fetch(`${base}/manifest.json`))) as { version?: string };
  pins.theme = { name: themeName, version: String(manifest.version ?? ''), repo, commit, files: await files(base, ['theme.css', 'manifest.json'], [], fetch) };
  const problems = validate('obsidian-pins', pins);
  if (problems.length) throw new Error(`The pinned list doesn't validate: ${problems.join('; ')}`);
  return pins;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { 'from-vault': { type: 'string' } } });
  const standard = fileURLToPath(new URL('../standard/obsidian/', import.meta.url));
  const fetchText = async (url: string): Promise<string> => new TextDecoder().decode(await networkBytes(url));
  const pins = await pinAll({ vault: join(standard, 'vault'), from: values['from-vault'] ?? null }, fetchText, networkBytes);
  writeFileSync(join(standard, 'plugins.json'), `${JSON.stringify(pins, null, 2)}\n`);
  console.log(`pinned ${pins.plugins.length} plugins and the ${pins.theme.name} theme in standard/obsidian/plugins.json`);
}
