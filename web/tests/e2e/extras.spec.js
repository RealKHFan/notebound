// The remaining editor tools and settings.
import fs from 'node:fs';
import { test, expect, seedNote, noteFiles, metaOf, hostEvent, dialogButton } from './fixtures.js';

const editor = (page) => page.locator('.nb-editor-content');
const content = (srv) => {
  const f = noteFiles(srv)[0];
  if (!f) return '';
  const m = /<div class="nb-content">\n([\s\S]*?)\n<\/div>/.exec(srv.readVault('notes/' + f));
  return m ? m[1] : '';
};
async function openSeeded(app, srv, note) {
  const n = seedNote(srv, note);
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: note.title }).click();
  await expect(editor(app)).toBeVisible();
  return n;
}
const keyboardUp = (app) => app.evaluate(() => window.__mockEmit('insets', { top: 24, bottom: 0, left: 0, right: 0, ime: 280 }));

test('outline jumps to headings', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Long doc', html: `<h1>Intro</h1>${'<p>text</p>'.repeat(40)}<h2>Details</h2><p>end</p>` });
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Outline' }).click();
  await expect(app.getByRole('menuitem', { name: 'Intro' })).toBeVisible();
  await app.getByRole('menuitem', { name: 'Details' }).click();
  await expect(editor(app).locator('h2')).toBeInViewport();
});

test('links can be added, edited and removed from the toolbar', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Linky', html: '<p>visit</p>' });
  await editor(app).locator('p').click();
  await app.keyboard.press('End');
  await keyboardUp(app);
  await app.getByRole('button', { name: 'Link', exact: true }).click();
  await app.getByRole('textbox', { name: 'Text', exact: true }).fill('the docs');
  await app.getByRole('textbox', { name: 'Link', exact: true }).fill('docs.example.org');
  await dialogButton(app, 'Save').click();
  await expect.poll(() => content(srv)).toContain('href="https://docs.example.org"');
  await editor(app).locator('a').click();
  await expect(app.locator('.link-bubble')).toContainText('https://docs.example.org');
  await app.getByRole('button', { name: 'Open link' }).click();
  await expect.poll(() => srv.calls('openUrl').length).toBe(1);
  await editor(app).locator('a').click();
  await app.getByRole('button', { name: 'Remove link' }).click();
  await expect.poll(() => content(srv)).not.toContain('<a ');
});

test('text color, callout style and inserting date and time', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Styled', html: '<p>paint</p><div class="callout" data-callout="info"><p>note</p></div>' });
  await editor(app).locator('p').first().click();
  await app.keyboard.press('End');
  await app.keyboard.press('Shift+Home');
  await keyboardUp(app);
  await app.getByRole('button', { name: 'Colors' }).click();
  await app.getByRole('button', { name: 'Text Red' }).click();
  await expect.poll(() => content(srv)).toContain('<span style="color: rgb(217, 58, 58);">paint</span>');
  await editor(app).locator('.callout-icon').click();
  await expect.poll(() => content(srv)).toContain('data-callout="tip"');
  await editor(app).locator('.callout p').click();
  await app.getByRole('button', { name: 'Insert', exact: true }).click();
  await app.locator('.menu-grid button', { hasText: 'Date and time' }).click();
  await expect.poll(() => content(srv)).toMatch(/2026|20\d\d/);
});

test('math formulas can be edited and removed', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Math', html: '<div data-type="block-math" data-latex="x+1"></div><p>after</p>' });
  await editor(app).locator('.tiptap-mathematics-render').first().click();
  await app.getByRole('alertdialog').getByRole('textbox').fill('\\frac{a}{b}');
  await dialogButton(app, 'Save').click();
  await expect.poll(() => content(srv)).toContain('data-latex="\\frac{a}{b}"');
  await editor(app).locator('.tiptap-mathematics-render').first().click();
  await dialogButton(app, 'Remove').click();
  await expect.poll(() => content(srv)).not.toContain('block-math');
});

test('tables: add rows and columns, header row, delete', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Grid', html: '<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table><p></p>' });
  await editor(app).locator('td p').first().click();
  await keyboardUp(app);
  await app.getByRole('button', { name: 'Add row below' }).click();
  await app.getByRole('button', { name: 'Add column right' }).click();
  await expect.poll(() => (content(srv).match(/<tr>/g) || []).length).toBe(3);
  await expect.poll(() => (content(srv).match(/<th/g) || []).length).toBe(3);
  await app.locator('.tb-chip', { hasText: 'Delete table' }).click();
  await expect.poll(() => content(srv)).not.toContain('<table');
});

test('collapsible sections open and close, spoilers reveal in read-only mode', async ({ app, srv }) => {
  await openSeeded(app, srv, {
    title: 'Hidden',
    readonly: true,
    html: '<details><summary>Answer</summary><div data-type="detailsContent"><p>42</p></div></details><p>The killer is <span class="spoiler">the butler</span>.</p>',
  });
  const details = editor(app).locator('[data-type="details"]');
  await expect(details.locator('[data-type="detailsContent"]')).toBeHidden();
  await details.locator('> button').click();
  await expect(details.locator('[data-type="detailsContent"]')).toBeVisible();
  const sp = editor(app).locator('.spoiler');
  await expect(sp).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await sp.click();
  await expect(sp.locator('.spoiler-open')).toHaveText('the butler');
  await expect(sp.locator('.spoiler-open')).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await sp.click();
  await expect(sp.locator('.spoiler-open')).toHaveCount(0);
});

test('spoilers stay covered while writing until the cursor is in them, and on the card', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Movie', html: '<p>Ending: <span class="spoiler" data-spoiler="">he was a ghost</span> wow</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>see <span class="spoiler">twist</span></p></li></ul>' });
  const sp = editor(app).locator('p .spoiler').first();
  // covered at first, even though the note is open for writing
  await expect(sp).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await expect(sp.locator('.spoiler-open')).toHaveCount(0);
  // tapping it puts the cursor inside and uncovers it for editing
  await sp.click();
  await expect(sp.locator('.spoiler-open')).toHaveText('he was a ghost');
  // moving the cursor away covers it again
  await editor(app).locator('p', { hasText: 'wow' }).first().click({ position: { x: 2, y: 5 } });
  await app.keyboard.press('Home');
  await expect(sp.locator('.spoiler-open')).toHaveCount(0);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  // the card preview hides the spoiler text too
  const c = app.locator('.card', { hasText: 'Movie' });
  await expect(c).toContainText('Ending:');
  await expect(c).not.toContainText('ghost');
  await expect(c).not.toContainText('twist');
  await expect(c).toContainText('\u2588\u2588\u2588');
});

test('labels and notebook chips on the note open their pickers', async ({ app, srv }) => {
  const n = await openSeeded(app, srv, { title: 'Chips', html: '<p>x</p>', labels: ['Alpha'] });
  await app.locator('.note-chips .chip', { hasText: 'Alpha' }).click();
  await app.getByRole('textbox', { name: 'Search or create label' }).fill('Beta');
  await app.getByRole('textbox', { name: 'Search or create label' }).press('Enter');
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).labels).toEqual(['Alpha', 'Beta']);
  await app.getByRole('menuitemcheckbox', { name: 'Alpha' }).click();
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).labels).toEqual(['Beta']);
  await app.keyboard.press('Escape');
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Notebooks' }).click();
  await app.getByRole('textbox', { name: 'New notebook name' }).fill('Work');
  await app.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).notebooks.length).toBe(1);
  await app.keyboard.press('Escape');
  await expect(app.locator('.note-chips .chip', { hasText: 'Work' })).toBeVisible();
});

test('make a copy from the editor', async ({ app, srv }) => {
  await openSeeded(app, srv, { title: 'Template', html: '<p>fill me</p>', pinned: true });
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Make a copy' }).click();
  await expect.poll(() => noteFiles(srv).length).toBe(2);
  const metas = noteFiles(srv).map((f) => metaOf(srv.readVault('notes/' + f)));
  expect(metas.filter((m) => m.pinned).length).toBe(1);
});

test('edit labels page: create, rename, delete', async ({ app, srv }) => {
  seedNote(srv, { title: 'Tagged', html: '<p>x</p>', labels: ['Old'] });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'Tagged' })).toBeVisible();
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.locator('.drawer-section button', { hasText: 'Edit' }).click();
  await app.getByRole('textbox', { name: 'New label name' }).fill('Fresh');
  await app.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(app.locator('.setting', { hasText: 'Fresh' })).toBeVisible();
  await app.getByRole('button', { name: 'Rename Old' }).click();
  await app.getByRole('alertdialog').getByRole('textbox').fill('Renamed');
  await dialogButton(app, 'Rename').click();
  await expect(app.locator('.setting', { hasText: 'Renamed' })).toContainText('1 note');
  await app.getByRole('button', { name: 'Delete Fresh' }).click();
  await dialogButton(app, 'Delete').click();
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).labels).toEqual(['Renamed']);
});

test('privacy settings: screenshots, lock timeout, trash days, history', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.getByRole('button', { name: 'Settings' }).click();
  await app.locator('.setting', { hasText: 'Block screenshots' }).click();
  await expect.poll(() => srv.state.prefs.secureScreen).toBe('1');
  await expect.poll(() => srv.calls('setSecure').at(-1).args).toEqual({ secure: true, hideRecents: true });
  await app.locator('.setting', { hasText: 'App lock' }).click();
  await app.locator('.setting', { hasText: 'Lock after leaving the app' }).click();
  await app.getByRole('menuitem', { name: 'After 5 minutes' }).click();
  await expect.poll(() => srv.state.prefs.lockTimeout).toBe('300000');
  // a short trip away does not lock
  await app.evaluate(() => window.__mockEmit('resume', { pausedMs: 60000 }));
  await expect(app.getByRole('heading', { name: 'Settings' })).toBeVisible();
  srv.state.auth.result = false; // keep the lock screen up
  await app.evaluate(() => window.__mockEmit('resume', { pausedMs: 400000 }));
  await expect(app.getByRole('heading', { name: 'Notebound is locked' })).toBeVisible();
  // the automatic fingerprint prompt was dismissed; unlocking again with the button works
  await expect(app.getByText('Not unlocked. Try again.')).toBeVisible();
  srv.state.auth.result = true;
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await app.locator('.setting', { hasText: 'Empty trash automatically' }).click();
  await app.getByRole('menuitem', { name: 'Never' }).click();
  await app.locator('.setting', { hasText: 'Version history' }).first().click();
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).settings).toMatchObject({ trashDays: 0, history: false });
  await app.locator('input[aria-label="morning time"]').fill('07:15');
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).settings.morning).toBe('07:15');
});

test('without history, editing does not create versions', async ({ app, srv }) => {
  fs.writeFileSync(srv.vaultFile('notebound.json'), JSON.stringify({ format: 'notebound', version: 1, labels: [], notebooks: [], settings: { history: false } }));
  const n = seedNote(srv, { title: 'No history', html: '<p>a</p>' });
  await app.reload();
  await app.locator('.card', { hasText: 'No history' }).click();
  await editor(app).click();
  await app.keyboard.type('b');
  await expect.poll(() => fs.readFileSync(n.path, 'utf8')).toMatch(/ab|ba/);
  expect(srv.listVault(`history/${n.id}`)).toEqual([]);
});

test('choosing another folder switches to the notes there', async ({ app, srv }) => {
  seedNote(srv, { title: 'In first folder', html: '<p>x</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'In first folder' })).toBeVisible();
  const other = srv.state.vaultDir + '-second';
  fs.mkdirSync(other, { recursive: true });
  srv.state.vaultDir = other;
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.getByRole('button', { name: 'Settings' }).click();
  await app.locator('.setting', { hasText: 'Notes folder' }).click();
  await dialogButton(app, 'Choose folder').click();
  await expect(app.getByText('Notes you add appear here')).toBeVisible();
  expect(fs.existsSync(other + '/notebound.json')).toBe(true);
});
