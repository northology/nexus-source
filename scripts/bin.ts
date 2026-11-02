// Entry point for the bundled bin/nexus.mjs. It always runs main(): no "am I the main module?" check, which
// breaks when the plugin is reached through a symlink or junction.
import { defaultIO, main } from './cli.ts';

main(process.argv.slice(2), defaultIO()).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`nexus: unexpected error: ${(e as Error).stack ?? String(e)}
`);
    process.exitCode = ['hook', 'guard'].includes(process.argv[2] ?? '') ? 0 : 1;
  },
);
