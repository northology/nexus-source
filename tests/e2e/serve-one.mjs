// Serves one build root on one port until killed: `node tests/e2e/serve-one.mjs <root> <port>`. The restart test
// runs it as a child process so it can stop the server and start a fresh one (with a new token) on the same port.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv, startE2eServer } from './e2e-server.ts';

const [root, port] = process.argv.slice(2);
if (!root || !port) throw new Error('usage: serve-one.mjs <root> <port>');
const cockpitDir = join(fileURLToPath(new URL('../../', import.meta.url)), 'cockpit', 'dist');
const s = await startE2eServer({ root, cockpitDir, port: Number(port), tries: 1, inventory: isolatedEnv() });
console.log(`nexus e2e one: ${s.url}`);
