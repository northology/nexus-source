import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replaceGuide } from './guide-doc.ts';

const file = fileURLToPath(new URL('../reference/guide/commands.md', import.meta.url));
const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
writeFileSync(file, replaceGuide(current), 'utf8');
console.log('reference/guide/commands.md updated');
