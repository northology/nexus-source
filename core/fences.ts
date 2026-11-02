// A fence opens up to 3 spaces in, or after a list marker (`- `, `* `, `+ `, `1. `, `1) `), which sets the content
// indent its closer may use. A backtick fence's info string cannot contain a backtick (CommonMark), so a prose line
// that opens with an inline code span is no fence.
const FENCE_OPEN = /^( {0,3}(?:[-*+]|\d{1,9}[.)]) +| {0,3})(?:(`{3,})[^`]*|(~{3,}).*)$/;

/**
 * The one CommonMark fence rule plans and ledgers share. Call the returned function with each line in order: it is true
 * when the line is inside a fence or is a fence line, so the caller skips it. A fence closes only on the same character,
 * at least as many times, indented no more than 3 spaces past its content indent, with nothing but whitespace after it.
 */
export function fenceTracker(): (line: string) => boolean {
  const state = fenceStates();
  return (line) => state(line) !== null;
}

/** Where a line sits against fences: the line that opens one, a line inside, the line that closes it, or null outside. */
export type FenceState = 'open' | 'inside' | 'close';

/** The same rule as fenceTracker, saying which fence line each one is. Call it with each line in order. */
export function fenceStates(): (line: string) => FenceState | null {
  let fence: { mark: string; close: RegExp } | null = null;
  return (line) => {
    if (fence) {
      const close = fence.close.exec(line)?.[1];
      if (close && close[0] === fence.mark[0] && close.length >= fence.mark.length) {
        fence = null;
        return 'close';
      }
      return 'inside';
    }
    const opened = FENCE_OPEN.exec(line);
    const mark = opened?.[2] ?? opened?.[3];
    if (opened && mark) {
      const indent = opened[1]?.length ?? 0;
      fence = { mark, close: new RegExp(`^ {0,${indent + 3}}(\`{3,}|~{3,})\\s*$`) };
      return 'open';
    }
    return null;
  };
}
