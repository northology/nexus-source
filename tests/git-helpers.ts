import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../core/git.ts';
import { tempDir } from './helpers.ts';

/**
 * A temporary git repo on `main`, with git's global and system config pointed at an empty file and a fixed test
 * identity, so a developer's git settings (autocrlf, signing, hooks paths, their name) never reach a test.
 */
export function gitRepo(): { root: string; env: Record<string, string> } {
  const root = tempDir('nexus-git-');
  const empty = join(tempDir('nexus-gitconfig-'), 'empty');
  writeFileSync(empty, '');
  const env = {
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_SYSTEM: empty,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'Test Author',
    GIT_COMMITTER_EMAIL: 'author@example.com',
  };
  git(root, ['init', '-q', '-b', 'main'], { env });
  return { root, env };
}

/** Stages everything in the temporary repo and commits it (empty commits allowed); returns the new HEAD. */
export function commitAll(root: string, message: string, env: Record<string, string>): string {
  git(root, ['add', '-A'], { env });
  git(root, ['commit', '-q', '--allow-empty', '-m', message], { env });
  return git(root, ['rev-parse', 'HEAD'], { env });
}
