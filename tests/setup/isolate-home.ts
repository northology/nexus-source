import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach } from 'vitest';
import { removeTrackedTempDirsAsync } from './temp-dirs.ts';

/**
 * Runs in every Vitest worker before any test: the default inventoryEnv() (and any child process, which inherits
 * process.env) reads temporary folders, never the real home or managed folders.
 */
const cfgDir = mkdtempSync(join(tmpdir(), 'nexus-cfg-'));
const managedDir = mkdtempSync(join(tmpdir(), 'nexus-managed-'));
process.env['CLAUDE_CONFIG_DIR'] = cfgDir;
process.env['NEXUS_INVENTORY_MANAGED'] = managedDir;
process.env['NEXUS_INVENTORY_CEILING'] = tmpdir();


/**
 * Git too: global and system config point at an empty file and a fixed identity is set, so no test (or child process)
 * reads a developer's git settings.
 */
const emptyGitConfig = join(mkdtempSync(join(tmpdir(), 'nexus-gitcfg-')), 'empty');
writeFileSync(emptyGitConfig, '');
process.env['GIT_CONFIG_GLOBAL'] = emptyGitConfig;
process.env['GIT_CONFIG_SYSTEM'] = emptyGitConfig;
process.env['GIT_CONFIG_NOSYSTEM'] = '1';
process.env['GIT_AUTHOR_NAME'] = 'Test Author';
process.env['GIT_AUTHOR_EMAIL'] = 'author@example.com';
process.env['GIT_COMMITTER_NAME'] = 'Test Author';
process.env['GIT_COMMITTER_EMAIL'] = 'author@example.com';

// Remove only the folders this file made, after the last test in the file (the variables above stay valid until then).
afterAll(async () => {
  for (const dir of [cfgDir, managedDir, dirname(emptyGitConfig)]) rmSync(dir, { recursive: true, force: true });
  await removeTrackedTempDirsAsync();
});

// Many tests are fully synchronous (execFileSync), so a worker's event loop never turns between them. vitest 3.2.7 sends
// each test's update to the main process as an awaited request with a 60 s timeout; a file whose synchronous stretch
// passes that has its update rejected ("Timeout calling onTaskUpdate"). Yielding once after each test lets it through.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
