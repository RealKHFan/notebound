// Home screen: pinning, colors, labels, notebooks, archive, trash, selection, ordering and search.
import fs from 'node:fs';
import { test, expect, seedNote, noteFiles, metaOf, hostEvent, dialogButton } from './fixtures.js';

const card = (page, text) => page.locator('.card', { hasText: text });
const metaById = (srv, id) => metaOf(srv.readVault('notes/' + noteFiles(srv).find((f) => f.endsWith(`_${id}.html`))));

async function seeded(app, srv, notes) {
  const out = notes.map((n, i) => seedNote(srv, { order: 1000 - i, ...n }));
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(card(app, notes[0].title)).toBeVisible();
  return out;
}

async function longPress(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(30, b.height / 2));
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

test('pin from the editor moves the note to Pinned with a ribbon', async ({ app, srv }) => {
  const [a] = await seeded(app, srv, [{ title: 'Alpha', html: '<p>a</p>' }, { title: 'Beta', html: '<p>b</p>' }]);
  await card(app, 'Alpha').click();
  await app.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect.poll(() => metaById(srv, a.id).pinned).toBe(true);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.section-label', { hasText: 'Pinned' })).toBeVisible();
  await expect(card(app, 'Alpha').locator('.ribbon')).toBeVisible();
});

test('color and background pattern from the editor', async ({ app, srv }) => {
  const [a] = await seeded(app, srv, [{ title: 'Paint me', html: '<p>x</p>' }]);
  await card(app, 'Paint me').click();
  await app.getByRole('button', { name: 'Color and background' }).click();
  await app.getByRole('radio', { name: 'Sage' }).click();
  await app.getByRole('radio', { name: 'Grid' }).click();
  await expect.poll(() => metaById(srv, a.id)).toMatchObject({ color: 'sage', pattern: 'grid' });
  await expect(app.locator('.editor-page')).toHaveAttribute('data-color', 'sage');
  const file = srv.readVault('notes/' + noteFiles(srv)[0]);
  expect(file).toContain('data-color="sage" data-pattern="grid"');
  // the pattern is drawn on the open note and on its card, in a dark ink on light themes...
  const bg = (loc) => loc.evaluate((el) => decodeURIComponent(getComputedStyle(el).backgroundImage));
  await expect.poll(() => bg(app.locator('.editor-page'))).toContain('rgba(40,46,60,0.14)');
  await app.keyboard.press('Escape');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => bg(card(app, 'Paint me'))).toContain('rgba(40,46,60,0.14)');
  // ...and in a light ink on dark ones, so it stays visible
  await app.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect.poll(() => bg(card(app, 'Paint me'))).toContain('rgba(255,255,255,0.13)');
});

test('labels: create from a note, filter by label, rename and delete', async ({ app, srv }) => {
  const [a, b] = await seeded(app, srv, [{ title: 'Taxes', html: '<p>x</p>' }, { title: 'Holiday', html: '<p>y</p>' }]);
  await card(app, 'Taxes').click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Labels' }).click();
  await app.getByRole('textbox', { name: 'Search or create label' }).fill('Finance');
  await app.getByRole('button', { name: 'Create "Finance"' }).click();
  await expect.poll(() => metaById(srv, a.id).labels).toEqual(['Finance']);
  await app.keyboard.press('Escape');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(card(app, 'Taxes').locator('.chip', { hasText: 'Finance' })).toBeVisible();
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).labels).toContain('Finance');
  // drawer -> label view
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-item', { hasText: 'Finance' }).click();
  await expect(app.locator('.view-title')).toHaveText('Finance');
  await expect(card(app, 'Taxes')).toBeVisible();
  await expect(card(app, 'Holiday')).toHaveCount(0);
  // new note inside a label view gets the label
  await app.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(app.locator('.nb-editor-content')).toBeFocused();
  await app.keyboard.type('Receipt');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(card(app, 'Receipt')).toBeVisible();
  // rename
  await app.getByRole('button', { name: 'Label options' }).click();
  await app.getByRole('menuitem', { name: 'Rename label' }).click();
  await app.getByRole('textbox').fill('Money');
  await dialogButton(app, 'Rename').click();
  await expect(app.locator('.view-title')).toHaveText('Money');
  await expect.poll(() => metaById(srv, a.id).labels).toEqual(['Money']);
  // delete
  await app.getByRole('button', { name: 'Label options' }).click();
  await app.getByRole('menuitem', { name: 'Delete label' }).click();
  await dialogButton(app, 'Delete').click();
  await expect.poll(() => metaById(srv, a.id).labels).toEqual([]);
  expect(noteFiles(srv).length).toBe(3);
  expect(metaById(srv, b.id).labels).toEqual([]);
});

test('notebooks with sub-notebooks', async ({ app, srv }) => {
  const [a] = await seeded(app, srv, [{ title: 'Rome hotels', html: '<p>x</p>' }, { title: 'Other', html: '<p>y</p>' }]);
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-section button', { hasText: 'New' }).click();
  await app.getByRole('textbox').fill('Trips');
  await dialogButton(app, 'Create').click();
  await expect(app.locator('.view-title')).toHaveText('Trips');
  await app.getByRole('button', { name: 'Notebook options' }).click();
  await app.getByRole('menuitem', { name: 'Add sub-notebook' }).click();
  await app.getByRole('textbox').fill('Italy');
  await dialogButton(app, 'Create').click();
  await expect(app.locator('.chip', { hasText: 'Italy' })).toBeVisible();
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).notebooks.length).toBe(2);
  const conf = JSON.parse(srv.readVault('notebound.json'));
  const trips = conf.notebooks.find((n) => n.name === 'Trips');
  const italy = conf.notebooks.find((n) => n.name === 'Italy');
  expect(italy.parent).toBe(trips.id);
  // put a note into Italy from the home selection
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-item', { hasText: 'Notes' }).first().click();
  await longPress(app, card(app, 'Rome hotels'));
  await app.getByRole('button', { name: 'More', exact: true }).click();
  await app.getByRole('menuitem', { name: 'Notebooks' }).click();
  await app.getByRole('menuitemcheckbox', { name: 'Italy' }).click();
  await expect.poll(() => metaById(srv, a.id).notebooks).toEqual([italy.id]);
  await app.keyboard.press('Escape');
  await app.keyboard.press('Escape');
  // the parent notebook shows notes of its sub-notebooks
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-item', { hasText: 'Trips' }).click();
  await expect(card(app, 'Rome hotels')).toBeVisible();
  await expect(card(app, 'Other')).toHaveCount(0);
  // deleting the notebook keeps the notes
  await app.getByRole('button', { name: 'Notebook options' }).click();
  await app.getByRole('menuitem', { name: 'Delete notebook' }).click();
  await dialogButton(app, 'Delete').click();
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).notebooks.length).toBe(0);
  await expect.poll(() => metaById(srv, a.id).notebooks).toEqual([]);
});

test('archive by swiping a card, undo, and the archive view', async ({ app, srv }) => {
  const [a] = await seeded(app, srv, [{ title: 'Swipe me', html: '<p>x</p>' }, { title: 'Stay', html: '<p>y</p>' }]);
  const b = await card(app, 'Swipe me').boundingBox();
  await app.mouse.move(b.x + 20, b.y + 20);
  await app.mouse.down();
  for (let i = 1; i <= 10; i++) await app.mouse.move(b.x + 20 + i * 18, b.y + 22);
  await app.mouse.up();
  await expect(app.getByText('Note archived')).toBeVisible();
  await expect.poll(() => metaById(srv, a.id).archived).toBe(true);
  await expect(card(app, 'Swipe me')).toHaveCount(0);
  await app.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => metaById(srv, a.id).archived).toBe(false);
  await expect(card(app, 'Swipe me')).toBeVisible();
  // archive from the editor, then find it in Archive
  await card(app, 'Swipe me').click();
  await app.getByRole('button', { name: 'Archive' }).click();
  await expect.poll(() => metaById(srv, a.id).archived).toBe(true);
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-item', { hasText: 'Archive' }).click();
  await expect(card(app, 'Swipe me')).toBeVisible();
  await expect(card(app, 'Stay')).toHaveCount(0);
});

test('trash: delete, restore, delete forever, empty trash', async ({ app, srv }) => {
  const [a, b, c] = await seeded(app, srv, [{ title: 'One', html: '<p>1</p>' }, { title: 'Two', html: '<p>2</p>' }, { title: 'Three', html: '<p>3</p>' }]);
  for (const t of ['One', 'Two', 'Three']) {
    await card(app, t).click();
    await app.getByRole('button', { name: 'More options' }).click();
    await app.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(app.getByText('Note moved to trash')).toBeVisible();
  }
  await expect.poll(() => [a, b, c].map((n) => !!metaById(srv, n.id).trashed)).toEqual([true, true, true]);
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-item', { hasText: 'Trash' }).click();
  await expect(app.getByText('Notes in trash are deleted after 7 days.')).toBeVisible();
  // restore one
  await longPress(app, card(app, 'One'));
  await app.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => metaById(srv, a.id).trashed).toBe(null);
  // delete one forever
  await longPress(app, card(app, 'Two'));
  await app.getByRole('button', { name: 'Delete forever' }).click();
  await dialogButton(app, 'Delete forever').click();
  await expect.poll(() => noteFiles(srv).length).toBe(2);
  // empty the rest
  await app.getByRole('button', { name: 'Empty trash' }).first().click();
  await dialogButton(app, 'Empty trash').click();
  await expect.poll(() => noteFiles(srv).length).toBe(1);
  await expect(app.getByText('No notes in trash')).toBeVisible();
});

test('old notes in trash are removed automatically, attachments only when unused', async ({ app, srv, page }) => {
  fs.mkdirSync(srv.vaultFile('attachments'), { recursive: true });
  fs.writeFileSync(srv.vaultFile('attachments/only-old.png'), 'x');
  fs.writeFileSync(srv.vaultFile('attachments/shared.png'), 'x');
  const old = seedNote(srv, { title: 'Ancient', html: '<img src="../attachments/only-old.png"><img src="../attachments/shared.png">', trashed: new Date(Date.now() - 9 * 86400000).toISOString() });
  seedNote(srv, { title: 'Recent trash', html: '<p>x</p>', trashed: new Date(Date.now() - 2 * 86400000).toISOString() });
  seedNote(srv, { title: 'Keeper', html: '<img src="../attachments/shared.png">' });
  await page.reload();
  await expect(card(app, 'Keeper')).toBeVisible();
  await expect.poll(() => fs.existsSync(old.path)).toBe(false);
  await expect.poll(() => fs.existsSync(srv.vaultFile('attachments/only-old.png'))).toBe(false);
  expect(fs.existsSync(srv.vaultFile('attachments/shared.png'))).toBe(true);
  expect(noteFiles(srv).length).toBe(2);
});

test('multi-select: pin, color, archive and copy several notes', async ({ app, srv }) => {
  const [a, b] = await seeded(app, srv, [{ title: 'First', html: '<p>1</p>' }, { title: 'Second', html: '<p>2</p>' }, { title: 'Third', html: '<p>3</p>' }]);
  await longPress(app, card(app, 'First'));
  await expect(app.locator('.selection-bar .count')).toHaveText('1');
  await card(app, 'Second').click();
  await expect(app.locator('.selection-bar .count')).toHaveText('2');
  await app.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect.poll(() => [metaById(srv, a.id).pinned, metaById(srv, b.id).pinned]).toEqual([true, true]);
  await app.getByRole('button', { name: 'Color', exact: true }).click();
  await app.getByRole('radio', { name: 'Butter' }).click();
  await expect.poll(() => [metaById(srv, a.id).color, metaById(srv, b.id).color]).toEqual(['butter', 'butter']);
  await app.keyboard.press('Escape');
  await app.getByRole('button', { name: 'More', exact: true }).click();
  await app.getByRole('menuitem', { name: 'Make a copy' }).click();
  await expect.poll(() => noteFiles(srv).length).toBe(5);
  await longPress(app, card(app, 'Third'));
  await app.getByRole('button', { name: 'Archive' }).click();
  await expect(card(app, 'Third')).toHaveCount(0);
});

test('drag a card to reorder (custom order is saved in the files)', async ({ app, srv }) => {
  const [a, b, c] = await seeded(app, srv, [{ title: 'Card A', html: '<p>a</p>' }, { title: 'Card B', html: '<p>b</p>' }, { title: 'Card C', html: '<p>c</p>' }]);
  await app.getByRole('button', { name: 'List view' }).click();
  await expect.poll(async () => (await card(app, 'Card A').boundingBox()).width).toBeGreaterThan(300);
  const from = await card(app, 'Card C').boundingBox();
  const to = await card(app, 'Card A').boundingBox();
  await app.mouse.move(from.x + 40, from.y + 20);
  await app.mouse.down();
  await app.waitForTimeout(600);
  for (let i = 1; i <= 12; i++) await app.mouse.move(from.x + 40, from.y + 20 + ((to.y + 10 - from.y - 20) * i) / 12);
  await app.mouse.up();
  await expect.poll(() => {
    const m = [a, b, c].map((n) => metaById(srv, n.id).order);
    return m[2] > m[0] && m[0] > m[1];
  }).toBe(true);
  const titles = await app.locator('.card-title').allTextContents();
  // positions follow the new order
  const ys = await Promise.all(['Card C', 'Card A', 'Card B'].map(async (t) => (await card(app, t).boundingBox()).y));
  expect(ys[0]).toBeLessThan(ys[1]);
  expect(ys[1]).toBeLessThan(ys[2]);
  expect(titles.length).toBe(3);
});

test('a dragged card sticks to the finger and the list scrolls near the edge', async ({ app, srv }) => {
  const notes = Array.from({ length: 24 }, (_, i) => ({ title: `Long ${String(i).padStart(2, '0')}`, html: '<p>line one</p><p>line two</p><p>line three</p>' }));
  await seeded(app, srv, notes);
  await app.getByRole('button', { name: 'List view' }).click();
  const first = card(app, 'Long 00');
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  await app.mouse.move(box.x + 40, box.y + 20);
  await app.mouse.down();
  await app.waitForTimeout(600);
  await app.mouse.move(box.x + 40, box.y + 60);
  const slot = app.locator('.card-slot.drag-slot');
  await expect(slot).toHaveCount(1);
  expect(await slot.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  // the card moved with the finger right away (no animation lag)
  const moved = await first.boundingBox();
  expect(Math.abs(moved.y - (box.y + 40))).toBeLessThan(6);
  // resting near the bottom edge scrolls the list
  const scroller = app.locator('.home-scroll');
  const view = await scroller.boundingBox();
  await app.mouse.move(box.x + 40, view.y + view.height - 20);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
  await app.mouse.up();
  await expect(app.locator('.card-slot.drag-slot')).toHaveCount(0);
});

test('sort by title and toggle grid/list layout (saved in notebound.json)', async ({ app, srv }) => {
  await seeded(app, srv, [{ title: 'Banana', html: '<p>x</p>' }, { title: 'apple', html: '<p>y</p>' }, { title: 'Cherry', html: '<p>z</p>' }]);
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.getByRole('button', { name: 'Settings' }).click();
  await app.locator('.setting', { hasText: 'Sort notes' }).click();
  await app.getByRole('menuitem', { name: 'Title' }).click();
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await app.getByRole('button', { name: 'List view' }).click();
  await expect.poll(async () => (await app.locator('.card-title').first().boundingBox()).width).toBeGreaterThan(250);
  const ys = await Promise.all(['apple', 'Banana', 'Cherry'].map(async (t) => (await card(app, t).boundingBox()).y));
  expect(ys[0]).toBeLessThan(ys[1]);
  expect(ys[1]).toBeLessThan(ys[2]);
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).settings).toMatchObject({ sort: 'title', layout: 'list' });
});

test('search by text, accents, labels and filters', async ({ app, srv }) => {
  await seeded(app, srv, [
    { title: 'Crème brûlée', html: '<p>vanilla custard</p>', labels: ['Recipes'] },
    { title: 'Groceries', html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>vanilla</p></li></ul>', color: 'butter' },
    { title: 'Photo', html: '<img src="../attachments/x.png">' },
    { title: 'Old', html: '<p>vanilla</p>', archived: true },
    { title: 'Deleted', html: '<p>vanilla</p>', trashed: new Date().toISOString() },
  ]);
  await app.getByRole('button', { name: 'Search your notes' }).click();
  await expect(app.getByRole('heading', { name: 'Types' })).toBeVisible();
  await app.getByRole('searchbox', { name: 'Search' }).fill('creme');
  await expect(card(app, 'Crème brûlée')).toBeVisible();
  await expect(card(app, 'Groceries')).toHaveCount(0);
  await app.getByRole('searchbox', { name: 'Search' }).fill('vanilla');
  await expect(app.locator('.card')).toHaveCount(3); // archived notes are found, trashed are not
  await app.getByRole('button', { name: 'Clear search' }).click();
  await app.locator('.type-grid button', { hasText: 'Lists' }).click();
  await expect(app.locator('.card')).toHaveCount(1);
  await expect(card(app, 'Groceries')).toBeVisible();
  await app.getByRole('button', { name: 'Remove filter Lists' }).click();
  await app.locator('.chip-wrap .chip', { hasText: 'Recipes' }).click();
  await expect(app.locator('.card')).toHaveCount(1);
  await app.getByRole('button', { name: 'Remove filter Recipes' }).click();
  await app.getByRole('button', { name: 'Butter' }).click();
  await expect(card(app, 'Groceries')).toBeVisible();
  await expect(app.locator('.card')).toHaveCount(1);
  await app.getByRole('button', { name: 'Close search' }).click();
  await expect(app.getByRole('button', { name: 'Search your notes' })).toBeVisible();
});

test('favorites view', async ({ app, srv }) => {
  const [a] = await seeded(app, srv, [{ title: 'Love it', html: '<p>x</p>' }, { title: 'Meh', html: '<p>y</p>' }]);
  await card(app, 'Love it').click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect.poll(() => metaById(srv, a.id).favorite).toBe(true);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-item', { hasText: 'Favorites' }).click();
  await expect(card(app, 'Love it')).toBeVisible();
  await expect(card(app, 'Meh')).toHaveCount(0);
});
