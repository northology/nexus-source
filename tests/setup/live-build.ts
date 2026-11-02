// Vitest global setup. This repo holds a live nexus build (.build/ at its root) while nexus's own tests run, and nexus
// finds builds by walking up from a folder, so a test that forgot its temp folder could write into the real one. This
// fails the run if the .build/ found at or above the repo root changed. If you answered a gate in the cockpit during the
// run, run it again.
import { join } from 'node:path';
import { findBuildRoot } from '../../core/paths.ts';
import { ARTIFACTS, treeHash } from '../helpers.ts';

export function snapshotLiveBuild(start: string): () => void {
  const root = findBuildRoot(start);
  if (!root) return () => {};
  const dir = join(root, '.build');
  const before = treeHash(dir);
  return () => {
    if (treeHash(dir) !== before) throw new Error(`The test run changed the live build at ${dir}: tests must work in temp folders.`);
  };
}

export default function setup(): () => void {
  return snapshotLiveBuild(ARTIFACTS);
}
