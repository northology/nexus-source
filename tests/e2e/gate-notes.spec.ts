import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildDir, urlFor } from './fixtures';

test('a row marked research or declined opens its note; notes reach the answers file', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate/notes-check'));
  const group = (text: string) => page.getByRole('group', { name: `Mark: ${text}` });
  await group('Errors name the source').getByRole('button', { name: 'Decline' }).click();
  await page.getByLabel('Note on: Errors name the source', { exact: true }).fill('Name the source and the time.');
  await group('Empty state says "No lag yet"').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByLabel('Note on: Empty state says "No lag yet"', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add note on: Empty state says "No lag yet"' }).click();
  await page.getByLabel('Note on: Empty state says "No lag yet"', { exact: true }).fill('  Keep it short.  ');
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.getByRole('status')).toContainText('The agent applies it on your next message');
  const answers = JSON.parse(readFileSync(join(buildDir('gates'), 'gates', 'notes-check.answers.json'), 'utf8')) as Record<string, unknown>;
  expect(answers).toMatchObject({ marks: { 'empty-copy': 'accepted', 'error-copy': 'declined' }, notes: { 'error-copy': 'Name the source and the time.', 'empty-copy': 'Keep it short.' } });
  await expect(page.getByText('Note: Keep it short.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add note on/ })).toHaveCount(0);
});

const answersFor = (gate: string) => JSON.parse(readFileSync(join(buildDir('gates'), 'gates', `${gate}.answers.json`), 'utf8')) as Record<string, unknown>;

test('a whitespace-only row note is not posted, and the gate-wide note is saved beside the row notes', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate/notes-blank'));
  const group = (text: string) => page.getByRole('group', { name: `Mark: ${text}` });
  await group('Replay banner says "Replaying"').getByRole('button', { name: 'Decline' }).click();
  await page.getByLabel('Note on: Replay banner says "Replaying"', { exact: true }).fill('   ');
  await group('Replay ends with a summary').getByRole('button', { name: 'Decline' }).click();
  await page.getByLabel('Note on: Replay ends with a summary', { exact: true }).fill('Say how many messages ran.');
  await page.getByLabel('Note to the agent (optional)').fill('Both lines matter for the demo.');
  await page.getByRole('button', { name: 'Submit marks' }).click();
  await expect(page.getByRole('status')).toContainText('The agent applies it on your next message');
  const answers = answersFor('notes-blank');
  expect(answers).toMatchObject({ marks: { 'blank-copy': 'declined', 'kept-copy': 'declined' }, notes: { 'kept-copy': 'Say how many messages ran.' }, note: 'Both lines matter for the demo.' });
  expect(answers['notes']).not.toHaveProperty('blank-copy');
});

test('typing r or d inside a note box does not mark the row', async ({ page }) => {
  await page.goto(urlFor('gates', '#/gate/notes-keys'));
  const row = page.getByRole('listitem', { name: /^Replay has a stop button/ });
  await row.getByRole('group', { name: 'Mark: Replay has a stop button' }).getByRole('button', { name: 'Accept' }).click();
  await expect(row).toHaveAttribute('data-state', 'accepted');
  await page.getByRole('button', { name: 'Add note on: Replay has a stop button' }).click();
  const note = page.getByLabel('Note on: Replay has a stop button', { exact: true });
  await note.click();
  await page.keyboard.type('rd');
  await expect(note).toHaveValue('rd');
  await expect(row).toHaveAttribute('data-state', 'accepted');
});
