import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS, commandName, GROUPS } from '../scripts/commands.ts';
import { strayFlag, USAGE } from '../scripts/cli.ts';
import { ARTIFACTS } from './helpers.ts';

describe('the command table', () => {
  it('builds --help exactly as it was', () => {
    expect(USAGE).toBe(readFileSync(join(ARTIFACTS, 'tests', 'fixtures', 'usage.txt'), 'utf8').replace(/\r\n/g, '\n'));
  });
  it('has an entry for every command the CLI handles, and no others', () => {
    const cli = readFileSync(join(ARTIFACTS, 'scripts', 'cli.ts'), 'utf8');
    const handled = new Set([...cli.matchAll(/cmd === '([a-z][a-z-]*)'|case '([a-z][a-z-]*)':/g)].map((m) => m[1] ?? m[2]));
    const tabled = new Set(COMMANDS.map((c) => commandName(c).split(' ')[0]));
    expect([...tabled].sort()).toEqual([...handled].sort());
  });
  it('has an entry for every sub-command the CLI handles', () => {
    const cli = readFileSync(join(ARTIFACTS, 'scripts', 'cli.ts'), 'utf8');
    const subs = new Set([...cli.matchAll(/(?:rest\[0\]|action) [!=]== '([a-z][a-z-]*)'/g)].map((m) => m[1]));
    expect(subs.size).toBeGreaterThan(10);
    const seconds = new Set(COMMANDS.map((c) => commandName(c).split(' ')[1]).filter(Boolean));
    expect([...subs].filter((s) => !seconds.has(s))).toEqual([]);
  });
  it('gives every entry a group, a detail, a when and an example, and unique names', () => {
    for (const c of COMMANDS) {
      expect(GROUPS, commandName(c)).toContain(c.group);
      for (const field of ['detail', 'when', 'example'] as const) expect(c[field].trim(), `${commandName(c)} ${field}`).not.toBe('');
      expect(c.example, commandName(c)).toMatch(/^nexus /);
    }
    const names = COMMANDS.map(commandName);
    expect(new Set(names).size).toBe(names.length);
  });
  it("accepts every flag each command's own example uses", () => {
    for (const c of COMMANDS) {
      const flags = [...c.example.matchAll(/ --([a-z][a-z-]*)/g)].map((m) => m[1] ?? '');
      expect(strayFlag(commandName(c).split(' '), flags), c.example).toBeNull();
    }
  });
  it('names a command by the words before its first argument', () => {
    expect(COMMANDS.map(commandName)).toContain('phase status');
    expect(COMMANDS.map(commandName)).toContain('new');
    expect(COMMANDS.map(commandName)).toContain('plan index');
  });
});
