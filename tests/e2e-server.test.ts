import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, startE2eServer } from './e2e/e2e-server.ts';
import { ARTIFACTS } from './helpers.ts';

const E2E = join(ARTIFACTS, 'tests', 'e2e');

describe('e2e servers never read the real home', () => {
  it('refuses to start a server without an inventory', async () => {
    const opts = { root: E2E, cockpitDir: E2E, port: 0 } as unknown as Parameters<typeof startE2eServer>[0];
    await expect(startE2eServer(opts)).rejects.toThrow(/inventory/);
  });

  it('builds an empty temporary home whose walk stops at the temp folder', () => {
    const env = isolatedEnv();
    expect(readdirSync(env.configDir)).toEqual([]);
    expect(readdirSync(env.managedDir)).toEqual([]);
    expect(env.ceiling).not.toBeNull();
    expect(env.configDir.startsWith(env.ceiling ?? '')).toBe(true);
  });

  it('starts every e2e server through startE2eServer', () => {
    const launchers = readdirSync(E2E).filter((f) => /\.(m?js|ts)$/.test(f) && f !== 'e2e-server.ts');
    const direct = launchers.filter((f) => /\bstartServer\s*\(/.test(readFileSync(join(E2E, f), 'utf8')));
    expect(direct).toEqual([]);
    expect(launchers.filter((f) => readFileSync(join(E2E, f), 'utf8').includes('startE2eServer(')).sort()).toEqual(['serve-example.mjs', 'serve-one.mjs']);
  });
});
