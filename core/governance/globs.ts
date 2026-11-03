/**
 * Antigravity's globs string as its paths: split on commas outside braces, so a brace list (src/{a,b}/**) stays one
 * path. Each is trimmed, and empty ones are dropped.
 */
export function splitGlobs(globs: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < globs.length; i++) {
    const c = globs[i];
    if (c === '{') depth += 1;
    else if (c === '}' && depth > 0) depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(globs.slice(start, i));
      start = i + 1;
    }
  }
  out.push(globs.slice(start));
  return out.map((g) => g.trim()).filter((g) => g !== '');
}
