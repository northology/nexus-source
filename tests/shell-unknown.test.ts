import { describe, it, expect } from 'vitest';
import { compileTargets, DEFAULT_TARGETS, matchTail } from '../core/protect.ts';
import { shellWrites, UNKNOWN } from '../core/shell.ts';

const U = UNKNOWN;
const paths = (line: string, opts: Parameters<typeof shellWrites>[1] = {}) => shellWrites(line, opts).map((w) => w.path);

describe("what the guard can't see", () => {
  const env = { TMPDIR: '/tmp/t', HOME: '/home/dev' };
  it.each<[string, string[]]>([
    ['rm $file', [U]],
    ['rm "$FOO/CLAUDE.md"', [`${U}/CLAUDE.md`]],
    ['rm $TMPDIR/x.txt', ['/tmp/t/x.txt']],
    ['rm ${TMPDIR}/x.txt', ['/tmp/t/x.txt']],
    ['TMPDIR=.claude/rules; rm $TMPDIR/x.md', [`${U}/x.md`]],
    ['export TMPDIR=x && rm ${TMPDIR}/y', [`${U}/y`]],
    ['for TMPDIR in a b; do rm $TMPDIR/z; done', [`${U}/z`]],
    ['rm a/$X/b.md', [`a/${U}/b.md`]],
    ['rm ~/notes.md', ['~/notes.md']],
    ['rm $HOME/notes.md', ['$HOME/notes.md']],
    ['rm $(cat list.txt)', [U]],
    ['rm `cat list.txt`', [U]],
    ['ls | xargs -I{} rm {}', [U]],
    ['ls | xargs -I % rm old/%', [`old/${U}`]],
    ['ls | xargs -i rm {}', [U]],
    ['sudo -u bob rm CLAUDE.md', ['CLAUDE.md']],
    ['sudo -g staff -- rm CLAUDE.md', ['CLAUDE.md']],
    // A cd in a subshell may not last, so the write is judged from both folders.
    ['(cd x && rm y)', ['y', 'x/y']],
  ])('%s', (line, expected) => {
    expect(paths(line, { env })).toEqual(expected);
  });
  it.each<[string, string[]]>([
    ['Set-Content a.md,CLAUDE.md x', ['a.md', 'CLAUDE.md']],
    ['Remove-Item -Path a.md,b.md', ['a.md', 'b.md']],
    ['Set-Content (Join-Path a b) x', [U]],
    ['Remove-Item $env:TEMP/x', [`${U}/x`]],
    ['Remove-Item %TEMP%/x', [`${U}/x`]],
    ['echo x > a(1)/CLAUDE.md', ['a']],
  ])('PowerShell: %s', (line, expected) => {
    expect(paths(line, { env: {}, win: true })).toEqual(expected);
  });
  it('reads a Windows environment variable in any case', () => {
    expect(paths('Remove-Item $env:temp/x', { env: { TEMP: 'C:/t' }, win: true })).toEqual(['C:/t/x']);
  });
});

describe('matchTail', () => {
  const targets = compileTargets(DEFAULT_TARGETS, { root: '/home/dev/repo', home: '/home/dev', win: false });
  it('finds a target when the visible tail looks protected', () => {
    expect(matchTail('CLAUDE.md', targets)?.pattern).toBe('CLAUDE.md');
    expect(matchTail('settings.json', targets)?.pattern).toBe('.claude/settings*.json');
    expect(matchTail('.claude/rules/x.md', targets)?.pattern).toBe('.claude/rules/**');
    expect(matchTail('rules/x.md', targets)?.pattern).toBe('.claude/rules/**');
  });
  it('lets a folder pattern’s ** take only what the tail shows, not the unknown part', () => {
    expect(matchTail('x.md', targets)).toBeNull();
    expect(matchTail('out/log.txt', targets)).toBeNull();
  });
  it('finds nothing for a path that is entirely unknown', () => {
    expect(matchTail('', targets)).toBeNull();
  });
  it('finds none for a tail no target can end in', () => {
    const narrow = compileTargets([{ pattern: 'CLAUDE.md', kind: 'rules', base: 'anywhere' }], { root: '/r', home: '/h', win: false });
    expect(matchTail('notes.txt', narrow)).toBeNull();
    expect(matchTail('a/CLAUDE.md', narrow)?.pattern).toBe('CLAUDE.md');
  });
});
