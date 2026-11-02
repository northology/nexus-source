import { useEffect, useMemo, useState } from 'react';
import { DATA_CAP, isRowArrayJson, ParseError, tableFromText } from '../../../core/views/data.ts';
import type { GalleryData, TableData } from '../../../core/views/types.ts';
import type { FileEntry } from '../../../core/types.ts';
import { ApiError, type Client } from '../api/client.ts';
import { galleryFolder, IMAGE_EXT, viewerOf } from '../lib/markdown.ts';
import { GalleryView } from '../renderers/GalleryView.tsx';
import { TableView } from '../renderers/TableView.tsx';
import { Empty } from './Empty.tsx';
import { PathLine } from './PathLine.tsx';

type Read = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready'; text: string };
type Shown =
  | { kind: 'error'; message: string }
  | { kind: 'table'; data: TableData }
  | { kind: 'code'; text: string };

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');
/** A build file's size and time, as the server stamps a view's images: a rewrite gives the image a new address. */
const stampOf = (f: FileEntry) => `${f.size}-${f.modified}`;

interface DocFileProps {
  build: string;
  path: string;
  /** The build's documents, notes and files: what a gallery's images resolve against. */
  files: FileEntry[];
  client: Client;
  modified: string | null;
  zone: string;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * A build document that isn't Markdown, drawn with the same renderers as declared views: a CSV or a JSON list
 * of rows as a table (other JSON as code), and a folder's images as a gallery (`path` is the folder with a trailing
 * slash, or one image, which is marked). A table is read through the build's file route and parsed here,
 * unless the snapshot says it is over DATA_CAP, the declared views' cap; a file that can't be parsed says why.
 * Re-keyed by path, modified time and size, so a rewrite reads it again.
 */
export function DocFile({ build, path, files, client, modified, zone }: DocFileProps) {
  const viewer = viewerOf(path);
  const folder = galleryFolder(path);
  const reads = folder === null && viewer === 'table';
  const size = files.find((f) => f.path === path)?.size;
  const over = reads && size !== undefined && size > DATA_CAP;
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  useEffect(() => {
    if (!reads || over) return;
    let cancelled = false;
    client.fileText(build, path).then(
      (text) => {
        if (!cancelled) setRead({ kind: 'ready', text });
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setRead({ kind: 'missing' });
        else setRead({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, build, path, reads, over]);

  const text = read.kind === 'ready' ? read.text : null;
  // Parsed once per read.
  const shown = useMemo((): Shown | null => {
    if (text === null) return null;
    try {
      if (/\.json$/i.test(path) && !isRowArrayJson(text)) return { kind: 'code', text };
      return { kind: 'table', data: tableFromText(path, text) };
    } catch (e) {
      return { kind: 'error', message: e instanceof ParseError ? e.message : String(e) };
    }
  }, [text, path]);

  const gallery = useMemo(() => {
    if (folder === null) return null;
    const siblings = files.filter((f) => IMAGE_EXT.test(f.path) && dirOf(f.path) === folder).sort((a, b) => a.path.localeCompare(b.path));
    const data: GalleryData = { kind: 'gallery', images: siblings.map((f, index) => ({ index, name: f.path.split('/').pop() ?? f.path, caption: '', stamp: stampOf(f) })) };
    const at = siblings.findIndex((f) => f.path === path);
    const here = path.endsWith('/') ? siblings.length > 0 : at >= 0;
    return { siblings, data, here, selected: at >= 0 ? at : undefined };
  }, [folder, files, path]);

  const missing = read.kind === 'missing' || (gallery !== null && !gallery.here);
  return (
    <div className="doc-file">
      <PathLine path={path} modified={modified} zone={zone} />
      {missing ? (
        <Empty title="This file is missing from the build">
          <code>{path}</code> isn't in the build folder. Ask the agent to restore it, or to reopen the gate with the right document.
        </Empty>
      ) : gallery !== null ? (
        <GalleryView data={gallery.data} urlFor={(i) => client.fileUrl(build, gallery.siblings[i]?.path ?? '')} selected={gallery.selected} />
      ) : viewer === null ? (
        <Empty title="The cockpit doesn't show this kind of file">
          Markdown, CSV and JSON files and images show here; open <code>{path}</code> in your editor.
        </Empty>
      ) : over ? (
        <p className="reader-msg">
          <code>{path}</code> is {megabytes(size ?? 0)}; files over {DATA_CAP / 1024 / 1024} MB aren't shown here.
        </p>
      ) : read.kind === 'error' ? (
        <Empty title="This file could not be loaded">{read.message}</Empty>
      ) : shown === null ? (
        <p className="reader-msg" aria-busy="true">
          Loading…
        </p>
      ) : shown.kind === 'error' ? (
        <Empty title="This file can't be shown">{shown.message}</Empty>
      ) : shown.kind === 'table' ? (
        <TableView data={shown.data} />
      ) : (
        <pre className="mono">{shown.text}</pre>
      )}
    </div>
  );
}
