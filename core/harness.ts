/** The harnesses nexus ships a package for. Each package's bundles are built with its own value. */
export type Harness = 'claude-code' | 'codex' | 'antigravity';

export const HARNESSES: readonly Harness[] = ['claude-code', 'codex', 'antigravity'];

/** Each harness as its maker names it, for text a person reads. */
export const HARNESS_NAMES: Record<Harness, string> = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };

// Set per package by the build (esbuild `define`); undefined when running from source or in tests.
declare const __NEXUS_HARNESS__: string | undefined;

/** How the user starts one of nexus's skills: /nexus:<skill>, or $nexus:<skill> in Codex. */
export function skillCommand(skill: string, harness: Harness = currentHarness()): string {
  return `${harness === 'codex' ? '$' : '/'}nexus:${skill}`;
}

/** The harness this copy of nexus was built for: Claude Code when run from source. */
export function currentHarness(): Harness {
  const built = typeof __NEXUS_HARNESS__ === 'string' ? __NEXUS_HARNESS__ : undefined;
  return (HARNESSES as readonly string[]).includes(built ?? '') ? (built as Harness) : 'claude-code';
}
