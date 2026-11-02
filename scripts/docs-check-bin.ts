// Entry for the bundled bin/docs-check.mjs. Like bin.ts, it always runs: no main-module check.
import { runDocsCheck } from './docs-check.ts';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

runDocsCheck(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readStdin,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`nexus docs-check: unexpected error: ${(e as Error).message}\n`);
    // A hook never fails the tool call it follows.
    process.exitCode = process.argv.includes('--hook') ? 0 : 1;
  },
);
