import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main, type CliIO } from '../scripts/cli.ts';
import { doctorDocs } from '../core/vault/doctor.ts';
import { NOW, tempDir } from './helpers.ts';
import { note, vaultRepo } from './vault-helpers.ts';

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIO = { cwd, out: (l) => out.push(l), err: (l) => err.push(l), now: () => NOW, readStdin: async () => '', env: {} };
  return { value, out, err };
}

describe('nexus docs check', () => {
  it('checks the vault from inside it, with no build anywhere', async () => {
    const root = vaultRepo({}, 'clean');
    const t = io(join(root, 'docs'));
    expect(await main(['docs', 'check'], t.value)).toBe(0);
    expect(t.out.at(-1)).toBe('14 notes checked: 0 blocking, 0 warnings');
  });
  it('passes --file, --stale and --json through, and exits 1 on a block', async () => {
    const root = vaultRepo({ 'docs/dev/context/bad.md': note({ class: 'hub' }) }, 'clean');
    const t = io(root);
    expect(await main(['docs', 'check', '--json', '--file', 'docs/dev/context/bad.md'], t.value)).toBe(1);
    expect(JSON.parse(t.out[0] ?? '{}')).toMatchObject({ vault: true, findings: [{ rule: 'component-missing' }] });
    expect(await main(['docs', 'check', root, '--stale'], io(tempDir()).value)).toBe(1);
  });
  it('refuses its flags on other commands, and other sub-commands', async () => {
    const t = io(tempDir());
    expect(await main(['builds', '--stale'], t.value)).toBe(1);
    expect(t.err.join('\n')).toMatch(/--stale is only used by `nexus docs check`/);
    expect(await main(['docs', 'lint'], t.value)).toBe(1);
  });
});

describe('doctorDocs', () => {
  it('reports the registry, the hook entry and a bundle that cannot load', () => {
    const root = vaultRepo({}, 'clean');
    const hooks = join(tempDir(), 'hooks.json');
    writeFileSync(hooks, JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ args: ['${CLAUDE_PLUGIN_ROOT}/bin/docs-check.mjs', '--hook'] }] }] } }));
    const results = doctorDocs(root, { bundle: join(tempDir(), 'missing.mjs'), hooks });
    expect(results).toEqual([
      { ok: false, text: expect.stringMatching(/^the docs-check bundle didn't run/) as unknown },
      { ok: true, text: 'the PostToolUse hook runs docs-check.mjs --hook' },
      { ok: true, text: 'the registry reads: 24 classes, contract 3' },
    ]);
  });
  it('fails a broken registry or a missing hook entry, and passes outside a vault', () => {
    const broken = vaultRepo({ 'docs/_meta/classes/x.md': '---\nname: [x\n---\n' }, 'clean');
    const hooks = join(tempDir(), 'hooks.json');
    writeFileSync(hooks, JSON.stringify({ hooks: {} }));
    const results = doctorDocs(broken, { bundle: join(tempDir(), 'missing.mjs'), hooks });
    expect(results[1]).toEqual({ ok: false, text: expect.stringMatching(/no PostToolUse entry runs docs-check/) as unknown });
    expect(results[2]).toEqual({ ok: false, text: expect.stringMatching(/docs\/_meta\/classes\/x\.md/) as unknown });
    expect(doctorDocs(tempDir(), { bundle: join(tempDir(), 'missing.mjs'), hooks })[2]).toEqual({ ok: true, text: 'no docs vault here (docs/_meta/classes/ not found)' });
    const newer = vaultRepo({ 'docs/_meta/contract.md': '---\ncontract: 4\n---\n' }, 'clean');
    expect(doctorDocs(newer, { bundle: join(tempDir(), 'missing.mjs'), hooks })[2]).toEqual({ ok: false, text: 'the vault follows contract 4; this nexus supports 3. Update nexus.' });
  });
});
