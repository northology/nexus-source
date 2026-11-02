// Declared views and the data the renderers draw. Pure types: the cockpit imports these.
import type { ViewDef, ViewType } from '../vault/types.ts';

export type Cell = string | number | null;
export interface TableData { kind: 'table'; columns: string[]; numeric: string[]; rows: Cell[][]; total: number }
export interface MarkdownData { kind: 'markdown'; text: string }
/** Each image's `stamp` is its size and time when read: the cockpit puts it on the image's address, so a rewrite is fetched again. */
export interface GalleryData { kind: 'gallery'; images: { index: number; name: string; caption: string; stamp: string }[]; refused?: string[] }
export type ViewData = TableData | MarkdownData | GalleryData;
export interface ViewSummary { name: string; title: string; type: ViewType; description: string; file: string }
export interface ViewAnswer { view: ViewDef; data: ViewData | null; error: string | null }
