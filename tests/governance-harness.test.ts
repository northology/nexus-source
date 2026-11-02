import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { governanceInventory } from '../core/governance/inventory.ts';
import { memoryKey } from '../core/governance/env.ts';
import { walkSubfolders } from '../core/governance/subfolders.ts';
import { put, sandbox } from './governance-helpers.ts';

/** One repo with every harness's instruction files, seen from each harness. */
function setUp() {
  const s = sandbox();
  put(s.root, { 'CLAUDE.md': '# Claude rules\n', 'AGENTS.md': '# Shared rules\n', '.claude/rules/x.md': '# Rule\n', 'pkg/AGENTS.md': '# Package rules\n' });
  put(s.env.home, {
    [join('.claude', 'projects', memoryKey(s.root), 'memory', 'MEMORY.md')]: '- a memory\n',
    '.codex/AGENTS.md': '# Codex global\n',
    '.gemini/AGENTS.md': '# Antigravity global\n',
  });
  const walk = walkSubfolders(s.root, s.env);
  return { ...s, subfolders: walk.found };
}
const slash = (p: string) => p.replace(/\\/g, '/');
const instructionFiles = (inv: ReturnType<typeof governanceInventory>) =>
  inv.items.filter((i) => i.kind === 'instructions' || i.kind === 'rule-file').map((i) => slash(i.location));

describe('the Repo view under each harness', () => {
  it('under Codex lists AGENTS.md at the root, in subfolders and globally, and nothing of Claude Code', () => {
    const s = setUp();
    const inv = governanceInventory(s.root, s.env, { subfolders: s.subfolders, harness: 'codex' });
    expect(inv.harness).toBe('codex');
    const files = instructionFiles(inv);
    expect(files).toContain('AGENTS.md');
    expect(files.some((f) => f.endsWith('.codex/AGENTS.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('pkg/AGENTS.md'))).toBe(true);
    expect(files.some((f) => /CLAUDE\.md|\.claude\/|\.gemini\//.test(f))).toBe(false);
    expect(inv.items.filter((i) => i.kind === 'memory')).toEqual([]);
    expect(inv.setting).toBeNull();
    expect(inv.items.find((i) => slash(i.location).endsWith('pkg/AGENTS.md'))?.conditional).toMatch(/Codex/);
  });
  it('under Antigravity lists its own global AGENTS.md, and says it skips subfolders', () => {
    const s = setUp();
    const inv = governanceInventory(s.root, s.env, { subfolders: s.subfolders, harness: 'antigravity' });
    const files = instructionFiles(inv);
    expect(files.some((f) => f.endsWith('.gemini/AGENTS.md'))).toBe(true);
    expect(files.some((f) => /CLAUDE\.md|\.codex\//.test(f))).toBe(false);
    expect(inv.items.find((i) => slash(i.location).endsWith('pkg/AGENTS.md'))?.conditional).toMatch(/Antigravity doesn't load/);
    expect(inv.setting).toBeNull();
    expect(inv.problems).toEqual([]);
  });
  it('under Claude Code is the same inventory as before', () => {
    const s = setUp();
    const named = governanceInventory(s.root, s.env, { subfolders: s.subfolders, harness: 'claude-code' });
    const plain = governanceInventory(s.root, s.env, { subfolders: s.subfolders });
    expect(named).toEqual(plain);
    expect(named.harness).toBe('claude-code');
    expect(named.setting).not.toBeNull();
    expect(instructionFiles(named)).toContain('CLAUDE.md');
  });
});
