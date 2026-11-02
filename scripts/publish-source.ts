// `pnpm snapshot <clone of the public repository> [--check]`: writes the public source snapshot there (see
// source-snapshot.ts), or with --check only scans it. Commit and push the clone yourself, as README "Releasing" says.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSnapshot, writeSnapshot } from './source-snapshot.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const dest = args.find((a) => !a.startsWith('--'));
try {
  if (check) {
    const found = scanSnapshot(root);
    if (found.length) throw new Error(`internal names in the snapshot:\n${found.join('\n')}`);
    console.log('snapshot scan: clean');
  } else {
    if (!dest) throw new Error('Use: pnpm snapshot <clone of the public repository> [--check]');
    const files = writeSnapshot(root, resolve(dest));
    console.log(`wrote ${files.length} files to ${resolve(dest)}; commit and push it there`);
  }
} catch (e) {
  console.error(`nexus snapshot: ${(e as Error).message}`);
  process.exit(1);
}
