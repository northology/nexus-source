import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotLiveBuild } from './setup/live-build.ts';
import { tempDir } from './helpers.ts';

describe('the live build guard', () => {
  it('passes when nothing in the live .build/ changed', () => {
    const root = tempDir('nexus-live-');
    mkdirSync(join(root, '.build', 'some-build'), { recursive: true });
    writeFileSync(join(root, '.build', 'some-build', 'build.json'), '{}');
    const after = snapshotLiveBuild(join(root, 'nexus'));
    expect(() => after()).not.toThrow();
  });
  it('fails when a test wrote into the live .build/', () => {
    const root = tempDir('nexus-live-');
    mkdirSync(join(root, '.build', 'some-build'), { recursive: true });
    const after = snapshotLiveBuild(root);
    writeFileSync(join(root, '.build', 'some-build', 'stray.json'), '{}');
    expect(() => after()).toThrow(/changed the live build/);
  });
  it('does nothing where no .build/ is above', () => {
    const after = snapshotLiveBuild(tempDir('nexus-live-'));
    expect(() => after()).not.toThrow();
  });
});
