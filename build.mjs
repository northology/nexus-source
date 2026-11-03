import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rewriteSkill, userOnly } from './scripts/harness-wording.ts';

// The plugin must ship the real cockpit. Check before touching dist/, so a failed build leaves the last one alone.
if (!existsSync('cockpit/dist/index.html')) {
  console.error('nexus build: cockpit/dist/index.html is missing; run `pnpm cockpit` first (or `pnpm build`, which does both).');
  process.exit(1);
}

// One package per harness, from the same source. Each bundle carries its harness as a build-time constant
// (core/harness.ts); Claude Code's is left undefined, so its bundles are what they were before there were others.
const PACKAGES = [
  { harness: 'claude-code', out: 'dist/nexus' },
  { harness: 'codex', out: 'dist/nexus-codex' },
  { harness: 'antigravity', out: 'dist/nexus-antigravity' },
];

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  banner: { js: "import { createRequire as __nexusRequire } from 'node:module'; const require = __nexusRequire(import.meta.url);" },
  logLevel: 'warning',
};
const source = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
const json = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

for (const { harness, out } of PACKAGES) {
  rmSync(out, { recursive: true, force: true });
  const opts = harness === 'claude-code' ? common : { ...common, define: { __NEXUS_HARNESS__: JSON.stringify(harness) } };
  await build({ ...opts, entryPoints: ['scripts/bin.ts'], outfile: `${out}/bin/nexus.mjs` });
  // The wall: a loader with no dependencies of its own (the PreToolUse entry), and the guard it loads at run time.
  await build({ ...opts, entryPoints: ['scripts/guard-core.ts'], outfile: `${out}/bin/guard-core.mjs` });
  await build({ ...opts, entryPoints: ['scripts/guard-loader.ts'], outfile: `${out}/bin/guard.mjs` });
  // The docs vault checker, alone: the PostToolUse hook runs it, and repos can run it in pre-commit or CI.
  await build({ ...opts, entryPoints: ['scripts/docs-check-bin.ts'], outfile: `${out}/bin/docs-check.mjs` });

  // standard/ is the baseline vault standard that phase-2's init copies into repos.
  for (const dir of ['skills', 'reference', 'schemas', 'standard']) {
    cpSync(dir, `${out}/${dir}`, { recursive: true });
  }
  for (const doc of ['README.md', 'CHANGELOG.md']) cpSync(doc, `${out}/${doc}`);
  cpSync('cockpit/dist', `${out}/cockpit`, { recursive: true });

  if (harness === 'claude-code') {
    // Only the plugin's own manifest: .claude-plugin/ here also holds the nexus marketplace's, which stays behind.
    mkdirSync(`${out}/.claude-plugin`, { recursive: true });
    cpSync('.claude-plugin/plugin.json', `${out}/.claude-plugin/plugin.json`);
    mkdirSync(`${out}/hooks`, { recursive: true });
    cpSync('hooks/hooks.json', `${out}/hooks/hooks.json`);
    continue;
  }
  // The other harnesses run the CLI by a path relative to the skill, and Codex starts a skill as $nexus:<skill>.
  for (const skill of readdirSync(`${out}/skills`)) {
    const file = `${out}/skills/${skill}/SKILL.md`;
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, rewriteSkill(text, harness));
    // Codex reads user-only from agents/openai.yaml; Antigravity keeps Claude Code's disable-model-invocation.
    if (harness === 'codex' && userOnly(text)) {
      mkdirSync(`${out}/skills/${skill}/agents`, { recursive: true });
      cpSync('harness/codex/openai.yaml', `${out}/skills/${skill}/agents/openai.yaml`);
    }
  }
  if (harness === 'codex') {
    mkdirSync(`${out}/.codex-plugin`, { recursive: true });
    json(`${out}/.codex-plugin/plugin.json`, { name: source.name, version: source.version, description: source.description, author: source.author });
    mkdirSync(`${out}/hooks`, { recursive: true });
    cpSync('harness/codex/hooks.json', `${out}/hooks/hooks.json`);
  } else {
    // Antigravity rejects keys its schema doesn't list, and runs hooks from the plugin's folder.
    mkdirSync(`${out}/.antigravity-plugin`, { recursive: true });
    json(`${out}/.antigravity-plugin/plugin.json`, { name: source.name, displayName: source.name, version: source.version, description: source.description, logo: 'assets/logo.svg' });
    mkdirSync(`${out}/assets`, { recursive: true });
    cpSync('harness/antigravity/logo.svg', `${out}/assets/logo.svg`);
    cpSync('harness/antigravity/hooks.json', `${out}/hooks.json`);
  }
}

console.log(`built ${PACKAGES.map((p) => p.out).join(', ')}`);
