import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { runDocsHook } from '../core/vault/hook.ts';
import { runDocsCheck, type DocsIO } from '../scripts/docs-check.ts';
import { ARTIFACTS, readJsonFile, tempDir } from './helpers.ts';
import { note, vaultRepo } from './vault-helpers.ts';

const input = (cwd: string, file: string) => JSON.stringify({ cwd, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file } });

describe('runDocsHook', () => {
  const root = vaultRepo({
    'docs/dev/context/bad.md': note({ class: 'hub' }),
    'docs/dev/context/warned.md': note({ class: 'hub', component: 'shared' }, 'See [[short]].\n'),
  }, 'clean');
  it('is silent for a valid note, a non-markdown file, a file outside a vault and bad input', () => {
    expect(runDocsHook(input(root, join(root, 'docs', 'design', 'brand.md')))).toBe('');
    expect(runDocsHook(input(root, join(root, 'docs', 'design', 'assets', 'logo.svg')))).toBe('');
    expect(runDocsHook(input(root, join(tempDir(), 'docs', 'x.md')))).toBe('');
    expect(runDocsHook('not json')).toBe('');
    expect(runDocsHook('{}')).toBe('');
  });
  it('blocks with a reason naming each finding', () => {
    const reply = JSON.parse(runDocsHook(input(root, join(root, 'docs', 'dev', 'context', 'bad.md')))) as { decision: string; reason: string };
    expect(reply.decision).toBe('block');
    expect(reply.reason).toMatch(/docs\/dev\/context\/bad\.md/);
    expect(reply.reason).toMatch(/component-missing/);
  });
  it('names a registry problem behind a note, and its file, in the reason', () => {
    const repo = vaultRepo({
      'docs/_meta/classes/local.md': '---\nname: [x\n---\n',
      'docs/dev/context/a.md': note({ class: 'local', component: 'shared' }),
    }, 'clean');
    const reply = JSON.parse(runDocsHook(input(repo, join(repo, 'docs', 'dev', 'context', 'a.md')))) as { reason: string };
    expect(reply.reason).toMatch(/^nexus docs check: docs\/dev\/context\/a\.md /);
    expect(reply.reason).toMatch(/docs\/_meta\/classes\/local\.md: registry-invalid/);
  });
  it('returns warnings as context without blocking', () => {
    const reply = JSON.parse(runDocsHook(input(root, join(root, 'docs', 'dev', 'context', 'warned.md')))) as Record<string, unknown>;
    expect(reply['decision']).toBeUndefined();
    expect(reply['hookSpecificOutput']).toMatchObject({ hookEventName: 'PostToolUse', additionalContext: expect.stringMatching(/link-short/) as unknown });
  });
  it('reads a relative path against cwd, and msys spellings on Windows', () => {
    expect(runDocsHook(input(root, 'docs/dev/context/bad.md'))).toMatch(/"decision":"block"/);
    const msys = `/${root[0]?.toLowerCase() ?? 'c'}${root.slice(2).replace(/\\/g, '/')}/docs/dev/context/bad.md`;
    if (process.platform === 'win32') expect(runDocsHook(input(root, msys), true)).toMatch(/"decision":"block"/);
  });
});

describe('docs-check --hook', () => {
  it('writes the reply and always exits 0, even when reading stdin fails', async () => {
    const root = vaultRepo({ 'docs/dev/context/bad.md': note({ class: 'hub' }) }, 'clean');
    const out: string[] = [];
    const ok: DocsIO = { cwd: root, out: (l) => out.push(l), err: () => {}, readStdin: async () => input(root, join(root, 'docs', 'dev', 'context', 'bad.md')) };
    expect(await runDocsCheck(['--hook'], ok)).toBe(0);
    expect(out[0]).toMatch(/"decision":"block"/);
    const err: string[] = [];
    const broken: DocsIO = { cwd: root, out: () => {}, err: (l) => err.push(l), readStdin: async () => Promise.reject(new Error('stdin closed')) };
    expect(await runDocsCheck(['--hook'], broken)).toBe(0);
    expect(err).toEqual(['nexus docs-check hook: stdin closed']);
  });
});

describe('registration', () => {
  it('runs after Write, Edit and MultiEdit, in exec form', () => {
    const config = readJsonFile(join(ARTIFACTS, 'hooks', 'hooks.json')) as {
      hooks: { PostToolUse: { matcher: string; hooks: { type: string; command: string; args: string[]; timeout: number }[] }[] };
    };
    const entry = config.hooks.PostToolUse[0];
    expect(entry?.matcher).toBe('Write|Edit|MultiEdit');
    expect(entry?.hooks[0]).toMatchObject({ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/docs-check.mjs', '--hook'] });
    expect(entry?.hooks[0]?.timeout).toBeLessThanOrEqual(10);
  });
});
