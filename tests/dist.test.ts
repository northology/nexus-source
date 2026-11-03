import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS, tempDir, readJsonFile } from './helpers.ts';
import { STANDARD } from './vault-helpers.ts';
import { REGISTRY_ENTRIES } from '../core/init/standard.ts';
import { testStandard } from './init-helpers.ts';

let plugin = '';
let codexPkg = '';
let agyPkg = '';
const node = (args: string[], cwd: string, input?: string) =>
  spawnSync(process.execPath, [join(plugin, 'bin', 'nexus.mjs'), ...args], { cwd, input, encoding: 'utf8' });
const run = (pkg: string, bin: string, args: string[], cwd: string, input?: string) =>
  spawnSync(process.execPath, [join(pkg, 'bin', bin), ...args], { cwd, input, encoding: 'utf8' });
/** Every file under dir, relative, with forward slashes. */
const files = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));

beforeAll(() => {
  // build.mjs needs the compiled cockpit; a fresh checkout has none (dist/ is ignored), so build it once here.
  if (!existsSync(join(ARTIFACTS, 'cockpit', 'dist', 'index.html'))) {
    execFileSync(process.execPath, [join(ARTIFACTS, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'cockpit/vite.config.ts'], { cwd: ARTIFACTS, stdio: 'pipe' });
  }
  execFileSync(process.execPath, ['build.mjs'], { cwd: ARTIFACTS, stdio: 'pipe' });
  // Copy outside the repo so no node_modules can be found above it.
  plugin = join(tempDir('nexus-dist-'), 'nexus');
  cpSync(join(ARTIFACTS, 'dist', 'nexus'), plugin, { recursive: true });
  codexPkg = join(tempDir('nexus-dist-'), 'nexus-codex');
  cpSync(join(ARTIFACTS, 'dist', 'nexus-codex'), codexPkg, { recursive: true });
  agyPkg = join(tempDir('nexus-dist-'), 'nexus-antigravity');
  cpSync(join(ARTIFACTS, 'dist', 'nexus-antigravity'), agyPkg, { recursive: true });
}, 180_000);

const USER_ONLY = ['decommission', 'grill-me', 'init', 'plan'];
const VERSION = (readJsonFile(join(ARTIFACTS, '.claude-plugin', 'plugin.json')) as { version: string }).version;
type Hook = { type: string; command: string; commandWindows?: string; args?: unknown; timeout: number };

describe('the Claude Code package', () => {
  it('ships the skills as they are written, and names its harness', () => {
    for (const s of [...USER_ONLY, 'nexus']) {
      expect(readFileSync(join(plugin, 'skills', s, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(ARTIFACTS, 'skills', s, 'SKILL.md'), 'utf8'));
    }
    expect(node(['doctor', 'guard'], tempDir()).stdout).toMatch(/^Harness: Claude Code\. /);
  });
});

describe('the Codex package', () => {
  it('has a .codex-plugin manifest named nexus at this version, and no Claude Code one', () => {
    expect(readJsonFile(join(codexPkg, '.codex-plugin', 'plugin.json'))).toMatchObject({ name: 'nexus', version: VERSION });
    expect(existsSync(join(codexPkg, '.claude-plugin'))).toBe(false);
    expect(existsSync(join(codexPkg, 'bin', 'guard-core.mjs'))).toBe(true);
  });
  it("has hooks in Codex's form: one command string with ${PLUGIN_ROOT}, a matching commandWindows, no args", () => {
    const hooks = (readJsonFile(join(codexPkg, 'hooks', 'hooks.json')) as { hooks: Record<string, { matcher?: string; hooks: Hook[] }[]> }).hooks;
    expect(Object.keys(hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'UserPromptSubmit']);
    const all = Object.values(hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
    for (const h of all) {
      expect(h.command).toMatch(/^node "\$\{PLUGIN_ROOT\}\/bin\/[a-z-]+\.mjs"/);
      expect(h.commandWindows).toBe(h.command);
      expect(h.args).toBeUndefined();
    }
    expect(hooks['PreToolUse']?.[0]?.matcher?.split('|')).toEqual(expect.arrayContaining(['apply_patch', 'Bash']));
    expect(hooks['PostToolUse']?.[0]?.matcher).toBe('apply_patch');
  });
  it('marks each user-only skill with agents/openai.yaml, and no other', () => {
    for (const s of USER_ONLY) expect(readFileSync(join(codexPkg, 'skills', s, 'agents', 'openai.yaml'), 'utf8')).toMatch(/^policy:\n {2}allow_implicit_invocation: false$/m);
    expect(existsSync(join(codexPkg, 'skills', 'nexus', 'agents'))).toBe(false);
  });
  it('rewrites the skills: no ${CLAUDE_PLUGIN_ROOT}, the CLI by a relative path, skills named as Codex starts them', () => {
    for (const f of files(join(codexPkg, 'skills')).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(join(codexPkg, 'skills', f), 'utf8');
      expect(text, f).not.toContain('${CLAUDE_PLUGIN_ROOT}');
      expect(text, f).not.toMatch(/\/nexus:/);
    }
    expect(readFileSync(join(codexPkg, 'skills', 'plan', 'SKILL.md'), 'utf8')).toContain('node "../../bin/nexus.mjs" <command>');
  });
  it('names its harness, and its guard refuses a patch with one protected file', () => {
    expect(run(codexPkg, 'nexus.mjs', ['doctor', 'guard'], tempDir()).stdout).toMatch(/^Harness: Codex\. /);
    const repo = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], repo);
    const patch = `*** Begin Patch\n*** Update File: notes.txt\n@@\n+x\n*** Update File: CLAUDE.md\n@@\n+x\n*** End Patch`;
    const r = run(codexPkg, 'guard.mjs', [], repo, JSON.stringify({ cwd: repo, tool_name: 'apply_patch', tool_input: { command: patch } }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('CLAUDE.md') });
  });
  it('speaks the plan skill as $nexus:plan in its prompt hook', () => {
    const repo = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], repo);
    node(['stage', 'plan'], repo);
    node(['stage', 'build'], repo);
    const out = run(codexPkg, 'nexus.mjs', ['hook'], repo, JSON.stringify({ cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'x' })).stdout;
    expect(out).toContain('finish → $nexus:plan step 5');
  });
});

describe('the Antigravity package', () => {
  const ALLOWED = ['$schema', 'name', 'displayName', 'description', 'version', 'disabled', 'logo', 'suggestedPrompts', 'skills', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  it('has a .antigravity-plugin manifest with only the keys Antigravity allows', () => {
    const manifest = readJsonFile(join(agyPkg, '.antigravity-plugin', 'plugin.json')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ name: 'nexus', version: VERSION });
    expect(Object.keys(manifest).filter((k) => !ALLOWED.includes(k))).toEqual([]);
    expect(existsSync(join(agyPkg, '.claude-plugin'))).toBe(false);
  });
  it('carries its logo', () => {
    const manifest = readJsonFile(join(agyPkg, '.antigravity-plugin', 'plugin.json')) as Record<string, unknown>;
    expect(manifest['logo']).toBe('assets/logo.svg');
    expect(readFileSync(join(agyPkg, 'assets', 'logo.svg'), 'utf8')).toMatch(/^<svg [^>]*viewBox="0 0 256 256"/);
  });
  it('has a root hooks.json with a named group, commands relative to the plugin root, and no PostToolUse', () => {
    const groups = readJsonFile(join(agyPkg, 'hooks.json')) as Record<string, Record<string, unknown>>;
    expect(Object.keys(groups)).toEqual(['nexus']);
    const g = groups['nexus'] as { enabled: boolean; PreInvocation: Hook[]; PreToolUse: { matcher: string; hooks: Hook[] }[]; PostToolUse?: unknown };
    expect(g.enabled).toBe(true);
    expect(g.PostToolUse).toBeUndefined();
    expect(g.PreInvocation.map((h) => h.command)).toEqual(['node ./bin/nexus.mjs hook']);
    expect(g.PreToolUse[0]?.hooks.map((h) => h.command)).toEqual(['node ./bin/guard.mjs']);
    expect(g.PreToolUse[0]?.matcher.split('|')).toEqual(expect.arrayContaining(['write_file', 'edit_file', 'run_command']));
    expect(existsSync(join(agyPkg, 'hooks'))).toBe(false);
  });
  it('keeps disable-model-invocation and rewrites ${CLAUDE_PLUGIN_ROOT} away', () => {
    for (const s of USER_ONLY) expect(readFileSync(join(agyPkg, 'skills', s, 'SKILL.md'), 'utf8')).toMatch(/^disable-model-invocation: true$/m);
    for (const f of files(join(agyPkg, 'skills'))) expect(readFileSync(join(agyPkg, 'skills', f), 'utf8'), f).not.toContain('${CLAUDE_PLUGIN_ROOT}');
  });
  it('names its harness, and its guard answers a protected write with a deny', () => {
    expect(run(agyPkg, 'nexus.mjs', ['doctor', 'guard'], tempDir()).stdout).toMatch(/^Harness: Antigravity\. /);
    const repo = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], repo);
    const r = run(agyPkg, 'guard.mjs', [], agyPkg, JSON.stringify({ workspacePaths: [repo], toolCall: { name: 'write_file', args: { Path: join(repo, 'CLAUDE.md') } } }));
    expect([r.status, JSON.parse(r.stdout).decision]).toEqual([0, 'deny']);
  });
});

describe('every package', () => {
  it('carries the same bin, reference, schemas, standard, cockpit, README and CHANGELOG', () => {
    for (const pkg of [codexPkg, agyPkg]) {
      for (const dir of ['reference', 'schemas', 'standard', 'cockpit']) expect(files(join(pkg, dir)), `${pkg} ${dir}`).toEqual(files(join(plugin, dir)));
      for (const f of ['README.md', 'CHANGELOG.md']) expect(readFileSync(join(pkg, f), 'utf8')).toBe(readFileSync(join(plugin, f), 'utf8'));
      expect(files(join(pkg, 'bin'))).toEqual(files(join(plugin, 'bin')));
    }
  });
});

describe('compiled plugin', () => {
  it('has the plugin layout', () => {
    expect(readJsonFile(join(plugin, '.claude-plugin', 'plugin.json'))).toMatchObject({ name: 'nexus' });
    for (const p of ['skills/nexus/SKILL.md', 'reference/contracts.md', 'reference/examples/.build/relay-rebuild/build.json', 'schemas/build.schema.json', 'hooks/hooks.json', 'bin/nexus.mjs', 'cockpit/index.html']) {
      expect(existsSync(join(plugin, p)), p).toBe(true);
    }
    expect(existsSync(join(plugin, 'node_modules'))).toBe(false);
  });
  it('ships its README and changelog, and a manifest folder holding only plugin.json', () => {
    for (const p of ['README.md', 'CHANGELOG.md']) expect(existsSync(join(plugin, p)), p).toBe(true);
    // The source folder also holds the nexus marketplace's manifest, which must not travel into the plugin.
    expect(readdirSync(join(plugin, '.claude-plugin'))).toEqual(['plugin.json']);
    expect(readJsonFile(join(plugin, '.claude-plugin', 'plugin.json'))).not.toMatchObject({ description: expect.stringContaining('removed at close-out') });
  });
  it('ships the built cockpit, not the placeholder', () => {
    expect(readdirSync(join(plugin, 'cockpit', 'assets')).some((f) => f.endsWith('.js'))).toBe(true);
  });
  it('refuses to build without the compiled cockpit', () => {
    const r = spawnSync(process.execPath, [join(ARTIFACTS, 'build.mjs')], { cwd: tempDir('nexus-nocockpit-'), encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/cockpit\/dist\/index\.html is missing; run `pnpm cockpit` first/);
  });
  it('runs a build round trip with no installed dependencies', () => {
    const repo = tempDir('nexus-repo-');
    expect(node(['new', 'trial-run', '--branch', 'build/trial-run', '--summary', 'Smoke test'], repo).status).toBe(0);
    expect(node(['log', 'add', 'questions', 'first-question', '--text', 'Does it run?', '--status', 'exploring', '--source', 'test'], repo).status).toBe(0);
    const check = node(['check'], repo);
    expect(check.status, check.stderr).toBe(0);
  });
  it('runs when the plugin is reached through a junction or symlink', () => {
    const link = join(tempDir('nexus-link-'), 'linked');
    symlinkSync(plugin, link, 'junction');
    const r = spawnSync(process.execPath, [join(link, 'bin', 'nexus.mjs'), '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage/);
  });
  it('the hook is silent outside a build and never fails', () => {
    const r = node(['hook'], tempDir(), JSON.stringify({ cwd: tempDir() }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(node(['hook'], tempDir(), 'garbage').status).toBe(0);
  });
  it('the guard is fast and silent outside a build', () => {
    const cwd = tempDir();
    node(['guard'], cwd, '{}');
    const started = performance.now();
    const r = node(['guard'], cwd, JSON.stringify({ cwd, tool_name: 'Write', tool_input: { file_path: join(cwd, 'CLAUDE.md') } }));
    const ms = performance.now() - started;
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(ms).toBeLessThan(1500);
  });
  it('the guard denies a protected write during a build', () => {
    const repo = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], repo);
    const r = node(['guard'], repo, JSON.stringify({ cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, 'CLAUDE.md') } }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(node(['guard'], repo, 'garbage').status).toBe(0);
  });
  const loader = (cwd: string, input: unknown, pluginDir = plugin) =>
    spawnSync(process.execPath, [join(pluginDir, 'bin', 'guard.mjs')], { cwd, input: JSON.stringify(input), encoding: 'utf8' });
  it('the hook entry is the loader, which imports only Node modules', () => {
    expect(readJsonFile(join(plugin, 'hooks', 'hooks.json'))).toMatchObject({ hooks: { PreToolUse: [{ hooks: [{ args: ['${CLAUDE_PLUGIN_ROOT}/bin/guard.mjs'] }] }] } });
    const text = readFileSync(join(plugin, 'bin', 'guard.mjs'), 'utf8');
    const sources = [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((s) => !s.startsWith('node:'))).toEqual([]);
  });
  it('the loader denies a protected write, and walls another repo from a folder with no build', () => {
    const repo = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], repo);
    const r = loader(repo, { cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, 'CLAUDE.md') } });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const away = tempDir();
    const r2 = loader(away, { cwd: away, tool_name: 'Write', tool_input: { file_path: join(repo, 'CLAUDE.md') } });
    expect(JSON.parse(r2.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(loader(away, { cwd: away, tool_name: 'Write', tool_input: { file_path: join(away, 'CLAUDE.md') } }).stdout).toBe('');
  });
  it('a broken guard bundle refuses only where a build is in progress', () => {
    const broken = join(tempDir('nexus-broken-'), 'nexus');
    cpSync(plugin, broken, { recursive: true });
    writeFileSync(join(broken, 'bin', 'guard-core.mjs'), 'throw new Error("broken bundle");');
    const live = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], live);
    const r = loader(live, { cwd: live, tool_name: 'Write', tool_input: { file_path: join(live, 'src.ts') } }, broken);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/nexus wall couldn't run.*broken bundle/s);
    const none = tempDir();
    const quiet = loader(none, { cwd: none, tool_name: 'Bash', tool_input: { command: 'rm x' } }, broken);
    expect([quiet.status, quiet.stdout, quiet.stderr]).toEqual([0, '', '']);
  });
  it('doctor guard finds the guard bundle and runs the hook entry', () => {
    const r = node(['doctor', 'guard'], tempDir());
    expect(r.stdout, r.stderr).toMatch(/ok\s+the guard bundle loads/);
    expect(r.stdout, r.stderr).toMatch(/ok\s+the hook entry runs/);
  });
  it('doctor guard fails when the hook entry is broken', () => {
    const broken = join(tempDir('nexus-broken-entry-'), 'nexus');
    cpSync(plugin, broken, { recursive: true });
    writeFileSync(join(broken, 'bin', 'guard.mjs'), 'throw new Error("broken entry");');
    const r = spawnSync(process.execPath, [join(broken, 'bin', 'nexus.mjs'), 'doctor', 'guard'], { cwd: tempDir(), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL\s+The hook entry didn't run/);
  });
  it('serves the cockpit and the API', async () => {
    const repo = tempDir('nexus-repo-');
    node(['new', 'trial-run', '--branch', 'b'], repo);
    const child = spawn(process.execPath, [join(plugin, 'bin', 'nexus.mjs'), 'serve', '--port', '0'], { cwd: repo });
    try {
      const printed = await new Promise<{ url: string; assets: string }>((done, fail) => {
        let text = '';
        child.stdout.on('data', (d: Buffer) => {
          text += d.toString();
          const url = /nexus cockpit: (\S+)/.exec(text)?.[1];
          const assets = /nexus concept pages: (\S+)/.exec(text)?.[1];
          if (url && assets) done({ url, assets });
        });
        child.on('exit', () => fail(new Error('server exited')));
        setTimeout(() => fail(new Error('no url printed')), 10_000);
      });
      const url = printed.url;
      expect(await (await fetch(`${url}api/builds`)).json()).toMatchObject({ builds: ['trial-run'], assets: printed.assets });
      expect((await fetch(url)).status).toBe(200);
    } finally {
      child.kill();
    }
  });
  const vault = (files: Record<string, string> = {}) => {
    const repo = tempDir('nexus-dist-vault-');
    for (const e of REGISTRY_ENTRIES) cpSync(join(STANDARD, e), join(repo, 'docs', '_meta', e), { recursive: true });
    cpSync(join(ARTIFACTS, 'tests', 'fixtures', 'vaults', 'clean', 'docs'), join(repo, 'docs'), { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(repo, rel, '..'), { recursive: true });
      writeFileSync(join(repo, rel), text);
    }
    return repo;
  };
  it('runs docs-check.mjs on its own, from an empty folder with nothing beside it', () => {
    const alone = tempDir('nexus-alone-');
    copyFileSync(join(plugin, 'bin', 'docs-check.mjs'), join(alone, 'docs-check.mjs'));
    const clean = spawnSync(process.execPath, [join(alone, 'docs-check.mjs'), vault()], { cwd: alone, encoding: 'utf8' });
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout.trim().split('\n').at(-1)).toBe('14 notes checked: 0 blocking, 0 warnings');
    const bad = spawnSync(process.execPath, [join(alone, 'docs-check.mjs'), vault({ 'docs/dev/context/x.md': '# no class\n' })], { cwd: alone, encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/class-missing/);
  });
  it('docs-check.mjs imports only Node modules', () => {
    const text = readFileSync(join(plugin, 'bin', 'docs-check.mjs'), 'utf8');
    const sources = [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    expect(sources.filter((s) => !s.startsWith('node:'))).toEqual([]);
  });
  it('the docs hook blocks a bad note and stays silent and successful on garbage', () => {
    const repo = vault({ 'docs/dev/context/x.md': '# no class\n' });
    const hook = (input: string) => spawnSync(process.execPath, [join(plugin, 'bin', 'docs-check.mjs'), '--hook'], { cwd: repo, input, encoding: 'utf8' });
    const r = hook(JSON.stringify({ cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, 'docs', 'dev', 'context', 'x.md') } }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'block' });
    const g = hook('garbage');
    expect(g.status).toBe(0);
    expect(g.stdout).toBe('');
  });
  it('doctor docs passes in a vault with the compiled plugin', () => {
    const r = node(['doctor', 'docs'], vault());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/ok {4}the docs-check bundle runs/);
    expect(r.stdout).toMatch(/ok {4}the registry reads: 24 classes, contract 3/);
  });
  it('ships the baseline standard', () => {
    for (const p of ['standard/contract.md', 'standard/tags.md', 'standard/components.md', 'standard/classes/decision.md']) {
      expect(existsSync(join(plugin, p)), p).toBe(true);
    }
    expect(readdirSync(join(plugin, 'standard', 'classes'))).toHaveLength(24);
  });
  it('runs init from the built plugin in an empty folder, then obsidian install from a mirror', () => {
    const repo = tempDir('nexus-dist-init-');
    const init = node(['init', '--no-plugins'], repo);
    expect(init.status, init.stderr).toBe(0);
    expect(init.stdout.trim().split('\n').at(-1)).toBe('0 notes checked: 0 blocking, 0 warnings');
    const s = testStandard();
    const r = spawnSync(process.execPath, [join(plugin, 'bin', 'nexus.mjs'), 'obsidian', 'install'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NEXUS_STANDARD_DIR: s.standard, NEXUS_OBSIDIAN_MIRROR: s.mirror },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n').at(-1)).toBe('0 pinned files in place, 4 downloaded');
  });
  it('ships the Obsidian baseline, the pinned list and the CLAUDE.md block', () => {
    for (const p of ['standard/claude-block.md', 'standard/obsidian/plugins.json', 'standard/obsidian/vault/app.json', 'standard/obsidian/vault/plugins/dataview/data.json']) {
      expect(existsSync(join(plugin, p)), p).toBe(true);
    }
  });
  it('registers the docs hook in the shipped hooks.json', () => {
    expect(readJsonFile(join(plugin, 'hooks', 'hooks.json'))).toMatchObject({ hooks: { PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ args: ['${CLAUDE_PLUGIN_ROOT}/bin/docs-check.mjs', '--hook'] }] }] } });
  });
});
