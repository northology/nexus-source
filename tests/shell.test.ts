import { describe, it, expect } from 'vitest';
import { postsGateAnswers, type ShellOptions, shellWrites, splitCommands } from '../core/shell.ts';

/** The paths a command line writes, in order: what most of these tests compare. */
const shellWriteTargets = (line: string, opts: ShellOptions = {}): string[] => shellWrites(line, opts).map((w) => w.path);

describe('splitCommands', () => {
  it('splits on separators and keeps quoted text whole', () => {
    expect(splitCommands(`git add CLAUDE.md && git commit -m "a > b; c"`)).toEqual([
      ['git', 'add', 'CLAUDE.md'],
      ['git', 'commit', '-m', 'a > b; c'],
    ]);
  });
});

describe('shellWriteTargets', () => {
  it.each<[string, string[]]>([
    ['echo x > CLAUDE.md', ['CLAUDE.md']],
    ['echo x>>CLAUDE.md', ['CLAUDE.md']],
    ['echo x >> "C:/Users/dev/.claude/projects/p/memory/a.md"', ['C:/Users/dev/.claude/projects/p/memory/a.md']],
    ['cat CLAUDE.md > notes.txt', ['notes.txt']],
    ['cat CLAUDE.md', []],
    ['npm test 2>&1 | tee out.log', ['out.log']],
    ['echo x | tee -a CLAUDE.md', ['CLAUDE.md']],
    ['cp draft.md CLAUDE.md', ['CLAUDE.md']],
    ['cp CLAUDE.md backup.md', ['backup.md']],
    ['mv -f a.json .claude/settings.json', ['a.json', '.claude/settings.json']],
    ["sed -i 's/a/b/' CLAUDE.md", ['CLAUDE.md']],
    ["sed -n '1,5p' CLAUDE.md", []],
    ["sed -i -e 's/a/b/' x.md y.md", ['x.md', 'y.md']],
    ['rm CLAUDE.md', ['CLAUDE.md']],
    ['FOO=1 sudo tee CLAUDE.md < input.txt', ['CLAUDE.md']],
    ['git add CLAUDE.md && git commit -m "x > y"', []],
    ["Set-Content -Path CLAUDE.md -Value 'x'", ['CLAUDE.md']],
    ["Set-Content CLAUDE.md -Value 'x'", ['CLAUDE.md']],
    ["Add-Content CLAUDE.md 'x'", ['CLAUDE.md']],
    ['"x" | Out-File -FilePath AGENTS.md', ['AGENTS.md']],
    ['Copy-Item -Path a.md -Destination CLAUDE.md', ['CLAUDE.md']],
    ['Remove-Item -Path .claude/rules/web.md', ['.claude/rules/web.md']],
    // Fix round 1: option values are per command
    ['rm -f CLAUDE.md', ['CLAUDE.md']],
    ['rm -rf .claude/rules', ['.claude/rules']],
    ['cp -f a.md CLAUDE.md', ['CLAUDE.md']],
    // sed in-place clusters and non-positional flags
    ["sed -i -E 's/a/b/' CLAUDE.md", ['CLAUDE.md']],
    ["sed -ni 's/a/b/p' CLAUDE.md", ['CLAUDE.md']],
    ["sed -i.bak 's/a/b/' CLAUDE.md", ['CLAUDE.md']],
    ["sed --in-place=.bak 's/a/b/' CLAUDE.md", ['CLAUDE.md']],
    ["sed -E 's/a/b/' CLAUDE.md", []],
    // clobber redirect
    ['echo x >| CLAUDE.md', ['CLAUDE.md']],
    ['echo x>|CLAUDE.md', ['CLAUDE.md']],
    // target directory
    ['mv -t .claude a.md', ['a.md', '.claude', '.claude/a.md']],
    ['cp --target-directory=.claude a.md', ['.claude', '.claude/a.md']],
    ['cp --target-directory .claude a.md', ['.claude', '.claude/a.md']],
    // PowerShell colon form
    ['Set-Content -Path:CLAUDE.md x', ['CLAUDE.md']],
    // command prefixes and paths to the command
    ['env FOO=1 tee CLAUDE.md', ['CLAUDE.md']],
    ['time cp a.md CLAUDE.md', ['CLAUDE.md']],
    ['/bin/rm CLAUDE.md', ['CLAUDE.md']],
    ['xargs rm CLAUDE.md', ['CLAUDE.md']],
    ['xargs rm', []],
    // groups and substitutions
    ['(echo x > CLAUDE.md)', ['CLAUDE.md']],
    ['{ echo x > CLAUDE.md; }', ['CLAUDE.md']],
    ['echo $(cat a) > CLAUDE.md', ['CLAUDE.md']],
    ['x=`date` && echo x > CLAUDE.md', ['CLAUDE.md']],
    // shell wrappers
    ['bash -c "echo x > CLAUDE.md"', ['CLAUDE.md']],
    ["nohup sh -c 'echo x > CLAUDE.md'", ['CLAUDE.md']],
    ['pwsh -Command "Set-Content CLAUDE.md x"', ['CLAUDE.md']],
    ['cmd /c "echo x > CLAUDE.md"', ['CLAUDE.md']],
    ['C:\\Windows\\System32\\cmd.exe /c "echo x > CLAUDE.md"', ['CLAUDE.md']],
    // more forms
    ['ln -sf x.md CLAUDE.md', ['CLAUDE.md']],
    ['Clear-Content CLAUDE.md', ['CLAUDE.md']],
    ['ri .claude/settings.json', ['.claude/settings.json']],
    // a move deletes its sources
    ['mv CLAUDE.md old.md', ['CLAUDE.md', 'old.md']],
    ['mv a.md b.md c/', ['a.md', 'b.md', 'c/', 'c/a.md', 'c/b.md']],
    ['Move-Item -Path CLAUDE.md -Destination old.md', ['CLAUDE.md', 'old.md']],
    ['Move-Item CLAUDE.md old.md', ['CLAUDE.md', 'old.md']],
    ['cp CLAUDE.md -t backup', ['backup', 'backup/CLAUDE.md']],
  ])('%s', (line, expected) => {
    expect(shellWriteTargets(line)).toEqual(expected);
  });
  it('marks what a command removes: delete operands, move sources and renamed paths', () => {
    expect(shellWrites('rm -rf .claude')).toEqual([{ path: '.claude', removes: true }]);
    expect(shellWrites('Remove-Item .claude -Recurse')).toEqual([{ path: '.claude', removes: true }]);
    expect(shellWrites('mv CLAUDE.md old.md')).toEqual([{ path: 'CLAUDE.md', removes: true }, { path: 'old.md', removes: false }]);
    expect(shellWrites('Rename-Item .claude -NewName old')).toEqual([{ path: '.claude', removes: true }, { path: 'old', removes: false }]);
    expect(shellWrites('cp -r .claude backup')).toEqual([{ path: 'backup', removes: false }]);
    expect(shellWrites('echo x > a.md && touch b.md')).toEqual([{ path: 'a.md', removes: false }, { path: 'b.md', removes: false }]);
  });
  it('does not see indirect writes (the documented gap)', () => {
    expect(shellWriteTargets(`python -c "open('CLAUDE.md','w').write('x')"`)).toEqual([]);
    expect(shellWriteTargets(`node -e "require('fs').writeFileSync('CLAUDE.md','x')"`)).toEqual([]);
  });
  it.each<[string, string[]]>([
    ['Rename-Item draft.md CLAUDE.md', ['draft.md', 'CLAUDE.md']],
    ['ren draft.md CLAUDE.md', ['draft.md', 'CLAUDE.md']],
    ['Rename-Item -Path draft.md -NewName CLAUDE.md', ['draft.md', 'CLAUDE.md']],
    ['rni docs/draft.md CLAUDE.md', ['docs/draft.md', 'docs/CLAUDE.md']],
  ])('reads a rename of %s as writing its new name', (line, paths) => {
    expect(shellWriteTargets(line)).toEqual(paths);
  });
});

describe('postsGateAnswers', () => {
  it.each([
    `curl -X POST -H "x-nexus-token: abc" -H "content-type: application/json" -d '{}' http://127.0.0.1:4400/api/builds/b/gates/g/answers`,
    'curl -s http://127.0.0.1:4400/ | grep nexus-token',
    `Invoke-WebRequest -Uri http://localhost:4400/api/builds/b/gates/g/answers -Method Post -Body '{}'`,
    `irm http://localhost:4400/api/builds/b/gates/g/answers -Method Post -Headers @{ 'x-nexus-token' = $t }`,
    `node -e "fetch('http://127.0.0.1:4400/api/builds/b/gates/g/answers', { method: 'POST' })"`,
    'wget -qO- --post-data "{}" http://127.0.0.1:4400/api/builds/b/gates/g/answers',
  ])('sees %s', (line) => {
    expect(postsGateAnswers(line)).toBe(true);
  });
  it.each([
    'grep -n x-nexus-token reference/cockpit.md',
    'cat .build/b/gates/g.answers.json',
    'curl -s https://example.com/api',
    'curl -s http://127.0.0.1:4400/api/builds/b',
  ])('ignores %s', (line) => {
    expect(postsGateAnswers(line)).toBe(false);
  });
  it('reads git fetch as git, and every other fetch as an HTTP client', () => {
    expect(postsGateAnswers('git fetch && grep nexus-token notes.txt')).toBe(false);
    expect(postsGateAnswers(`node -e "fetch('http://127.0.0.1:4410/api/builds/x/gates/y/answers', { method: 'POST' })"`)).toBe(true);
    expect(postsGateAnswers('curl -s http://127.0.0.1:4410/ | grep nexus-token')).toBe(true);
  });
  it('reads git and fetch split by a newline as two statements, so the fetch still counts', () => {
    expect(postsGateAnswers(`node -e "var git; git\nfetch('http://127.0.0.1:4410/api/builds/x/gates/y/answers',{method:'POST'})"`)).toBe(true);
  });
  it('still reads git fetch with spaces or tabs between the words as git', () => {
    expect(postsGateAnswers('git fetch && grep nexus-token')).toBe(false);
    expect(postsGateAnswers('git  fetch origin && grep nexus-token notes.txt')).toBe(false);
    expect(postsGateAnswers('git\tfetch origin && grep nexus-token notes.txt')).toBe(false);
  });
  it.each([
    `node -e "globalThis['fetch']('http://127.0.0.1:4410/api/builds/x/gates/y/answers', { method: 'POST' })"`,
    `node -e "const f=fetch; f('http://127.0.0.1:4410/api/builds/x/gates/y/answers', { method: 'POST' })"`,
    `git fetch . HEAD:main && node -e "const f=fetch; f('http://127.0.0.1:4410/api/builds/x/gates/y/answers')"`,
  ])('sees fetch that is not called directly: %s', (line) => {
    expect(postsGateAnswers(line)).toBe(true);
  });
});

describe('copies into a folder', () => {
  it.each<[string, string[]]>([
    ['cp a.md .claude/', ['.claude/', '.claude/a.md']],
    ['cp src/a.md src/b.md dir', ['dir', 'dir/a.md', 'dir/b.md']],
    ['cp -t dir src/a.md', ['dir', 'dir/a.md']],
    ['install -m 644 a.md dir/', ['dir/', 'dir/a.md']],
    ['Copy-Item src\\a.md -Destination dir\\', ['dir\\', 'dir\\a.md']],
    ['Copy-Item -Path a.md,b.md -Destination dir', ['dir', 'dir/a.md', 'dir/b.md']],
    ['cp -r src/ dir/', ['dir/', 'dir/src']],
  ])('%s writes into it', (line, expected) => {
    expect(shellWriteTargets(line)).toEqual(expected);
  });
  it("names the copy in a folder that exists, or in one it can't know", () => {
    expect(shellWriteTargets('cp a.md out', { isFolder: (p) => p === 'out' })).toEqual(['out', 'out/a.md']);
    expect(shellWriteTargets('cp a.md out')).toEqual(['out']);
    expect(shellWriteTargets('cp a.md $D')).toEqual(['\u0000', '\u0000/a.md']);
  });
  it("lists a folder a copy carries, and marks one it can't list", () => {
    const list = (p: string) => (p === 'x/deep/.' || p === 'src' ? ['.nexus/reviews/t.answers.json'] : null);
    const isFolder = (p: string) => p === 'dir' || p === 'src';
    expect(shellWriteTargets('cp -r x/deep/. out', { list })).toEqual(['out', 'out/.nexus/reviews/t.answers.json']);
    expect(shellWriteTargets('cp -rT src out', { list, isFolder })).toEqual(['out', 'out/.nexus/reviews/t.answers.json']);
    expect(shellWriteTargets('cp -r src dir', { list, isFolder })).toEqual(['dir', 'dir/src', 'dir/src/.nexus/reviews/t.answers.json']);
    expect(shellWriteTargets('cp -r x/other/. out', { list })).toEqual(['out', 'out/\u0000/\u0000']);
    expect(shellWriteTargets('cp -r $F out/')).toEqual(['out/', 'out/\u0000', 'out/\u0000/\u0000']);
    expect(shellWriteTargets('cp -r .claude backup')).toEqual(['backup']);
  });
  it('expands a source glob before it copies', () => {
    const expand = (p: string) => (p === 'x/*' ? ['x/.nexus'] : null);
    const list = (p: string) => (p === 'x/.nexus' ? ['reviews/t.answers.json'] : null);
    const isFolder = (p: string) => p === '.' || p === 'x/.nexus';
    expect(shellWriteTargets('Copy-Item x/* . -Recurse', { expand, list, isFolder })).toEqual(['.', './.nexus', './.nexus/reviews/t.answers.json']);
  });
  it('counts both landings when a -T could be a PowerShell parameter', () => {
    const list = (p: string) => (p === 'x/reviews' ? ['t.answers.json'] : null);
    const isFolder = (p: string) => p === '.nexus' || p === 'x/reviews';
    expect(shellWriteTargets('Copy-Item x/reviews .nexus -Recurse -PassThru', { list, isFolder })).toEqual(['.nexus', '.nexus/reviews', '.nexus/t.answers.json', '.nexus/reviews/t.answers.json']);
  });
  it('reads New-Item with an item type and a name', () => {
    expect(shellWriteTargets('New-Item -ItemType Directory .nexus')).toEqual(['.nexus']);
    expect(shellWriteTargets('New-Item -Path dir -Name a.md -ItemType File')).toEqual(['dir/a.md']);
  });
  it('reads truncate as a write', () => {
    expect(shellWriteTargets('truncate -s 0 CLAUDE.md')).toEqual(['CLAUDE.md']);
  });
});

describe('a cd before a write', () => {
  it.each<[string, string[]]>([
    ['cd .claude && echo x > a.md', ['.claude/a.md']],
    ['cd /abs && echo x > a.md', ['/abs/a.md']],
    ['cd a; cd b; echo x > c', ['a/b/c']],
    ['cd src && echo x > /abs/a', ['/abs/a']],
    ['pushd a; popd; echo x > c', ['c']],
    ['popd; echo x > c', ['\u0000/c']],
    ['cd -; echo x > c', ['\u0000/c']],
    ['cd; echo x > c', ['\u0000/c']],
    ['Set-Location -Path a; Set-Content b.md x', ['a/b.md']],
    ['cd /d E:\work && echo x > c', ['E:\work/c']],
    ['(cd a); echo x > c', ['c', 'a/c']],
  ])('%s', (line, expected) => {
    expect(shellWriteTargets(line)).toEqual(expected);
  });
});
