import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderContracts, replaceGenerated } from '../core/contracts-doc.ts';

const file = fileURLToPath(new URL('../reference/contracts.md', import.meta.url));
const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
writeFileSync(file, replaceGenerated(current, renderContracts()), 'utf8');
console.log('reference/contracts.md updated');
