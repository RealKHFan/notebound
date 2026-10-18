// App-level behaviour: folder setup, settings, lock, back button, Android intents,
// reminders, widgets, import and export.
import fs from 'node:fs';
import path from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { test, expect, seedNote, noteFiles, metaOf, hostEvent, dialogButton } from './fixtures.js';

const assets = path.resolve('tests/assets');
const card = (page, text) => page.locator('.card', { hasText: text });
const openDrawerItem = async (page, name) => {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('.drawer-item', { hasText: name }).first().click();
};
const openSettings = async (page) => {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
};

test.describe('first run in a folder that already has files', () => {
  test.use({ srvOptions: { hasFolder: false } });
  test('offers to create a Notebound sub folder', async ({ app, srv }) => {
    fs.writeFileSync(path.join(srv.state.vaultDir, 'taxes.pdf'), 'x');
    await app.getByRole('button', { name: 'Choose folder' }).click();
    await expect(app.getByText('This folder has other files')).toBeVisible();
    await app.getByRole('button', { name: 'Create Notebound folder' }).click();
    await expect(app.getByRole('button', { name: 'Search your notes' })).toBeVisible();
    expect(fs.existsSync(path.join(srv.state.vaultDir, 'notebound.json'))).toBe(true);
    expect(srv.state.vaultDir.endsWith(path.join('Notebound', 'Notebound'))).toBe(true);
  });
});

test.describe('opening an existing Notebound folder (e.g. restored backup)', () => {
  test.use({ srvOptions: { hasFolder: false } });
  test('shows the notes that are already there', async ({ app, srv }) => {
    seedNote(srv, { title: 'From the backup', html: '<p>hello again</p>', pinned: true });
    fs.writeFileSync(path.join(srv.state.vaultDir, 'notebound.json'), JSON.stringify({ format: 'notebound', version: 1, labels: ['Kept'], notebooks: [], settings: { theme: 'dark' } }));
    await app.getByRole('button', { name: 'Choose folder' }).click();
    await expect(card(app, 'From the backup')).toBeVisible();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test('settings are stored in notebound.json and change the look', async ({ app, srv }) => {
  await openSettings(app);
  await app.getByRole('radio', { name: 'Black' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'black');
  await app.getByRole('radio', { name: 'teal' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-accent', 'teal');
  await app.getByRole('radio', { name: 'Serif' }).click();
  await app.getByRole('radio', { name: 'XL' }).click();
  await app.locator('.setting', { hasText: 'Move checked items to bottom' }).click();
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).settings).toMatchObject({ theme: 'black', accent: 'teal', editorFont: 'serif', fontSize: 22, checkedToBottom: false });
  const bg = await app.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(0, 0, 0)');
  expect(srv.calls('setSystemBars').at(-1).args.lightBackground).toBe(false);
});

test('system dark mode follows the phone', async ({ app }) => {
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'light');
  await hostEvent(app, 'night', { dark: true });
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('app lock asks for fingerprint or PIN after leaving the app', async ({ app, srv }) => {
  await openSettings(app);
  await app.locator('.setting', { hasText: 'App lock' }).click();
  await expect.poll(() => srv.state.prefs.appLock).toBe('1');
  expect(srv.calls('authenticate').length).toBe(1);
  await hostEvent(app, 'pause');
  srv.state.auth.result = false;
  await hostEvent(app, 'resume', { pausedMs: 5000 });
  await expect(app.getByRole('heading', { name: 'Notebound is locked' })).toBeVisible();
  await expect(app.getByText('Not unlocked. Try again.')).toBeVisible();
  srv.state.auth.result = true;
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // screenshots are blocked / recents hidden while lock is on
  expect(srv.calls('setSecure').at(-1).args.hideRecents).toBe(true);
});

test.describe('starting while app lock is on', () => {
  test.use({ srvOptions: { hasFolder: true, prefs: { appLock: '1', lockTimeout: '0' }, auth: { result: false } } });
  test('a widget tapped while the app is locked opens its note after unlocking', async ({ app, srv }) => {
    const n = seedNote(srv, { title: 'Shopping', html: '<p>eggs</p>' });
    await expect(app.getByRole('heading', { name: 'Notebound is locked' })).toBeVisible();
    await expect(app.getByText('Not unlocked. Try again.')).toBeVisible();
    // the notes widget sends "open this note" while the lock screen is up
    await hostEvent(app, 'intent', { action: 'open', noteId: n.id });
    srv.state.auth.result = true;
    await app.getByRole('button', { name: 'Unlock' }).click();
    await expect(app.getByRole('textbox', { name: 'Title' })).toHaveValue('Shopping');
  });
});

test('a shortcut used while the app is locked (vault already open) starts the note after unlocking', async ({ app, srv }) => {
  await openSettings(app);
  await app.locator('.setting', { hasText: 'App lock' }).click();
  await expect.poll(() => srv.state.prefs.appLock).toBe('1');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  srv.state.auth.result = false;
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 5000 });
  await expect(app.getByRole('heading', { name: 'Notebound is locked' })).toBeVisible();
  await expect(app.getByText('Not unlocked. Try again.')).toBeVisible();
  await hostEvent(app, 'intent', { action: 'new', kind: 'list' });
  srv.state.auth.result = true;
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.locator('.nb-editor-content li[data-type="taskItem"]')).toBeVisible();
});

test.describe('app lock without a screen lock', () => {
  test('explains that a screen lock is needed', async ({ app, srv }) => {
    srv.state.auth.available = false;
    await openSettings(app);
    await app.locator('.setting', { hasText: 'App lock' }).click();
    await expect(app.getByRole('heading', { name: 'Set a screen lock first' })).toBeVisible();
    expect(srv.state.prefs.appLock).toBeUndefined();
  });
});

test('the Android back button closes things in order, then leaves the app', async ({ app, srv }) => {
  seedNote(srv, { title: 'Backtrack', html: '<p>x</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await card(app, 'Backtrack').click();
  await app.getByRole('button', { name: 'More options' }).click();
  await expect(app.locator('.sheet')).toBeVisible();
  await expect.poll(() => srv.state.backEnabled).toBe(true);
  await hostEvent(app, 'back');
  await expect(app.locator('.sheet')).toHaveCount(0);
  await hostEvent(app, 'back');
  await expect(app.locator('.editor-page')).toHaveCount(0);
  await openDrawerItem(app, 'Archive');
  await hostEvent(app, 'back');
  await expect(app.getByRole('button', { name: 'Search your notes' })).toBeVisible();
  await expect.poll(() => srv.state.backEnabled).toBe(false);
  await hostEvent(app, 'back');
  await expect.poll(() => srv.state.exited || 0).toBe(1);
});

test('home screen shortcuts and widgets start new notes', async ({ app }) => {
  await hostEvent(app, 'intent', { action: 'new', kind: 'list' });
  await expect(app.locator('.nb-editor-content li[data-type="taskItem"]')).toBeVisible();
  await app.keyboard.type('From widget');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(card(app, 'From widget')).toBeVisible();
});

test('text and images shared from other apps become a note', async ({ app, srv }) => {
  await hostEvent(app, 'intent', { action: 'share', subject: 'Great article', text: 'Read this https://example.com/post', uris: ['file://' + path.join(assets, 'photo-plate.jpg')] });
  await expect(app.getByRole('textbox', { name: 'Title' })).toHaveValue('Great article');
  await expect.poll(() => (noteFiles(srv)[0] ? srv.readVault('notes/' + noteFiles(srv)[0]) : '')).toContain('href="https://example.com/post"');
  const html = srv.readVault('notes/' + noteFiles(srv)[0]);
  expect(html).toMatch(/<img (?:onerror="[^"]*" )?src="\.\.\/attachments\/photo-plate-[a-z0-9]+\.jpg"/);
  expect(html).toContain('data-preview="data:image/jpeg;base64,');
});

test('tapping a reminder notification opens the note', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Call mum', html: '<p>about Sunday</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(card(app, 'Call mum')).toBeVisible();
  await hostEvent(app, 'intent', { action: 'open', noteId: n.id });
  await expect(app.getByRole('textbox', { name: 'Title' })).toHaveValue('Call mum');
});

test('reminders: quick pick, custom with repeat, the Reminders view and Android alarms', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Water plants', html: '<p>balcony</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await card(app, 'Water plants').click();
  await app.getByRole('button', { name: 'Remind me' }).click();
  await app.locator('.menu-item', { hasText: /^Tomorrow/ }).click();
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).reminder).not.toBe(null);
  const r1 = metaOf(fs.readFileSync(n.path, 'utf8')).reminder;
  const at = new Date(r1.at);
  expect(at.getHours()).toBe(8);
  expect(r1.repeat).toBe(null);
  await expect(app.locator('.note-chips .chip')).toContainText('Tomorrow, 8:00 AM');
  await expect.poll(() => (srv.state.reminders || []).length).toBe(1);
  expect(srv.state.reminders[0]).toMatchObject({ id: n.id, title: 'Water plants', repeat: 'none' });
  expect(srv.calls('notificationPermission').length).toBeGreaterThan(0);
  // custom weekly
  await app.getByRole('button', { name: 'Remind me' }).click();
  await app.getByLabel('Date').fill('2030-05-06');
  await app.getByLabel('Time').fill('18:30');
  await app.getByLabel('Repeat').selectOption('weekly');
  await app.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).reminder?.repeat).toBe('weekly');
  await expect.poll(() => srv.state.reminders?.[0]?.repeat).toBe('weekly');
  expect(new Date(srv.state.reminders[0].at).getHours()).toBe(18);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await openDrawerItem(app, 'Reminders');
  await expect(app.locator('.section-label', { hasText: 'Upcoming' })).toBeVisible();
  await expect(card(app, 'Water plants')).toBeVisible();
  // remove
  await card(app, 'Water plants').click();
  await app.getByRole('button', { name: 'Remind me' }).click();
  await app.getByRole('button', { name: 'Remove reminder' }).click();
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).reminder).toBe(null);
  await expect.poll(() => srv.state.reminders.length).toBe(0);
});

test('past one-time reminders appear under Sent, repeating ones stay upcoming', async ({ app, srv }) => {
  seedNote(srv, { title: 'Old call', html: '<p>x</p>', reminder: { at: '2026-01-01T09:00:00.000Z', repeat: null } });
  seedNote(srv, { title: 'Daily pills', html: '<p>x</p>', reminder: { at: '2026-01-01T07:00:00.000Z', repeat: 'daily' } });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await openDrawerItem(app, 'Reminders');
  await expect(app.locator('.section-label', { hasText: 'Sent' })).toBeVisible();
  const sentY = (await app.locator('.section-label', { hasText: 'Sent' }).boundingBox()).y;
  expect((await card(app, 'Old call').boundingBox()).y).toBeGreaterThan(sentY);
  expect((await card(app, 'Daily pills').boundingBox()).y).toBeLessThan(sentY);
  await expect(card(app, 'Old call').locator('.chip.past')).toBeVisible();
  await expect.poll(() => (srv.state.reminders || []).map((r) => r.title)).toEqual(['Daily pills']);
});

test('the notes widget gets pinned notes first', async ({ app, srv }) => {
  seedNote(srv, { title: 'Normal', html: '<p>n</p>', order: 2 });
  seedNote(srv, { title: 'Pinned one', html: '<p>p</p>', pinned: true, color: 'rose', order: 1 });
  seedNote(srv, { title: 'Secret', html: '<p>x</p>', archived: true });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect.poll(() => srv.state.widget?.notes?.map((n) => n.title)).toEqual(['Pinned one', 'Normal']);
  expect(srv.state.widget.notes[0]).toMatchObject({ light: '#f6b8ae', pinned: true });
});

function keepTakeout() {
  const json = (o) => strToU8(JSON.stringify(o));
  return zipSync({
    'Takeout/Keep/Groceries.json': json({ color: 'YELLOW', isTrashed: false, isPinned: true, isArchived: false, title: 'Groceries', listContent: [{ text: 'Milk', isChecked: false }, { text: 'Eggs', isChecked: true }], userEditedTimestampUsec: 1700000000000000, createdTimestampUsec: 1690000000000000, labels: [{ name: 'Home' }] }),
    'Takeout/Keep/Groceries.html': strToU8('<html><body>dup</body></html>'),
    'Takeout/Keep/Trip.json': json({ color: 'BLUE', isTrashed: false, isPinned: false, isArchived: true, title: 'Trip', textContent: 'Pack boots\nSee https://maps.example.com', attachments: [{ filePath: 'abc123.jpeg', mimetype: 'image/jpeg' }], annotations: [{ url: 'https://hut.example.com', title: 'Hut booking' }], userEditedTimestampUsec: 1710000000000000, createdTimestampUsec: 1700000000000000, labels: [{ name: 'Travel' }] }),
    'Takeout/Keep/abc123.jpg': new Uint8Array(fs.readFileSync(path.join(assets, 'photo-mountains.jpg'))),
    'Takeout/Keep/Old.json': json({ color: 'DEFAULT', isTrashed: true, isPinned: false, isArchived: false, title: 'Old', textContent: 'gone', userEditedTimestampUsec: 1600000000000000 }),
    'Takeout/Keep/Labels.txt': strToU8('Home\nTravel'),
  });
}

test('import a Google Keep Takeout zip', async ({ app, srv }) => {
  const zip = path.join(srv.state.base, 'takeout-20261018.zip');
  fs.writeFileSync(zip, keepTakeout());
  srv.state.picks.import = [zip];
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Import notes' }).click();
  await expect(app.getByText('3 notes imported')).toBeVisible({ timeout: 15000 });
  const metas = noteFiles(srv).map((f) => ({ f, ...metaOf(srv.readVault('notes/' + f)), text: srv.readVault('notes/' + f) }));
  const g = metas.find((m) => m.f.startsWith('Groceries'));
  expect(g).toMatchObject({ color: 'butter', pinned: true, labels: ['Home'] });
  expect(g.created).toBe(new Date(1690000000000).toISOString());
  expect(g.text).toContain('data-checked="true"><p>Eggs</p>');
  const t = metas.find((m) => m.f.startsWith('Trip'));
  expect(t).toMatchObject({ color: 'sky', archived: true, labels: ['Travel'] });
  expect(t.text).toMatch(/<img (?:onerror="[^"]*" )?src="\.\.\/attachments\/imported-[a-z0-9]+-abc123\.jpg"/);
  expect(t.text).toContain('data-preview="data:image/jpeg;base64,');
  expect(t.text).toContain('href="https://maps.example.com"');
  expect(t.text).toContain('Hut booking');
  expect(metas.find((m) => m.f.startsWith('Old')).trashed).not.toBe(null);
  await expect.poll(() => JSON.parse(srv.readVault('notebound.json')).labels).toEqual(['Home', 'Travel']);
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(card(app, 'Groceries')).toBeVisible();
  expect(srv.calls('importDone').length).toBe(1);
});

test('import Notesnook / Markdown / text / HTML exports', async ({ app, srv }) => {
  const zip = path.join(srv.state.base, 'notesnook-export.zip');
  fs.writeFileSync(zip, zipSync({
    'notes/Ideas.md': strToU8('---\ntitle: Ideas\ntags: [work, someday]\ncreated_at: 2025-03-01T10:00:00Z\npinned: true\n---\n\n# Ideas\n\n- [ ] Build a shed\n- [x] Buy wood\n\n![](../images/shed.png)\n'),
    'images/shed.png': new Uint8Array(fs.readFileSync(path.join(assets, 'tiny.png'))),
    'notes/Letter.html': strToU8('<html><head><title>Letter</title></head><body><h1>Letter</h1><p>Dear <b>friend</b></p><script>bad()</script></body></html>'),
  }));
  const txt = path.join(srv.state.base, 'Phone numbers.txt');
  fs.writeFileSync(txt, 'Plumber 555-0101\nDoctor 555-0199');
  srv.state.picks.import = [zip, txt];
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Import notes' }).click();
  await expect(app.getByText('3 notes imported')).toBeVisible({ timeout: 15000 });
  const byTitle = (t) => srv.readVault('notes/' + noteFiles(srv).find((f) => f.startsWith(t)));
  const ideas = byTitle('Ideas');
  expect(metaOf(ideas)).toMatchObject({ labels: ['work', 'someday'], pinned: true, created: '2025-03-01T10:00:00.000Z' });
  expect(ideas).toContain('data-type="taskList"');
  expect(ideas).toMatch(/<img (?:onerror="[^"]*" )?src="\.\.\/attachments\/imported-[a-z0-9]+-shed\.png"/);
  expect(ideas).not.toContain('<h1>Ideas</h1>');
  const letter = byTitle('Letter');
  expect(letter).toContain('Dear <b>friend</b>');
  expect(letter).not.toContain('bad()');
  expect(byTitle('Phone numbers')).toContain('<p>Plumber 555-0101</p>');
});

test('export all notes as Markdown and make a full backup that restores', async ({ app, srv, page }) => {
  fs.mkdirSync(srv.vaultFile('attachments'), { recursive: true });
  fs.copyFileSync(path.join(assets, 'tiny.png'), srv.vaultFile('attachments/tiny.png'));
  seedNote(srv, { title: 'Alpha', html: '<p>one <img src="../attachments/tiny.png"></p>', labels: ['L1'], color: 'mint' });
  seedNote(srv, { title: 'Beta', html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(card(app, 'Beta')).toBeVisible();
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Export all notes' }).click();
  await app.getByRole('menuitem', { name: 'Markdown' }).click();
  await expect.poll(() => fs.readdirSync(srv.state.savedDir).filter((f) => f.endsWith('.zip')).length).toBe(1);
  const mdZip = unzipSync(new Uint8Array(fs.readFileSync(path.join(srv.state.savedDir, fs.readdirSync(srv.state.savedDir)[0]))));
  expect(Object.keys(mdZip).sort()).toEqual(['attachments/tiny.png', 'notes/Alpha.md', 'notes/Beta.md']);
  expect(strFromU8(mdZip['notes/Beta.md'])).toBe('# Beta\n\n- [ ] todo\n');
  expect(strFromU8(mdZip['notes/Alpha.md'])).toContain('![](../attachments/tiny.png)');
  // full backup
  await app.locator('.setting', { hasText: 'Export all notes' }).click();
  await app.getByRole('menuitem', { name: /Full backup/ }).click();
  await expect.poll(() => fs.readdirSync(srv.state.savedDir).filter((f) => f.startsWith('Notebound backup')).length).toBe(1);
  const backupPath = path.join(srv.state.savedDir, fs.readdirSync(srv.state.savedDir).find((f) => f.startsWith('Notebound backup')));
  const backup = unzipSync(new Uint8Array(fs.readFileSync(backupPath)));
  expect(Object.keys(backup).filter((k) => k.startsWith('notes/')).length).toBe(2);
  expect(backup['notebound.json']).toBeTruthy();
  // restore into an empty folder by importing the backup
  for (const f of noteFiles(srv)) fs.unlinkSync(srv.vaultFile('notes/' + f));
  fs.rmSync(srv.vaultFile('attachments'), { recursive: true, force: true });
  await page.reload();
  await expect(app.getByText('Notes you add appear here')).toBeVisible();
  srv.state.picks.import = [backupPath];
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Import notes' }).click();
  await expect(app.getByText('2 notes imported')).toBeVisible({ timeout: 15000 });
  const alpha = srv.readVault('notes/' + noteFiles(srv).find((f) => f.startsWith('Alpha')));
  expect(metaOf(alpha)).toMatchObject({ color: 'mint', labels: ['L1'] });
  expect(alpha).toMatch(/<img (?:onerror="[^"]*" )?src="\.\.\/attachments\/imported-[a-z0-9]+-tiny\.png"/);
});

test('unused attachments can be cleaned up', async ({ app, srv }) => {
  fs.mkdirSync(srv.vaultFile('attachments'), { recursive: true });
  fs.writeFileSync(srv.vaultFile('attachments/used.png'), 'x');
  fs.writeFileSync(srv.vaultFile('attachments/orphan.png'), 'x');
  seedNote(srv, { title: 'Uses one', html: '<img src="../attachments/used.png">' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(card(app, 'Uses one')).toBeVisible();
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Clean up attachments' }).click();
  await dialogButton(app, 'Delete').click();
  await expect(app.getByText('1 file deleted')).toBeVisible();
  expect(srv.listVault('attachments')).toEqual(['used.png']);
});

test('vault password can be changed (locked notes are re-encrypted)', async ({ app, srv }) => {
  const n = seedNote(srv, { title: 'Private', html: '<p>classified</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await card(app, 'Private').click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Lock note' }).click();
  await app.getByRole('textbox', { name: 'Password', exact: true }).fill('first-pass');
  await app.getByRole('textbox', { name: 'Repeat password' }).fill('first-pass');
  await dialogButton(app, 'Create').click();
  await expect(app.getByText('Note locked')).toBeVisible();
  const before = metaOf(fs.readFileSync(n.path, 'utf8')).locked;
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Change vault password' }).click();
  await app.getByRole('textbox', { name: 'Current password' }).fill('first-pass');
  await app.getByRole('textbox', { name: 'New password', exact: true }).fill('second-pass');
  await app.getByRole('textbox', { name: 'Repeat new password' }).fill('second-pass');
  await dialogButton(app, 'Change').click();
  await expect(app.getByText('Vault password changed')).toBeVisible({ timeout: 15000 });
  const after = metaOf(fs.readFileSync(n.path, 'utf8')).locked;
  expect(after.salt).not.toBe(before.salt);
  expect(JSON.parse(srv.readVault('notebound.json')).vault.salt).toBe(after.salt);
});

test.describe('after a crash', () => {
  test.use({ srvOptions: { hasFolder: true } });
  test('offers to share the crash details', async ({ page, srv }) => {
    srv.state.lastCrash = 'java.lang.IllegalStateException: test crash';
    await page.goto(srv.appUrl);
    await expect(page.getByRole('heading', { name: 'Notebound closed unexpectedly' })).toBeVisible();
    await dialogButton(page, 'Share details').click();
    await expect.poll(() => srv.calls('shareText').length).toBe(1);
    expect(srv.calls('shareText')[0].args.text).toContain('test crash');
  });
});

test('links in read-only notes open in the browser, never inside the app', async ({ app, srv }) => {
  seedNote(srv, { title: 'Links', html: '<p><a href="https://example.com/x">site</a></p>', readonly: true });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await card(app, 'Links').click();
  await app.locator('.nb-editor-content a').click();
  await expect.poll(() => srv.calls('openUrl').map((c) => c.args.url)).toEqual(['https://example.com/x']);
  expect(app.url()).toContain('/app/index.html');
});

test('diagnostic info can be shared from About', async ({ app, srv }) => {
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.getByRole('button', { name: 'Settings' }).click();
  await app.locator('.setting', { hasText: 'About Notebound' }).click();
  await expect(app.locator('.license-text')).toContainText('@tiptap/core');
  await app.locator('.setting', { hasText: 'Share diagnostic info' }).click();
  await expect.poll(() => srv.calls('shareText').length).toBe(1);
  expect(srv.calls('shareText')[0].args.text).toContain('Device: Test device');
});
