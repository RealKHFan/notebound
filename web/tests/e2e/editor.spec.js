// Writing: Discord-style shortcuts, slash commands, checklists, media, links, history and locking.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, seedNote, noteFiles, metaOf, hostEvent, dialogButton, caretToEnd } from './fixtures.js';

const assets = path.resolve('tests/assets');
const editor = (page) => page.locator('.nb-editor-content');
const fileText = (srv) => (noteFiles(srv)[0] ? srv.readVault('notes/' + noteFiles(srv)[0]) : '');
const content = (srv) => {
  const t = fileText(srv);
  const m = /<div class="nb-content">\n([\s\S]*?)\n<\/div>/.exec(t);
  return m ? m[1] : '';
};

async function newNote(page, kind = 'New note') {
  await page.getByRole('button', { name: kind, exact: true }).click();
  await expect(editor(page)).toBeFocused();
}

test('Discord-style inline shortcuts', async ({ app, srv }) => {
  await newNote(app);
  await app.keyboard.type('a **bold** b *ital* c _also_ d __under__ e ~~gone~~ f ||secret|| g `code` h ==mark== end');
  await expect.poll(() => content(srv)).toContain('<strong>bold</strong>');
  const c = content(srv);
  expect(c).toContain('<em>ital</em>');
  expect(c).toContain('<em>also</em>');
  expect(c).toContain('<u>under</u>');
  expect(c).toContain('<s>gone</s>');
  expect(c).toContain('<span class="spoiler" data-spoiler="">secret</span>');
  expect(c).toContain('<code>code</code>');
  expect(c).toContain('<mark>mark</mark>');
  expect(c).not.toContain('__');
});

test('Discord-style block shortcuts, links and emoji', async ({ app, srv }) => {
  await newNote(app);
  const type = (t) => app.keyboard.type(t);
  await type('# Big title');
  await app.keyboard.press('Enter');
  await type('## Smaller');
  await app.keyboard.press('Enter');
  await type('> quoted');
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await type('-# tiny print');
  await app.keyboard.press('Enter');
  await type('[the site](https://example.com) and :smile: and :heart_e');
  await expect(app.locator('.suggest-menu.emoji-menu')).toBeVisible();
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await type('- bullet');
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await type('1. first');
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await type('[] task');
  await expect.poll(() => content(srv)).toContain('task');
  const c = content(srv);
  expect(c).toContain('<h1>Big title</h1>');
  expect(c).toContain('<h2>Smaller</h2>');
  expect(c).toContain('<blockquote><p>quoted</p></blockquote>');
  expect(c).toContain('<p class="nb-small">tiny print</p>');
  expect(c).toMatch(/<a [^>]*href="https:\/\/example.com"[^>]*>the site<\/a>/);
  expect(c).toContain('😄');
  expect(c).toContain('😍');
  expect(c).toContain('<ul><li><p>bullet</p></li></ul>');
  expect(c).toContain('<ol><li><p>first</p></li></ol>');
  expect(c).toMatch(/<ul data-type="taskList"><li data-checked="false" data-type="taskItem">.*<p>task<\/p>/);
});

test('#label while typing puts the note under that label (Keep style)', async ({ app, srv }) => {
  await newNote(app);
  await app.keyboard.type('Buy milk #groc');
  const menu = app.locator('.suggest-menu.label-menu');
  await expect(menu).toContainText('Create label "groc"');
  await app.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => (fileText(srv) ? metaOf(fileText(srv)).labels : [])).toEqual(['groc']);
  await expect(app.locator('.note-chips .chip', { hasText: 'groc' })).toBeVisible();
  await expect.poll(() => content(srv)).toContain('Buy milk');
  expect(content(srv)).not.toContain('#groc');
  // existing labels are suggested; a heading ("# ") still works
  await app.keyboard.type('and #gr');
  await expect(menu.locator('.suggest-item').first()).toHaveText('groc');
  await app.keyboard.press('Escape');
  await app.keyboard.press('Enter');
  await app.keyboard.type('# Heading');
  await expect.poll(() => content(srv)).toContain('<h1>Heading</h1>');
  expect(JSON.parse(srv.readVault('notebound.json')).labels).toContain('groc');
});

test('slash commands insert blocks', async ({ app, srv }) => {
  await newNote(app);
  await app.keyboard.type('/table');
  await expect(app.locator('.slash-menu')).toBeVisible();
  await app.keyboard.press('Enter');
  await expect(editor(app).locator('table')).toBeVisible();
  await app.keyboard.type('cell one');
  await caretToEnd(app);
  await app.keyboard.type('/callout');
  await app.locator('.suggest-item', { hasText: 'Callout' }).first().click();
  await app.keyboard.type('Remember this');
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter'); // an empty line at the end leaves the callout
  await app.keyboard.type('/code');
  await app.locator('.suggest-item', { hasText: 'Code block' }).click();
  await app.keyboard.type('const x = 1;');
  await expect.poll(() => content(srv)).toContain('const x = 1;');
  const c = content(srv);
  expect(c).toMatch(/<table class="nb-table"[^>]*>/);
  expect(c).toContain('cell one');
  expect(c).toMatch(/<div (data-callout="info" class="callout"|class="callout" data-callout="info")><p>Remember this<\/p><\/div>/);
  expect(c).toMatch(/<pre class="nb-code"><code>const x = 1;<\/code><\/pre>/);
});

test('code block language, collapsible section, divider and math', async ({ app, srv }) => {
  await newNote(app);
  await app.keyboard.type('```py');
  await app.keyboard.press('Enter'); // Discord style: ``` + Enter starts a code block
  await app.keyboard.type('print("hi")');
  await app.evaluate(() => window.__mockEmit('insets', { top: 24, bottom: 0, left: 0, right: 0, ime: 280 }));
  await expect(app.getByRole('combobox', { name: 'Code language' })).toBeVisible();
  await expect.poll(() => content(srv)).toContain('class="language-py"');
  await app.getByRole('combobox', { name: 'Code language' }).selectOption('python');
  await expect.poll(() => content(srv)).toContain('class="language-python"');
  await caretToEnd(app);
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await app.keyboard.type('/collapsible');
  await app.keyboard.press('Enter');
  await app.keyboard.type('More details');
  await caretToEnd(app);
  await app.keyboard.type('---');
  await app.keyboard.type('$$a^2+b^2$$ ');
  await expect.poll(() => content(srv)).toContain('data-type="inline-math"');
  const c = content(srv);
  expect(c).toContain('<details');
  expect(c).toContain('<summary>More details</summary>');
  expect(c).toContain('<hr>');
  expect(c).toContain('data-latex="a^2+b^2"');
  await expect(editor(app).locator('.katex').first()).toBeVisible();
});

test('Keep-style checklist: checked items move down, can be folded, unchecked, deleted, and the note turned back into text', async ({ app, srv }) => {
  await newNote(app, 'New list');
  await app.keyboard.type('Bread');
  await app.keyboard.press('Enter');
  await app.keyboard.type('Milk');
  await app.keyboard.press('Enter');
  await app.keyboard.type('Eggs');
  const boxes = editor(app).locator('li[data-type="taskItem"] input[type="checkbox"]');
  await expect(boxes).toHaveCount(3);
  await boxes.nth(0).click(); // Bread checked -> bottom
  await expect(editor(app).locator('li[data-type="taskItem"] > div')).toHaveText(['Milk', 'Eggs', 'Bread']);
  await expect(editor(app).locator('.checked-divider')).toContainText('1 checked item');
  await editor(app).locator('.checked-divider button').click();
  await expect(editor(app).locator('li.checked-hidden')).toHaveCount(1);
  await editor(app).locator('.checked-divider button').click();
  await expect(editor(app).locator('li.checked-hidden')).toHaveCount(0);
  await editor(app).locator('li[data-checked="true"] input').click(); // uncheck -> end of open items
  await expect(editor(app).locator('li[data-type="taskItem"] > div')).toHaveText(['Milk', 'Eggs', 'Bread']);
  await expect(editor(app).locator('li[data-checked="true"]')).toHaveCount(0);
  await boxes.nth(0).click();
  await expect.poll(() => content(srv)).toContain('data-checked="true"');
  // card preview on the home screen
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.card .card-items li')).toHaveCount(3); // 2 open + "1 checked"
  await expect(app.locator('.card .card-items .more')).toHaveText('1 checked');
  await app.locator('.card').click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Delete checked items' }).click();
  await expect(editor(app).locator('li[data-type="taskItem"]')).toHaveCount(2);
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Hide checkboxes' }).click();
  await expect(editor(app).locator('li[data-type="taskItem"]')).toHaveCount(0);
  await expect.poll(() => content(srv)).toMatch(/<p>Eggs<\/p>|<p>Milk<\/p>/);
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Show checkboxes' }).click();
  await expect(editor(app).locator('li[data-type="taskItem"]')).toHaveCount(2);
});

test('checklist items can be dragged by their handle', async ({ app, srv }) => {
  await newNote(app, 'New list');
  for (const t of ['One', 'Two', 'Three']) {
    await app.keyboard.type(t);
    if (t !== 'Three') await app.keyboard.press('Enter');
  }
  const handles = editor(app).locator('.task-handle');
  const from = await handles.nth(2).boundingBox();
  const to = await editor(app).locator('li[data-type="taskItem"]').nth(0).boundingBox();
  await app.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await app.mouse.down();
  for (let i = 1; i <= 8; i++) await app.mouse.move(from.x + from.width / 2, from.y + ((to.y + 4 - from.y) * i) / 8);
  await app.mouse.up();
  await expect(editor(app).locator('li[data-type="taskItem"] > div')).toHaveText(['Three', 'One', 'Two']);
  await expect.poll(() => content(srv).indexOf('Three') < content(srv).indexOf('One')).toBe(true);
});

test('formatting toolbar while typing, undo and redo', async ({ app, srv }) => {
  await newNote(app);
  await app.evaluate(() => window.__mockEmit('insets', { top: 24, bottom: 0, left: 0, right: 0, ime: 280 }));
  await expect(app.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await app.getByRole('button', { name: 'Bold', exact: true }).click();
  await app.keyboard.type('loud');
  await app.getByRole('button', { name: 'Bold', exact: true }).click();
  await app.keyboard.type(' quiet');
  await app.getByRole('button', { name: 'Text styles' }).click();
  await app.locator('.tb-chip', { hasText: 'Heading 1' }).click();
  await expect.poll(() => content(srv)).toBe('<h1><strong>loud</strong> quiet</h1>');
  await app.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => content(srv)).toBe('<p><strong>loud</strong> quiet</p>');
  await app.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => content(srv)).toBe('<h1><strong>loud</strong> quiet</h1>');
  await app.getByRole('button', { name: 'Colors' }).click();
  await app.keyboard.press('Shift+Home');
  await app.getByRole('button', { name: 'Highlight Yellow' }).click();
  await expect.poll(() => content(srv)).toContain('<mark data-color="rgba(255, 214, 10, 0.42)"');
  await app.getByRole('button', { name: 'Hide keyboard' }).click();
  await app.evaluate(() => window.__mockEmit('insets', { top: 24, bottom: 0, left: 0, right: 0, ime: 0 }));
  await expect(app.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);
  await expect(app.locator('.editor-bottom .edited')).toContainText('Edited');
});

test('links to other notes with [[ and backlinks', async ({ app, srv }) => {
  const target = seedNote(srv, { title: 'Project Phoenix', html: '<p>details</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'Project Phoenix' })).toBeVisible();
  await newNote(app);
  await app.keyboard.type('See [[Phoe');
  await expect(app.locator('.note-link-menu')).toContainText('Project Phoenix');
  await app.keyboard.press('Enter');
  await app.keyboard.type('for more.');
  await expect.poll(() => fs.readdirSync(srv.vaultFile('notes')).length).toBe(2);
  const mine = noteFiles(srv).find((f) => !f.includes(target.id));
  await expect.poll(() => srv.readVault('notes/' + mine)).toContain(`data-note-id="${target.id}"`);
  expect(srv.readVault('notes/' + mine)).toContain(`href="${encodeURIComponent(target.file)}"`);
  // tap the link -> bubble -> open
  await editor(app).locator('a[data-note-id]').click();
  await app.getByRole('button', { name: 'Open link' }).click();
  await expect(app.getByRole('textbox', { name: 'Title' }).last()).toHaveValue('Project Phoenix');
  await expect(app.locator('.backlinks')).toContainText('Linked from');
});

test('find and replace inside a note', async ({ app, srv }) => {
  seedNote(srv, { title: 'Doc', html: '<p>cat dog cat</p><p>another cat</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Doc' }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Find in note' }).click();
  await app.getByRole('textbox', { name: 'Find' }).fill('cat');
  await expect(app.locator('.find-count')).toHaveText('1/3');
  await expect(editor(app).locator('.find-hit')).toHaveCount(3);
  await app.getByRole('button', { name: 'Next match' }).click();
  await expect(app.locator('.find-count')).toHaveText('2/3');
  await app.getByRole('button', { name: 'Replace', exact: true }).first().click();
  await app.getByRole('textbox', { name: 'Replace with' }).fill('fox');
  await app.getByRole('button', { name: 'All' }).click();
  await expect.poll(() => content(srv)).toBe('<p>fox dog fox</p><p>another fox</p>');
});

test('read-only notes cannot be edited until editing is allowed again', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Final', html: '<p>do not touch</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Final' }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Read only' }).click();
  await expect(editor(app)).toHaveAttribute('contenteditable', 'false');
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).readonly).toBe(true);
  await app.locator('.note-chips .chip', { hasText: 'Read only' }).click();
  await expect(editor(app)).toHaveAttribute('contenteditable', 'true');
});

test('images from the gallery and from the camera', async ({ app, srv }) => {
  srv.state.picks.images = [path.join(assets, 'photo-mountains.jpg')];
  await app.getByRole('button', { name: 'New image note', exact: true }).click();
  await expect(editor(app).locator('figure.nb-image img')).toBeVisible();
  await expect.poll(() => content(srv)).toMatch(/<img onerror="[^"]+" src="\.\.\/attachments\/photo-mountains-[a-z0-9]+\.jpg" alt="" width="800" height="600" data-preview="data:image\/jpeg;base64,/);
  const att = srv.listVault('attachments');
  expect(att.length).toBe(1);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.card .card-images img')).toBeVisible();
  // photo note
  srv.state.picks.photo = path.join(assets, 'photo-plate.jpg');
  await app.getByRole('button', { name: 'New photo note', exact: true }).click();
  await expect(editor(app).locator('figure.nb-image img')).toBeVisible();
  // image actions: resize and view
  await editor(app).locator('figure.nb-image').click();
  await app.getByRole('menuitem', { name: 'Medium' }).click();
  await expect(editor(app).locator('figure.nb-image')).toHaveAttribute('style', /width: 50%/);
  await editor(app).locator('figure.nb-image').click();
  await app.getByRole('menuitem', { name: 'View' }).click();
  await expect(app.getByRole('dialog', { name: 'Image' })).toBeVisible();
  await app.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => noteFiles(srv).length).toBe(2);
  // cancelling the camera leaves no empty note behind
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await app.getByRole('button', { name: 'New photo note', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Search your notes' })).toBeVisible();
  expect(noteFiles(srv).length).toBe(2);
});

test('file attachments open with another app', async ({ app, srv }) => {
  await newNote(app);
  await app.keyboard.type('Contract');
  srv.state.picks.files = [path.join(assets, 'sample.pdf')];
  await app.getByRole('button', { name: 'Insert', exact: true }).click();
  await app.locator('.menu-grid button', { hasText: 'File' }).click();
  await expect(editor(app).locator('.nb-attachment')).toContainText('sample.pdf');
  await expect.poll(() => content(srv)).toMatch(/<a class="attachment" data-attachment="" href="\.\.\/attachments\/sample-[a-z0-9]+\.pdf"/);
  await editor(app).locator('.nb-attachment').click();
  await app.getByRole('menuitem', { name: 'Open' }).click();
  await expect.poll(() => srv.calls('openFile').length).toBe(1);
  expect(srv.calls('openFile')[0].args.path).toMatch(/^attachments\/sample-/);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.card .chip', { hasText: '1' })).toBeVisible();
});

test('drawing: draw, save as SVG, edit again', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'New drawing', exact: true }).click();
  const canvas = app.getByLabel('Drawing canvas');
  await expect(canvas).toBeVisible();
  const b = await canvas.boundingBox();
  const stroke = async (y) => {
    await app.mouse.move(b.x + 40, b.y + y);
    await app.mouse.down();
    for (let i = 1; i <= 10; i++) await app.mouse.move(b.x + 40 + i * 20, b.y + y + Math.sin(i) * 20);
    await app.mouse.up();
  };
  await stroke(100);
  await app.getByRole('radio', { name: 'Color #e5484d' }).click();
  await stroke(200);
  await app.getByRole('button', { name: 'Undo stroke' }).click();
  await stroke(250);
  await app.getByRole('button', { name: 'Save drawing' }).click();
  await expect(editor(app).locator('figure.nb-image img.drawing')).toBeVisible();
  await expect.poll(() => content(srv)).toContain('data-drawing=""');
  const svgName = srv.listVault('attachments').find((f) => f.startsWith('drawing-'));
  const svg = srv.readVault('attachments/' + svgName);
  expect((svg.match(/<path /g) || []).length).toBe(2);
  expect(svg).toContain('notebound-drawing');
  expect(svg).toContain('#e5484d');
  // edit again: strokes come back
  await editor(app).locator('figure.nb-image').click();
  await app.getByRole('menuitem', { name: 'Edit drawing' }).click();
  await expect(app.getByRole('button', { name: 'Undo stroke' })).toBeEnabled();
  await stroke(300);
  await app.getByRole('button', { name: 'Save drawing' }).click();
  await expect.poll(() => srv.listVault('attachments').filter((f) => f.startsWith('drawing-')).length).toBe(1);
  const svg2 = srv.readVault('attachments/' + srv.listVault('attachments').find((f) => f.startsWith('drawing-')));
  expect((svg2.match(/<path /g) || []).length).toBe(3);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.card .card-images img.drawing')).toBeVisible();
});

test('version history: restore an earlier version', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Essay', html: '<p>first draft</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Essay' }).click();
  await editor(app).click();
  await app.keyboard.press('Control+A');
  await app.keyboard.type('second draft');
  await expect.poll(() => fs.readFileSync(n.path, 'utf8')).toContain('second draft');
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Version history' }).click();
  await app.locator('.history-item').first().click();
  await expect(app.locator('.nb-editor').last()).toContainText('first draft');
  await app.getByRole('button', { name: 'Restore' }).click();
  await dialogButton(app, 'Restore').click();
  await expect(app.getByText('Version restored')).toBeVisible();
  await expect.poll(() => fs.readFileSync(n.path, 'utf8')).toContain('<p>first draft</p>');
  expect(srv.listVault(`history/${n.id}`).length).toBe(2);
  // the open editor shows the restored text, and further typing builds on it
  await expect(editor(app)).toContainText('first draft');
  await expect(editor(app)).not.toContainText('second draft');
  await caretToEnd(app);
  await app.keyboard.type(' plus more');
  await expect.poll(() => fs.readFileSync(n.path, 'utf8')).toContain('first draft plus more');
  expect(fs.readFileSync(n.path, 'utf8')).not.toContain('second draft');
});

test('locked notes are encrypted in the file and need the vault password', async ({ app, srv, page }) => {
  const n = seedNote(srv, { title: 'Diary', html: '<p>my deepest secret</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Diary' }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Lock note' }).click();
  await app.getByRole('textbox', { name: 'Password', exact: true }).fill('hunter22');
  await app.getByRole('textbox', { name: 'Repeat password' }).fill('hunter22');
  await dialogButton(app, 'Create').click();
  await expect(app.getByText('Note locked')).toBeVisible();
  const file = fs.readFileSync(n.path, 'utf8');
  expect(file).not.toContain('deepest secret');
  expect(metaOf(file).locked.alg).toBe('AES-GCM');
  expect(srv.listVault(`history/${n.id}`)).toEqual([]);
  // still editable while the vault is open; edits stay encrypted
  await editor(app).click();
  await caretToEnd(app);
  await app.keyboard.type(' and more');
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).modified).not.toBe(metaOf(file).modified);
  expect(fs.readFileSync(n.path, 'utf8')).not.toContain('and more');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(app.locator('.card', { hasText: 'Diary' }).locator('.locked-line')).toBeVisible();
  // restart: password required
  await page.reload();
  await app.locator('.card', { hasText: 'Diary' }).click();
  await app.getByRole('alertdialog').getByRole('textbox').fill('wrong');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.getByText('Wrong password')).toBeVisible();
  await app.getByRole('alertdialog').getByRole('textbox').fill('hunter22');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(editor(app)).toContainText('my deepest secret and more');
  // remove the lock
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Remove lock' }).click();
  await dialogButton(app, 'Remove lock').click();
  await expect.poll(() => fs.readFileSync(n.path, 'utf8')).toContain('my deepest secret and more');
  expect(metaOf(fs.readFileSync(n.path, 'utf8')).locked).toBe(null);
});

test('export, print and send a note', async ({ app, srv }) => {
  seedNote(srv, { title: 'Recipe', html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>flour</p></li></ul><p>Mix <strong>well</strong>.</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Recipe' }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Export' }).click();
  await app.getByRole('menuitem', { name: /Markdown/ }).click();
  await expect.poll(() => fs.existsSync(path.join(srv.state.savedDir, 'Recipe.md'))).toBe(true);
  const md = fs.readFileSync(path.join(srv.state.savedDir, 'Recipe.md'), 'utf8');
  expect(md).toBe('# Recipe\n\n- [ ] flour\n\nMix **well**.\n');
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Export' }).click();
  await app.getByRole('menuitem', { name: /PDF/ }).click();
  await expect.poll(() => srv.calls('print').length).toBe(1);
  expect(srv.calls('print')[0].args.html).toContain('<title>Recipe</title>');
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Send' }).click();
  await expect.poll(() => srv.calls('shareText').length).toBe(1);
  expect(srv.calls('shareText')[0].args.text).toContain('flour');
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Info' }).click();
  await expect(app.locator('.info-list')).toContainText('Words');
});
