// A notes folder written by the first test builds (named Pocketbook) opens in
// Notebound as it is. The fixture was made by that build itself.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, metaOf } from './fixtures.js';

const FIXTURE = path.resolve('tests/assets/legacy-pocketbook-folder');
const editor = (page) => page.locator('.nb-editor-content');
const noteFile = (srv, prefix) => srv.vaultFile('notes/' + fs.readdirSync(srv.vaultFile('notes')).find((f) => f.startsWith(prefix)));

async function openLegacy(page, srv) {
  fs.cpSync(FIXTURE, srv.state.vaultDir, { recursive: true });
  const before = {};
  for (const f of fs.readdirSync(srv.vaultFile('notes'))) before[f] = fs.readFileSync(srv.vaultFile('notes/' + f), 'utf8');
  before.config = fs.readFileSync(srv.vaultFile('pocketbook.json'), 'utf8');
  await page.goto(srv.appUrl);
  await expect(page.locator('.card', { hasText: 'Shopping' })).toBeVisible();
  return before;
}

test('notes, labels, colours and settings from a Pocketbook folder all show up', async ({ page, srv }) => {
  const before = await openLegacy(page, srv);
  for (const t of ['Shopping', 'Dinner', 'Sketch', 'Secret diary']) await expect(page.locator('.card', { hasText: t })).toBeVisible();
  // dark theme and the labels list came from pocketbook.json
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const conf = JSON.parse(fs.readFileSync(srv.vaultFile('notebound.json'), 'utf8'));
  const old = JSON.parse(before.config);
  expect(conf.format).toBe('notebound');
  expect(conf.labels).toEqual(['home', 'food', 'work']);
  expect(conf.settings.cardLines).toBe(6);
  expect(conf.vault).toEqual(old.vault);
  // the old file is left exactly as it was
  expect(fs.readFileSync(srv.vaultFile('pocketbook.json'), 'utf8')).toBe(before.config);
  // the card: pinned, coloured, labelled, secret masked
  const card = page.locator('.card', { hasText: 'Shopping' });
  await expect(card).toHaveAttribute('data-color', 'sage');
  await expect(card).toContainText('home');
  await expect(card).not.toContainText('1234');
  // just opening the folder rewrites no note
  await page.waitForTimeout(3500);
  for (const [f, text] of Object.entries(before)) {
    if (f !== 'config') expect(fs.readFileSync(srv.vaultFile('notes/' + f), 'utf8')).toBe(text);
  }
});

test('a Pocketbook note opens with its small text and spoiler, and is saved in the new format when edited', async ({ page, srv }) => {
  await openLegacy(page, srv);
  const file = noteFile(srv, 'Shopping');
  const id = metaOf(fs.readFileSync(file, 'utf8').replace('pocketbook-meta', 'notebound-meta')).id;
  await page.locator('.card', { hasText: 'Shopping' }).click();
  await expect(editor(page).locator('p.nb-small')).toHaveText('small print');
  await expect(editor(page).locator('li[data-type="taskItem"]')).toHaveCount(2);
  await expect(editor(page).locator('.spoiler')).toHaveText('1234');
  await editor(page).locator('p.nb-small').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' here');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 10000 }).toContain('small print here');
  const text = fs.readFileSync(file, 'utf8');
  expect(text).toContain('id="notebound-meta"');
  expect(text).not.toContain('pocketbook-meta');
  expect(text).toContain('<p class="nb-small">small print here</p>');
  const meta = metaOf(text);
  expect(meta.id).toBe(id);
  expect(meta.format).toBe('notebound');
  expect(meta.color).toBe('sage');
  expect(meta.pattern).toBe('grid');
  expect(meta.labels).toEqual(['home']);
  expect(meta.pinned).toBe(true);
});

test('a locked Pocketbook note opens with the old vault password', async ({ page, srv }) => {
  await openLegacy(page, srv);
  await page.locator('.card', { hasText: 'Secret diary' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Locked note' })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('textbox').fill('wrong-one');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Wrong password')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('textbox').fill('legacy-pw');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(editor(page)).toContainText('only for me');
});

test('a Pocketbook drawing can still be edited stroke by stroke', async ({ page, srv }) => {
  await openLegacy(page, srv);
  await page.locator('.card', { hasText: 'Sketch' }).click();
  await editor(page).locator('figure.nb-image').click();
  await page.getByRole('menuitem', { name: 'Edit drawing' }).click();
  await expect(page.getByLabel('Drawing canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo stroke' })).toBeEnabled();
});

test('the photo in a Pocketbook note still shows, also in a browser that only gets the note file', async ({ page, srv, browser }) => {
  await openLegacy(page, srv);
  await page.locator('.card', { hasText: 'Dinner' }).click();
  await expect.poll(() => editor(page).locator('img').evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(100);
  const lonely = path.join(srv.state.vaultDir, '..', 'lonely-' + Date.now());
  fs.mkdirSync(lonely);
  fs.copyFileSync(noteFile(srv, 'Dinner'), path.join(lonely, 'note.html'));
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('file://' + path.join(lonely, 'note.html'));
  await expect.poll(() => p.locator('img').evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(100);
  await ctx.close();
});

test.describe('choosing a Pocketbook folder on first start', () => {
  test.use({ srvOptions: { hasFolder: false } });

  test('opens its notes straight away', async ({ app, srv }) => {
    fs.cpSync(FIXTURE, srv.state.vaultDir, { recursive: true });
    await app.getByRole('button', { name: 'Choose folder' }).click();
    await expect(app.locator('.card', { hasText: 'Shopping' })).toBeVisible();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('is recognised by its pocketbook.json even before it has notes', async ({ app, srv }) => {
    fs.copyFileSync(path.join(FIXTURE, 'pocketbook.json'), path.join(srv.state.vaultDir, 'pocketbook.json'));
    fs.writeFileSync(path.join(srv.state.vaultDir, 'shopping ideas.txt'), 'not a note');
    await app.getByRole('button', { name: 'Choose folder' }).click();
    // no "make a Notebound folder inside it?" question: it is used as it is
    await expect(app.getByRole('button', { name: 'Search your notes' })).toBeVisible();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(srv.state.vaultDir.endsWith(path.join('Notebound', 'Notebound'))).toBe(false);
  });
});
