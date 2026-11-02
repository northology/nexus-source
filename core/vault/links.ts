import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fenceStates } from '../fences.ts';

export const TYPED_LINKS = ['uses', 'feeds', 'supersedes', 'relates'] as const;

const WIKILINK = /!?\[\[([^\]\n]+)\]\]/g;
const QUOTED_LINK = /^\[\[([^\]\n]+)\]\]$/;
const JS_FENCE = /^ {0,3}(?:`{3,}|~{3,})\s*(?:dataviewjs|datacorejs)\b/;
const INLINE_CODE = /(`+)[^`]*?\1/g;
const INLINE_FIELD = /(?:^|[[(])\s*[\p{L}][\p{L}\p{N}_ -]*::(?:\s|$)/u;

export interface BodyScan {
  links: { target: string; line: number }[];
  jsBlocks: number[];
  inlineFields: number[];
}

/** Wikilinks, JS query fences and Dataview inline fields in a body. Code fences and inline code are skipped. */
export function scanBody(body: string[], firstLine: number): BodyScan {
  const fence = fenceStates();
  const scan: BodyScan = { links: [], jsBlocks: [], inlineFields: [] };
  body.forEach((text, i) => {
    const line = firstLine + i;
    const state = fence(text);
    if (state === 'open' && JS_FENCE.test(text)) scan.jsBlocks.push(line);
    if (state !== null) return;
    const prose = text.replace(INLINE_CODE, '');
    for (const m of prose.matchAll(WIKILINK)) if (m[1]) scan.links.push({ target: m[1], line });
    if (INLINE_FIELD.test(prose)) scan.inlineFields.push(line);
  });
  return scan;
}

/** A typed-link property's value: the quoted wikilinks it holds, and how many values aren't one. */
export function typedLinkValues(value: unknown): { links: string[]; malformed: number } {
  const items: unknown[] = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  const links: string[] = [];
  let malformed = 0;
  for (const item of items) {
    const inner = typeof item === 'string' ? QUOTED_LINK.exec(item.trim())?.[1] : undefined;
    if (inner) links.push(inner);
    else malformed += 1;
  }
  return { links, malformed };
}

function linkPath(inner: string): string {
  return ((inner.split('|')[0] ?? '').split('#')[0] ?? '').trim();
}

/**
 * The docs-relative files a link can point to: the note (target + .md) first, then the target as written when it looks
 * like a file name, since a note called nexus-1.0 and an asset called logo.svg both end in something like an extension.
 */
export function linkFiles(inner: string): string[] {
  const target = linkPath(inner);
  if (target.toLowerCase().endsWith('.md')) return [target];
  return /\.[A-Za-z0-9]+$/.test(target) ? [`${target}.md`, target] : [`${target}.md`];
}

/** A link judged against the vault: links use the full path from docs/. A heading in the same note is fine. */
export function linkState(docs: string, inner: string): 'ok' | 'short' | 'unresolved' {
  const target = linkPath(inner);
  if (target === '') return 'ok';
  if (!target.includes('/')) return 'short';
  return linkFiles(inner).some((f) => existsSync(join(docs, f))) ? 'ok' : 'unresolved';
}
