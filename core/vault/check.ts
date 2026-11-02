import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readFrontmatter } from './frontmatter.ts';
import { readMarker } from './generated.ts';
import { linkFiles, typedLinkValues } from './links.ts';
import { isVault, META, readRegistry } from './registry.ts';
import { checkNote, noteClass, type Note } from './rules.ts';
import { staleFindings } from './stale.ts';
import { CONTRACT_VERSION, DIVISIONS, finding, type Finding, type Registry, type VaultReport } from './types.ts';

export interface CheckOptions {
  /** Report only this note: absolute, or relative to the repo root. */
  file?: string;
  /** Also compare each thing note with its source's git history. */
  stale?: boolean;
  /** The contract version to check against; defaults to CONTRACT_VERSION. For tests only. */
  supported?: number;
}

const toPosix = (p: string): string => p.replace(/\\/g, '/');

function collect(dir: string, rel: string, notes: string[], findings: Finding[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) collect(join(dir, e.name), r, notes, findings);
    else if (e.isFile() && e.name.endsWith('.md')) {
      if (r.split('/').includes('assets')) findings.push(finding('assets-note', 'block', `docs/${r}`, 'assets/ folders hold files, not notes; move the note to its class folder'));
      else notes.push(r);
    }
  }
}

/** Every note under docs/, docs-relative, and the findings about what sits where. */
export function walkVault(docs: string): { notes: string[]; findings: Finding[] } {
  const notes: string[] = [];
  const findings: Finding[] = [];
  for (const e of readdirSync(docs, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === META) continue;
    if (e.isDirectory()) {
      if (!(DIVISIONS as readonly string[]).includes(e.name)) {
        findings.push(finding('top-level', 'block', `docs/${e.name}/`, `docs/ holds only the six divisions (${DIVISIONS.join(', ')}) and _meta/`));
      } else if (e.name === 'superpowers') {
        // Outside archive/ is the landing zone Superpowers writes to: it is mined later, not checked.
        const archive = readdirSync(join(docs, 'superpowers'), { withFileTypes: true }).find((d) => d.name === 'archive' && d.isDirectory());
        if (archive) collect(join(docs, 'superpowers', 'archive'), 'superpowers/archive', notes, findings);
      } else {
        collect(join(docs, e.name), e.name, notes, findings);
      }
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      findings.push(finding('top-level', 'block', `docs/${e.name}`, 'notes live inside a division, not at the top of docs/'));
    }
  }
  return { notes: notes.sort(), findings };
}

/** The rules that need every note: one note per source, and superseded decisions something supersedes. */
export function vaultRules(notes: Note[], reg: Registry): Finding[] {
  const out: Finding[] = [];
  const bySource = new Map<string, Note[]>();
  for (const n of notes) {
    const cls = noteClass(n, reg);
    const source = n.fm.data?.['source'];
    if (cls?.thing && typeof source === 'string' && source.trim() !== '') {
      const key = `${cls.name}\u0000${source.trim()}`;
      bySource.set(key, [...(bySource.get(key) ?? []), n]);
    }
  }
  for (const group of bySource.values()) {
    if (group.length < 2) continue;
    for (const n of group) {
      const others = group.filter((g) => g !== n).map((g) => g.file).join(', ');
      out.push(finding('source-duplicate', 'block', n.file, `source "${String(n.fm.data?.['source'])}" is also described by ${others}; keep one note per source`, n.fm.keyLines.get('source')));
    }
  }
  const superseded = new Set<string>();
  for (const n of notes) for (const inner of typedLinkValues(n.fm.data?.['supersedes']).links) for (const f of linkFiles(inner)) superseded.add(f);
  for (const n of notes) {
    if (n.fm.data?.['status'] === 'superseded' && !superseded.has(n.rel)) {
      out.push(finding('supersede-orphan', 'warn', n.file, 'this note is superseded, but no note says supersedes: pointing to it', n.fm.keyLines.get('status')));
    }
  }
  return out;
}

const order = (a: Finding, b: Finding): number => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule);

/** Check a repo's docs/ vault. Reads only files under docs/ (and, for stale, git history); writes nothing. */
export function checkVault(root: string, opts: CheckOptions = {}): VaultReport {
  const docs = join(root, 'docs');
  if (!isVault(docs)) return { vault: false, notes: 0, findings: [], notices: ['not a nexus vault: docs/_meta/classes/ not found'] };
  const { registry, findings } = readRegistry(docs);
  const notices: string[] = [];
  const supported = opts.supported ?? CONTRACT_VERSION;
  if (registry.contract !== null && registry.contract > supported) {
    const newer = finding('contract-newer', 'block', `docs/${META}/contract.md`, `this vault follows contract ${registry.contract}; this nexus supports ${supported}. Update nexus.`);
    return { vault: true, notes: 0, findings: [...findings, newer].sort(order), notices };
  }
  if (registry.contract !== null && registry.contract < supported) {
    findings.push(finding('contract-older', 'warn', `docs/${META}/contract.md`, `this vault follows contract ${registry.contract}; this nexus supports ${supported}. The vault can be upgraded.`));
  }
  const walk = walkVault(docs);
  findings.push(...walk.findings);
  const texts = new Map<string, string>();
  const notes: Note[] = walk.notes.map((rel) => {
    const text = readFileSync(join(docs, rel), 'utf8');
    texts.set(rel, text);
    return { rel, file: `docs/${rel}`, fm: readFrontmatter(text) };
  });
  for (const n of notes) findings.push(...checkNote(n, registry, docs));
  findings.push(...vaultRules(notes, registry));
  for (const n of notes) {
    const m = readMarker(texts.get(n.rel) ?? '');
    if (m && m.hash !== m.actual) {
      findings.push(finding('generated-modified', 'block', n.file, `this file is generated and was changed after nexus wrote it: run \`nexus docs generate\`; to change what it says, edit its source (${m.source}) first`, m.line));
    }
  }
  if (opts.stale) {
    const stale = staleFindings(root, notes, registry);
    findings.push(...stale.findings);
    if (stale.notice) notices.push(stale.notice);
  }
  let result = findings;
  if (opts.file !== undefined) {
    // The note's own findings, plus the registry's: a broken class note or contract governs every note.
    const target = toPosix(relative(root, resolve(root, opts.file)));
    result = findings.filter((f) => f.file === target || f.rule === 'registry-invalid' || f.rule === 'class-file-name' || f.rule.startsWith('contract-'));
  }
  return { vault: true, notes: notes.length, findings: result.sort(order), notices };
}
