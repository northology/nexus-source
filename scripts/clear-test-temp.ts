// Lists, and with --delete removes, the folders nexus's tests leave in the system temp folder: one-off cleanup for runs
// made before the tests removed their own. `node scripts/clear-test-temp.ts [--delete]`.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** mkdtemp's names: a nexus- prefix of lowercase words, then six random letters and digits. */
const TEST_FOLDER = /^(nexus-(?:[a-z0-9]+-)*)[A-Za-z0-9]{6}$/;

/**
 * The test folders directly in `dir`, grouped by prefix. Files and other names are left out, and so is any folder
 * changed at or after `before` (a time in ms), which a test run may still be using.
 */
export function testTempFolders(dir: string, before = Infinity): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const m = e.isDirectory() ? TEST_FOLDER.exec(e.name) : null;
    if (!m?.[1]) continue;
    if (before !== Infinity && statSync(join(dir, e.name)).mtimeMs >= before) continue;
    groups.set(m[1], [...(groups.get(m[1]) ?? []), join(dir, e.name)]);
  }
  return groups;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Folders changed in the last hour may belong to a test run still going: they wait for the next clearing.
  const groups = testTempFolders(tmpdir(), Date.now() - 3600_000);
  const remove = process.argv.includes('--delete');
  let total = 0;
  let left = 0;
  for (const [prefix, folders] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${prefix.padEnd(28)} ${folders.length}`);
    total += folders.length;
    if (!remove) continue;
    for (const f of folders) {
      try {
        rmSync(f, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        left += 1;
      }
    }
  }
  console.log(`${total} folders in ${tmpdir()}${remove ? `: ${total - left} removed, ${left} left` : '; run with --delete to remove them'}`);
}
