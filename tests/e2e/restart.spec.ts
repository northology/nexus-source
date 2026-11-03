import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { RESTART_PORT } from './fixtures';

const ARTIFACTS = fileURLToPath(new URL('../../', import.meta.url));
const B = 'relay-rebuild';
const BASE = `http://127.0.0.1:${RESTART_PORT}/`;

/** Starts a server on RESTART_PORT in a child process; each start makes a new token, as `nexus serve` does. */
function serve(root: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(ARTIFACTS, 'tests', 'e2e', 'serve-one.mjs'), root, String(RESTART_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((done, fail) => {
    let err = '';
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    child.stdout?.on('data', (d: Buffer) => {
      const ready = /nexus e2e one: \S+ home=(.+)/.exec(d.toString());
      if (ready?.[1]) {
        homes.set(child, ready[1].trim());
        done(child);
      }
    });
    child.on('exit', (code) => fail(new Error(`serve-one exited (${String(code)}): ${err}`)));
  });
}

/** Each child's temporary home, removed once it has stopped (a killed process can't remove its own). */
const homes = new Map<ChildProcess, string>();

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode === null) {
    await new Promise<void>((done) => {
      child.once('exit', () => done());
      child.kill();
    });
  }
  const home = homes.get(child);
  if (home) rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  homes.delete(child);
}

test('answers still go through after the server restarts on the same port, and nothing typed is lost', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-e2e-restart-'));
  cpSync(join(ARTIFACTS, 'reference', 'examples'), root, { recursive: true });
  const request = {
    name: 'restart-check',
    type: 'mark-list',
    title: 'Confirm the restart work',
    why: 'Mark both rows, then submit.',
    opened: '2026-10-02T20:40:00Z',
    items: [
      { name: 'keep-marks', text: 'Keep marks through a restart' },
      { name: 'keep-note', text: 'Keep the note through a restart' },
    ],
  };
  writeFileSync(join(root, '.build', B, 'gates', 'restart-check.json'), JSON.stringify(request));
  let server = await serve(root);
  try {
    await page.goto(`${BASE}#/gate/restart-check`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the restart work');
    const rows = page.locator('li.row');
    const note = page.getByLabel('Note to the agent (optional)');
    await page.getByRole('group', { name: 'Mark: Keep marks through a restart' }).getByRole('button', { name: 'Accept' }).click();
    await page.getByRole('group', { name: 'Mark: Keep the note through a restart' }).getByRole('button', { name: 'Decline' }).click();
    await note.fill('Typed before the restart.');

    // The server goes away: sending fails, and the marks and note stay put.
    await stop(server);
    await page.getByRole('button', { name: 'Submit marks' }).click();
    await expect(page.getByRole('alert')).toContainText('Cannot reach the nexus server');
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'accepted');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'declined');
    await expect(note).toHaveValue('Typed before the restart.');

    // It comes back on the same port with a new token; the tab reconnects and catches up.
    const caughtUp = page.waitForResponse((r) => r.url().endsWith(`/api/builds/${B}`) && r.status() === 200, { timeout: 15_000 });
    server = await serve(root);
    await caughtUp;
    await page.getByRole('button', { name: 'Submit marks' }).click();
    await expect(page.getByRole('status')).toContainText('The agent applies it on your next message');
    const answers = JSON.parse(readFileSync(join(root, '.build', B, 'gates', 'restart-check.answers.json'), 'utf8')) as Record<string, unknown>;
    expect(answers).toMatchObject({ marks: { 'keep-marks': 'accepted', 'keep-note': 'declined' }, note: 'Typed before the restart.' });
  } finally {
    await stop(server);
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('concept frames follow the asset origin to its new port after the server restarts', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-e2e-restart-'));
  cpSync(join(ARTIFACTS, 'reference', 'examples'), root, { recursive: true });
  let server = await serve(root);
  try {
    await page.goto(`${BASE}#/concepts/proposed?round=look`);
    const frame = page.locator('.cround iframe.cframe');
    await expect(frame).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:\d+\//);
    const before = new URL((await frame.getAttribute('src')) ?? '').port;
    expect(before).not.toBe(String(RESTART_PORT));

    // The asset listener takes a free port each start, so it comes back elsewhere; the frame follows it.
    await stop(server);
    server = await serve(root);
    await expect.poll(async () => new URL((await frame.getAttribute('src')) ?? '').port, { timeout: 15_000 }).not.toBe(before);
    const after = new URL((await frame.getAttribute('src')) ?? '').port;
    expect(after).not.toBe(String(RESTART_PORT));
    const res = await page.request.get((await frame.getAttribute('src')) ?? '');
    expect(res.status()).toBe(200);
  } finally {
    await stop(server);
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
