// Serves one build root on one port until killed: `node tests/e2e/serve-one.mjs <root> <port>`. The restart test
// runs it as a child process so it can stop the server and start a fresh one (with a new token) on the same port.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv, startE2eServer } from './e2e-server.ts';

const [root, port] = process.argv.slice(2);
if (!root || !port) throw new Error('usage: serve-one.mjs <root> <port>');
const cockpitDir = join(fileURLToPath(new URL('../../', import.meta.url)), 'cockpit', 'dist');
const inventory = isolatedEnv();
const s = await startE2eServer({ root, cockpitDir, port: Number(port), tries: 1, inventory });
// The parent kills this process, so it removes the temporary home named here once the server has stopped.
console.log(`nexus e2e one: ${s.url} home=${dirname(inventory.home)}`);
