// Notes as files: creating, saving, renaming, discarding and noticing outside changes.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, seedNote, noteFiles, readNoteByTitle, metaOf, hostEvent, waitForSave, caretToEnd } from './fixtures.js';

const editor = (page) => page.locator('.nb-editor-content');
const back = (page) => page.getByRole('button', { name: 'Back', exact: true });

test('a new note is only written once it has content', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(editor(app)).toBeFocused();
  await waitForSave(app);
  expect(noteFiles(srv)).toEqual([]);
  await back(app).click();
  expect(noteFiles(srv)).toEqual([]);
  await expect(app.getByText('Notes you add appear here')).toBeVisible();
});

test('emptying a note and leaving discards it, like Keep', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(editor(app)).toBeFocused();
  await app.keyboard.type('temporary');
  await expect.poll(() => noteFiles(srv).length).toBe(1);
  await app.keyboard.press('Control+A');
  await app.keyboard.press('Backspace');
  await back(app).click();
  await expect(app.getByText('Empty note discarded')).toBeVisible();
  await expect.poll(() => noteFiles(srv).length).toBe(0);
});

test('changing the title renames the file and keeps one file per note', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'New note', exact: true }).click();
  await app.getByRole('textbox', { name: 'Title' }).fill('First title');
  await editor(app).click();
  await app.keyboard.type('Body text');
  await expect.poll(() => noteFiles(srv)[0] || '').toMatch(/^First title_/);
  const id = metaOf(readNoteByTitle(srv, 'First title')).id;
  await app.getByRole('textbox', { name: 'Title' }).fill('Second title');
  await expect.poll(() => noteFiles(srv)).toEqual([`Second title_${id}.html`]);
  expect(srv.listVault('notes').filter((f) => f.endsWith('.pbtmp'))).toEqual([]);
});

test('an existing note opens with its content and saves edits', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Packing', html: '<p>Passport</p>', color: 'mint' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Packing' }).click();
  await expect(editor(app)).toContainText('Passport');
  await expect(app.locator('.editor-page')).toHaveAttribute('data-color', 'mint');
  await editor(app).click();
  await caretToEnd(app);
  await app.keyboard.press('Enter');
  await app.keyboard.type('Charger');
  await expect.poll(() => fs.readFileSync(n.path, 'utf8')).toContain('<p>Passport</p><p>Charger</p>');
  const html = fs.readFileSync(n.path, 'utf8');
  expect(metaOf(html).color).toBe('mint');
  // the version before this editing session is in history
  const hist = srv.listVault(`history/${n.id}`);
  expect(hist.length).toBe(1);
  expect(srv.readVault(`history/${n.id}/${hist[0]}`)).not.toContain('Charger');
});

test('just reading a note does not rewrite it or touch "Edited"', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Read me', html: '<p>unchanged</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>item</p></li></ul>' });
  const before = fs.readFileSync(n.path, 'utf8');
  const mtime = fs.statSync(n.path).mtimeMs;
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Read me' }).click();
  await expect(editor(app)).toContainText('unchanged');
  await app.waitForTimeout(800);
  await back(app).click();
  await app.waitForTimeout(800);
  expect(fs.readFileSync(n.path, 'utf8')).toBe(before);
  expect(fs.statSync(n.path).mtimeMs).toBe(mtime);
  expect(srv.listVault(`history/${n.id}`)).toEqual([]);
});

test('opening a note that is already open goes back to it instead of opening it twice', async ({ app, srv }) => {
  const a = seedNote(srv, { title: 'Hub', html: '<p>start</p>' });
  seedNote(srv, { title: 'Spoke', html: `<p><a data-note-id="${a.id}" href="${encodeURIComponent(a.file)}">back to hub</a></p>` });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.getByRole('button', { name: 'Hub', exact: true }).click();
  await expect(editor(app)).toContainText('start');
  // open "Spoke" from the backlinks footer, then follow its link back to "Hub"
  await app.locator('.backlinks .chip', { hasText: 'Spoke' }).click();
  await expect(app.locator('.editor-page')).toHaveCount(2);
  await app.locator('.editor-page').last().locator('.nb-editor-content a').click();
  await app.getByRole('button', { name: 'Open link' }).click();
  await expect(app.locator('.editor-page')).toHaveCount(1);
  await expect(app.getByRole('textbox', { name: 'Title' })).toHaveValue('Hub');
});

test('notes added or changed by other apps show up after returning to the app', async ({ app, srv }) => {
  await expect(app.getByText('Notes you add appear here')).toBeVisible();
  const n = seedNote(srv, { title: 'From my laptop', html: '<p>synced by me</p>' });
  // a plain HTML file without Notebound metadata
  fs.writeFileSync(path.join(srv.state.vaultDir, 'notes', 'Old recipe.html'), '<html><head><title>Old recipe</title></head><body><p>Flour, water</p></body></html>');
  await hostEvent(app, 'resume', { pausedMs: 1000 });
  await expect(app.locator('.card', { hasText: 'From my laptop' })).toBeVisible();
  await expect(app.locator('.card', { hasText: 'Old recipe' })).toBeVisible();
  fs.writeFileSync(n.path, fs.readFileSync(n.path, 'utf8').replace('synced by me', 'edited elsewhere'));
  await hostEvent(app, 'resume', { pausedMs: 1000 });
  await expect(app.locator('.card', { hasText: 'edited elsewhere' })).toBeVisible();
  fs.unlinkSync(n.path);
  await hostEvent(app, 'resume', { pausedMs: 1000 });
  await expect(app.locator('.card', { hasText: 'From my laptop' })).toHaveCount(0);
});

test('an edit made outside the app while the note is open is kept in history', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Shared', html: '<p>v1</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Shared' }).click();
  await expect(editor(app)).toContainText('v1');
  await app.waitForTimeout(50);
  fs.writeFileSync(n.path, fs.readFileSync(n.path, 'utf8').replace('<p>v1</p>', '<p>outside edit</p>'));
  await editor(app).click();
  await caretToEnd(app);
  await app.keyboard.type(' inside');
  await expect(app.getByText('This note was changed outside Notebound')).toBeVisible({ timeout: 5000 });
  const hist = srv.listVault(`history/${n.id}`).map((f) => srv.readVault(`history/${n.id}/${f}`));
  expect(hist.some((h) => h.includes('outside edit'))).toBe(true);
  expect(fs.readFileSync(n.path, 'utf8')).toContain('v1 inside');
});

test('a copied note file gets its own id; two files claiming one id are merged safely', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Original', html: '<p>one</p>' });
  fs.copyFileSync(n.path, path.join(srv.state.vaultDir, 'notes', 'Original copy.html'));
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'Original' })).toHaveCount(2);
  const ids = noteFiles(srv).map((f) => metaOf(srv.readVault('notes/' + f)).id);
  expect(new Set(ids).size).toBe(2);
});

test('a half-finished write (.pbtmp) is recovered on the next scan', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Crash test', html: '<p>old</p>' });
  const newer = fs.readFileSync(n.path, 'utf8').replace('<p>old</p>', '<p>new</p>');
  fs.unlinkSync(n.path);
  fs.writeFileSync(n.path + '.pbtmp', newer);
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'new' })).toBeVisible();
  expect(fs.existsSync(n.path)).toBe(true);
  expect(fs.existsSync(n.path + '.pbtmp')).toBe(false);
});

test('the index cache makes the next start show notes before the folder is read', async ({ app, srv, page }) => {
  seedNote(srv, { title: 'Cached note', html: '<p>hello</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'Cached note' })).toBeVisible();
  await app.waitForTimeout(1500); // cache is written after a short delay
  expect(fs.existsSync(path.join(srv.state.privateDir, 'index-v2.json'))).toBe(true);
  srv.state.delay = { list: 1500 }; // slow folder: the cached list must appear first
  await page.reload();
  await expect(app.locator('.card', { hasText: 'Cached note' })).toBeVisible({ timeout: 1000 });
});

test('a note written while the folder is still being read is not lost', async ({ app, srv, page }) => {
  for (let i = 0; i < 5; i++) seedNote(srv, { title: `Existing ${i}`, html: '<p>x</p>' });
  srv.state.delay = { readMany: 2500 }; // a slow first scan
  await page.reload();
  await app.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(editor(app)).toBeFocused();
  await app.keyboard.type('Quick thought');
  await expect.poll(() => noteFiles(srv).length).toBe(6);
  await app.waitForTimeout(2800); // the scan finishes now
  await app.keyboard.type(' and more');
  await expect.poll(() => noteFiles(srv).map((f) => srv.readVault('notes/' + f)).some((t) => t.includes('Quick thought and more'))).toBe(true);
  await back(app).click();
  await expect(app.locator('.card', { hasText: 'Quick thought' })).toBeVisible();
  await expect(app.locator('.card')).toHaveCount(6);
});

test('pictures still show when only the note file reaches the browser (Android Files app)', async ({ app, srv, browser }) => {
  srv.state.picks.images = [path.join(path.resolve('tests/assets'), 'photo-mountains.jpg')];
  await app.getByRole('button', { name: 'New image note', exact: true }).click();
  await expect(app.locator('.nb-editor-content figure.nb-image img')).toBeVisible();
  await app.getByRole('textbox', { name: 'Title' }).fill('Mountains');
  await expect.poll(() => (noteFiles(srv)[0] ? srv.readVault('notes/' + noteFiles(srv)[0]) : '')).toContain('data-preview="data:image/jpeg;base64,');
  const html = srv.readVault('notes/' + noteFiles(srv)[0]);
  expect(html).toContain('onerror="this.onerror=null;this.src=this.getAttribute(\'data-preview\')"');
  expect(html).toMatch(/src="\.\.\/attachments\/photo-mountains-[a-z0-9]+\.jpg"/);
  // the preview is small: a few dozen KB, not the whole photo again
  const preview = /data-preview="([^"]+)"/.exec(html)[1];
  expect(preview.length).toBeLessThan(120000);
  // copy the note file alone somewhere else, as the Files app hands it to a browser
  const lonely = path.join(srv.state.base, 'alone');
  fs.mkdirSync(lonely, { recursive: true });
  fs.writeFileSync(path.join(lonely, 'note.html'), html);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('file://' + path.join(lonely, 'note.html'));
  const img = p.locator('.nb-content img');
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(100);
  expect(await img.evaluate((el) => el.currentSrc.slice(0, 22))).toBe('data:image/jpeg;base64');
  // next to its attachments folder, the full picture is used
  const p2 = await ctx.newPage();
  await p2.goto('file://' + srv.vaultFile('notes/' + noteFiles(srv)[0]));
  await expect.poll(() => p2.locator('.nb-content img').evaluate((el) => el.complete && el.naturalWidth)).toBe(800);
  await ctx.close();
});


test('note files open nicely in a normal browser', async ({ app, srv, browser }) => {
  await app.getByRole('button', { name: 'New list', exact: true }).click();
  await app.getByRole('textbox', { name: 'Title' }).fill('Browser view');
  await app.locator('.nb-editor-content li p').first().click();
  await app.keyboard.type('Milk');
  await expect.poll(() => (noteFiles(srv)[0] ? srv.readVault('notes/' + noteFiles(srv)[0]) : '')).toContain('<p>Milk</p>');
  const file = srv.vaultFile('notes/' + noteFiles(srv)[0]);
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto('file://' + file);
  await expect(p.locator('h1')).toHaveText('Browser view');
  await expect(p.locator('li[data-type="taskItem"]')).toContainText('Milk');
  await ctx.close();
});

test('a save that fails is tried again, and Back does not throw the text away', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Draft', html: '<p>first line</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Draft' }).click();
  await editor(app).locator('p', { hasText: 'first line' }).click();
  fs.mkdirSync(n.path + '.pbtmp'); // the next save cannot write its temporary file (like a full phone)
  await app.keyboard.press('End');
  await app.keyboard.type(' and an important second sentence');
  await expect(app.getByText(/Could not save/)).toBeVisible({ timeout: 10000 });
  // still failing: Back keeps the note open
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.getByText(/Your text is still here/)).toBeVisible();
  await expect(editor(app)).toContainText('important second sentence');
  // the problem is gone: Back saves and closes
  fs.rmdirSync(n.path + '.pbtmp');
  await hostEvent(app, 'back');
  await expect(app.locator('.editor-page')).toHaveCount(0);
  expect(fs.readFileSync(n.path, 'utf8')).toContain('important second sentence');
});
