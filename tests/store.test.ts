import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson, readJson } from '../core/store.ts';
import { NexusError } from '../core/errors.ts';
import { tempDir } from './helpers.ts';

describe('writeJson', () => {
  it('writes pretty JSON with a trailing newline and leaves no temp file', () => {
    const file = join(tempDir(), 'build.json');
    writeJson(file, { name: 'relay-rebuild' });
    expect(readJson(file)).toEqual({ name: 'relay-rebuild' });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
  it('names the file and cleans up when the save cannot complete', () => {
    const file = join(tempDir(), 'build.json');
    mkdirSync(file); // something already holds this path, as a locked file would on Windows
    let thrown: unknown;
    try {
      writeJson(file, { name: 'relay-rebuild' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NexusError);
    expect((thrown as Error).message).toMatch(/Could not save build.json/);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});
