import { describe, it, expect } from 'vitest';
import { closeSync, mkdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listViews, readView, readViewFile, viewSignature } from '../core/views/read.ts';
import type { GalleryData } from '../core/views/types.ts';
import { tempDir } from './helpers.ts';
import { vaultRepo } from './vault-helpers.ts';

const view = (name: string, type: string, data: string, extra = '') => ({
  [`docs/_meta/views/${name}.md`]: `---\nname: ${name}\ntitle: ${name}\ntype: ${type}\ndata: ${data}\n${extra}---\nAbout ${name}.\n`,
});
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
/** What readViewFile serves for a position: its bytes and type, read from the returned fd, which is closed. */
const served = (root: string, name: string, n: number): { bytes: Buffer; size: number; type: string } => {
  const f = readViewFile(root, name, n);
  try {
    return { bytes: readFileSync(f.fd), size: f.size, type: f.type };
  } finally {
    closeSync(f.fd);
  }
};

describe('listViews', () => {
  it('lists valid views and names the invalid ones', () => {
    const root = vaultRepo({ ...view('load', 'table', 'data/load.csv'), ...view('bad', 'map', 'x.csv') });
    const { views, problems } = listViews(root);
    expect(views).toEqual([{ name: 'load', title: 'load', type: 'table', description: 'About load.', file: 'docs/_meta/views/load.md' }]);
    expect(problems[0]).toMatch(/^docs\/_meta\/views\/bad\.md: the view note is invalid/);
  });
  it('names a canvas view as a problem, without erroring, and the other views still list', () => {
    const root = vaultRepo({ ...view('load', 'table', 'data/load.csv'), ...view('board', 'canvas', 'boards/b.canvas'), 'boards/b.canvas': '{"nodes":[]}' });
    const { views, problems } = listViews(root);
    expect(views.map((v) => v.name)).toEqual(['load']);
    expect(problems).toEqual(["docs/_meta/views/board.md: canvas isn't a view type: JSON Canvas boards live in the vault, where Obsidian shows them"]);
  });
  it('is empty with no vault', () => {
    expect(listViews(tempDir())).toEqual({ views: [], problems: [] });
  });
});

describe('readView', () => {
  it('parses a table, a chart\'s table and a markdown file', () => {
    const root = vaultRepo({
      ...view('load', 'table', 'data/load.csv'),
      ...view('trend', 'chart', 'data/load.csv', 'chart: { kind: line, x: day, y: requests }\n'),
      ...view('notes', 'markdown', 'reports/notes.md'),
      'data/load.csv': 'day,requests\n1,5\n', 'reports/notes.md': '# Notes\n',
    });
    expect(readView(root, 'load').data).toMatchObject({ kind: 'table', columns: ['day', 'requests'] });
    expect(readView(root, 'trend').data).toMatchObject({ kind: 'table', numeric: ['day', 'requests'] });
    expect(readView(root, 'notes').data).toEqual({ kind: 'markdown', text: '# Notes\n' });
  });
  it('answers an error, not a throw, for missing or unreadable data', () => {
    const root = vaultRepo({ ...view('load', 'table', 'data/load.csv'), ...view('ragged', 'table', 'data/r.csv'), 'data/r.csv': 'a,b\n1\n' });
    expect(readView(root, 'load')).toMatchObject({ data: null, error: "data/load.csv doesn't exist yet" });
    expect(readView(root, 'ragged')).toMatchObject({ data: null, error: 'data/r.csv: line 2 has 1 field; the header has 2' });
    expect(() => readView(root, 'nope')).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('refuses data whose real path leaves the repo, naming the view', () => {
    const outside = tempDir('nexus-outside-');
    writeFileSync(join(outside, 'secret.csv'), 'a\n1\n');
    const root = vaultRepo(view('leak', 'table', 'data/link/secret.csv'));
    mkdirSync(join(root, 'data'), { recursive: true });
    symlinkSync(outside, join(root, 'data', 'link'), 'junction');
    expect(readView(root, 'leak')).toMatchObject({ data: null, error: 'view "leak": data/link/secret.csv leads outside the repo; not read' });
  });
  it('reads through a root spelled in another case (Windows)', () => {
    const root = vaultRepo({ ...view('load', 'table', 'data/load.csv'), 'data/load.csv': 'a\n1\n' });
    const odd = process.platform === 'win32' ? root.toLowerCase() : root;
    expect(readView(odd, 'load').data).toMatchObject({ kind: 'table' });
  });
  it('refuses data over the cap', () => {
    const root = vaultRepo({ ...view('big', 'table', 'data/big.csv'), 'data/big.csv': `a\n${'1\n'.repeat(2_700_000)}` });
    expect(readView(root, 'big').error).toBe('data/big.csv is larger than 5 MB; not read');
  });
  it('answers an error for a data path that is a folder or a malformed list', () => {
    const root = vaultRepo({
      ...view('dir', 'table', 'data'), ...view('badlist', 'gallery', 'data/l.json'), ...view('objlist', 'gallery', 'data/o.json'),
      'data/l.json': '{nope', 'data/o.json': '{}',
    });
    expect(readView(root, 'dir')).toMatchObject({ data: null, error: 'data is a folder, not a file; not read' });
    expect(readView(root, 'badlist').data).toBeNull();
    expect(readView(root, 'badlist').error).toMatch(/^data\/l\.json: /);
    expect(readView(root, 'objlist').error).toMatch(/^data\/o\.json: a gallery list is/);
  });
  it('lists a gallery folder\'s images by name and a JSON list with captions, serving each by position', () => {
    const root = vaultRepo({
      ...view('shots', 'gallery', 'data/shots'),
      ...view('picked', 'gallery', 'data/picked.json'),
      'data/shots/b.png': '', 'data/shots/a.svg': '<svg/>', 'data/shots/notes.txt': 'skip',
      'data/picked.json': JSON.stringify([{ file: 'shots/b.png', caption: 'Second' }, { file: '../../outside.png' }]),
    });
    writeFileSync(join(root, 'data', 'shots', 'b.png'), PNG);
    expect(readView(root, 'shots').data).toEqual({ kind: 'gallery', images: [{ index: 0, name: 'a.svg', caption: '', stamp: expect.any(String) }, { index: 1, name: 'b.png', caption: '', stamp: expect.any(String) }] });
    expect(readView(root, 'picked').data).toEqual({ kind: 'gallery', images: [{ index: 0, name: 'b.png', caption: 'Second', stamp: expect.any(String) }], refused: ['../../outside.png'] });
    const f = served(root, 'shots', 1);
    expect([f.bytes, f.size, f.type]).toEqual([PNG, PNG.length, 'image/png']);
    expect(() => readViewFile(root, 'shots', 2)).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('stamps each gallery image with its size and time, so a rewrite changes its stamp and nothing else does', () => {
    const root = vaultRepo({
      ...view('shots', 'gallery', 'data/shots'), ...view('picked', 'gallery', 'data/picked.json'),
      'data/shots/a.png': 'aa', 'data/shots/b.png': 'bb', 'data/picked.json': JSON.stringify([{ file: 'shots/b.png' }]),
    });
    const stamps = (name: string) => (readView(root, name).data as GalleryData).images.map((i) => i.stamp);
    const of = (rel: string) => {
      const st = statSync(join(root, 'data', 'shots', rel));
      return `${st.size}-${st.mtimeMs}`;
    };
    const before = stamps('shots');
    expect(before).toEqual([of('a.png'), of('b.png')]);
    expect(stamps('picked')).toEqual([of('b.png')]);
    writeFileSync(join(root, 'data', 'other.csv'), 'x\n1\n');
    expect(stamps('shots')).toEqual(before);
    writeFileSync(join(root, 'data', 'shots', 'a.png'), 'a longer image');
    utimesSync(join(root, 'data', 'shots', 'a.png'), new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    const after = stamps('shots');
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]).toBe(of('a.png'));
    expect(after[1]).toBe(before[1]);
  });
  it('skips gallery entries that reach outside through a link or an absolute path', () => {
    const outside = tempDir('nexus-outside-');
    writeFileSync(join(outside, 'x.png'), PNG);
    const root = vaultRepo({
      ...view('picked', 'gallery', 'data/picked.json'), ...view('folder', 'gallery', 'data/folder'),
      'data/in.png': '',
      'data/picked.json': JSON.stringify([{ file: 'link/x.png' }, { file: join(outside, 'x.png') }, { file: 'in.png', caption: 'In' }]),
      'data/folder/k.png': '',
    });
    symlinkSync(outside, join(root, 'data', 'link'), 'junction');
    symlinkSync(outside, join(root, 'data', 'folder', 'sub'), 'junction');
    expect(readView(root, 'picked').data).toEqual({ kind: 'gallery', images: [{ index: 0, name: 'in.png', caption: 'In', stamp: expect.any(String) }], refused: ['link/x.png', join(outside, 'x.png')] });
    expect(readView(root, 'folder').data).toEqual({ kind: 'gallery', images: [{ index: 0, name: 'k.png', caption: '', stamp: expect.any(String) }] });
    expect(served(root, 'picked', 0).type).toBe('image/png');
    expect(() => readViewFile(root, 'picked', 1)).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('follows an image link in a gallery folder that stays inside the repo, and names one that leads out', (ctx) => {
    const outside = tempDir('nexus-outside-');
    writeFileSync(join(outside, 'x.png'), PNG);
    const root = vaultRepo({ ...view('folder', 'gallery', 'data/folder'), 'data/folder/k.png': '', 'data/real.png': 'img' });
    try {
      symlinkSync(join(root, 'data', 'real.png'), join(root, 'data', 'folder', 'in.png'), 'file');
      symlinkSync(join(outside, 'x.png'), join(root, 'data', 'folder', 'out.png'), 'file');
    } catch (e) {
      if ((e as { code?: string }).code === 'EPERM') return ctx.skip(); // file links need a privilege here
      throw e;
    }
    expect(readView(root, 'folder').data).toEqual({
      kind: 'gallery',
      images: [{ index: 0, name: 'in.png', caption: '', stamp: expect.any(String) }, { index: 1, name: 'k.png', caption: '', stamp: expect.any(String) }],
      refused: ['out.png'],
    });
    expect(served(root, 'folder', 0).size).toBe(3);
  });
  it('refuses a gallery folder that is itself a link out', () => {
    const outside = tempDir('nexus-outside-');
    writeFileSync(join(outside, 'x.png'), PNG);
    const root = vaultRepo(view('shots', 'gallery', 'shots'));
    symlinkSync(outside, join(root, 'shots'), 'junction');
    expect(readView(root, 'shots')).toMatchObject({ data: null, error: 'view "shots": shots leads outside the repo; not read' });
    expect(() => readViewFile(root, 'shots', 0)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('readViewFile', () => {
  it('refuses an image over the cap with 413 and an unknown view with 404', () => {
    const root = vaultRepo({ ...view('shots', 'gallery', 'shots'), 'shots/big.png': 'x'.repeat(10 * 1024 * 1024 + 1) });
    expect(() => readViewFile(root, 'shots', 0)).toThrow(expect.objectContaining({ status: 413 }));
    expect(() => readViewFile(root, 'nope', 0)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('viewSignature', () => {
  it('changes when the target of an image link in a gallery folder changes', (ctx) => {
    const root = vaultRepo({ ...view('g', 'gallery', 'shots'), 'shots/k.png': 'k', 'art/real.png': 'one' });
    try {
      symlinkSync(join(root, 'art', 'real.png'), join(root, 'shots', 'in.png'), 'file');
    } catch (e) {
      if ((e as { code?: string }).code === 'EPERM') return ctx.skip(); // file links need a privilege here
      throw e;
    }
    const a = viewSignature(root);
    writeFileSync(join(root, 'art', 'real.png'), 'longer');
    expect(viewSignature(root)).not.toBe(a);
  });
});
