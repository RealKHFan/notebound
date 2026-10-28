// Fixes from the first round of testing on a real phone (GrapheneOS, Pixel 8 Pro).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, seedNote, metaOf, hostEvent, dialogButton } from './fixtures.js';

const editor = (page) => page.locator('.nb-editor-content');
const assets = path.resolve('tests/assets');

async function openSettings(app) {
  await app.getByRole('button', { name: 'Open menu' }).click();
  await app.getByRole('button', { name: 'Settings' }).click();
}

test('a locked note asks for the password again after you leave it', async ({ app, srv }) => {
  seedNote(srv, { title: 'Diary', html: '<p>dear diary</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Diary' }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Lock note' }).click();
  await app.getByRole('textbox', { name: 'Password', exact: true }).fill('hunter22');
  await app.getByRole('textbox', { name: 'Repeat password' }).fill('hunter22');
  await dialogButton(app, 'Create').click();
  await expect(app.getByText('Note locked')).toBeVisible();
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  // opening it again needs the password
  await app.locator('.card', { hasText: 'Diary' }).click();
  await expect(app.getByRole('alertdialog', { name: 'Locked note' })).toBeVisible();
  await app.getByRole('alertdialog').getByRole('textbox').fill('hunter22');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(editor(app)).toContainText('dear diary');
  // a minute away from the app closes the locked note
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 90000 });
  await expect(app.locator('.editor-page')).toHaveCount(0);
  await app.locator('.card', { hasText: 'Diary' }).click();
  await expect(app.getByRole('alertdialog', { name: 'Locked note' })).toBeVisible();
});

async function lockAndOpen(app, srv, title, text) {
  seedNote(srv, { title, html: `<p>${text}</p>` });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: title }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Lock note' }).click();
  await app.getByRole('textbox', { name: 'Password', exact: true }).fill('hunter22');
  await app.getByRole('textbox', { name: 'Repeat password' }).fill('hunter22');
  await dialogButton(app, 'Create').click();
  await expect(app.getByText('Note locked')).toBeVisible();
  await expect(editor(app)).toContainText(text);
}

test('a locked note closes after 10 seconds away, not after a short look elsewhere', async ({ app, srv }) => {
  await lockAndOpen(app, srv, 'Diary', 'dear diary');
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 6000 });
  await app.waitForTimeout(300);
  await expect(editor(app)).toContainText('dear diary');
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 10500 });
  await expect(app.locator('.editor-page')).toHaveCount(0);
});

test('coming back from the photo picker or camera does not close a locked note', async ({ app, srv }) => {
  await lockAndOpen(app, srv, 'Diary', 'dear diary');
  await hostEvent(app, 'pause');
  // a minute in the camera app that the note opened
  await hostEvent(app, 'resume', { pausedMs: 60000, forResult: true });
  await app.waitForTimeout(300);
  await expect(editor(app)).toContainText('dear diary');
  // but more than 2 minutes away from there still closes it
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 3 * 60000, forResult: true });
  await expect(app.locator('.editor-page')).toHaveCount(0);
});

test('how long locked notes stay open can be changed in settings', async ({ app, srv }) => {
  await lockAndOpen(app, srv, 'Diary', 'dear diary');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await openSettings(app);
  const row = app.locator('.setting', { hasText: 'Close locked notes' });
  await expect(row).toContainText('After 10 seconds');
  await row.click();
  await app.getByRole('menuitem', { name: 'After 1 minute' }).click();
  await expect(row).toContainText('After 1 minute');
  expect(srv.state.prefs.noteLockTimeout).toBe('60000');
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await app.locator('.card', { hasText: 'Diary' }).click();
  await app.getByRole('alertdialog').getByRole('textbox').fill('hunter22');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(editor(app)).toContainText('dear diary');
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 30000 });
  await app.waitForTimeout(300);
  await expect(editor(app)).toContainText('dear diary');
});

test('app lock does not lock you out when you come back from a picker', async ({ app, srv }) => {
  srv.state.prefs = { ...(srv.state.prefs || {}), appLock: '1', lockTimeout: '0' };
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 30000, forResult: true });
  await app.waitForTimeout(300);
  await expect(app.getByRole('button', { name: 'Open menu' })).toBeVisible();
  srv.state.auth.result = false;
  // more than 2 minutes in a picker counts as leaving: someone could back out of it into the app
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 3 * 60000, forResult: true });
  await expect(app.getByRole('heading', { name: /is locked$/ })).toBeVisible();
});

test('app lock still locks after leaving normally', async ({ app, srv }) => {
  srv.state.prefs = { ...(srv.state.prefs || {}), appLock: '1', lockTimeout: '0' };
  srv.state.auth.result = false;
  await hostEvent(app, 'pause');
  await hostEvent(app, 'resume', { pausedMs: 30000 });
  await expect(app.getByRole('heading', { name: /is locked$/ })).toBeVisible();
});

test('an open locked note is kept out of screenshots and the recent-apps preview', async ({ app, srv }) => {
  await lockAndOpen(app, srv, 'Diary', 'dear diary');
  await expect.poll(() => srv.calls('setSecure').at(-1)?.args).toEqual({ secure: true, hideRecents: true });
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => srv.calls('setSecure').at(-1)?.args).toEqual({ secure: false, hideRecents: false });
});

test.describe('the notes widget with app lock on', () => {
  test.use({ srvOptions: { hasFolder: true, prefs: { appLock: '1', lockTimeout: '0' } } });
  test('shows only "Notebound is locked" until app lock is turned off', async ({ app, srv }) => {
    seedNote(srv, { title: 'Bank', html: '<p>PIN is 4821</p>', pinned: true });
    await hostEvent(app, 'resume', { pausedMs: 10 });
    await expect(app.locator('.card', { hasText: 'Bank' })).toBeVisible();
    await expect.poll(() => srv.state.widget?.notes?.[0]?.title, { timeout: 10000 }).toBe('Notebound is locked');
    expect(JSON.stringify(srv.state.widget)).not.toContain('4821');
    expect(JSON.stringify(srv.state.widget)).not.toContain('Bank');
    await openSettings(app);
    await app.locator('.setting', { hasText: 'App lock' }).click();
    await expect.poll(() => srv.state.widget?.notes?.[0]?.text).toBe('PIN is 4821');
  });
});

test('exporting locked notes asks for the password instead of failing', async ({ app, srv }) => {
  seedNote(srv, { title: 'Plain', html: '<p>open text</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Plain' }).click();
  await app.getByRole('button', { name: 'More options' }).click();
  await app.getByRole('menuitem', { name: 'Lock note' }).click();
  await app.getByRole('textbox', { name: 'Password', exact: true }).fill('pw1234');
  await app.getByRole('textbox', { name: 'Repeat password' }).fill('pw1234');
  await dialogButton(app, 'Create').click();
  await expect(app.getByText('Note locked')).toBeVisible();
  await app.getByRole('button', { name: 'Back', exact: true }).click();
  await app.locator('.card', { hasText: 'Plain' }).click({ delay: 600 });
  await app.getByRole('button', { name: 'More', exact: true }).click();
  await app.getByRole('menuitem', { name: 'Export' }).click();
  await app.getByRole('menuitem', { name: /^Plain text/ }).click();
  await app.getByRole('alertdialog').getByRole('textbox').fill('pw1234');
  await app.getByRole('button', { name: 'Unlock' }).click();
  await expect(app.getByText('Note exported')).toBeVisible();
  expect(fs.readFileSync(path.join(srv.state.savedDir, 'Plain.txt'), 'utf8')).toContain('open text');
});

test('a full backup shows progress and says when it is saved', async ({ app, srv }) => {
  seedNote(srv, { title: 'One', html: '<p>1</p>' });
  seedNote(srv, { title: 'Two', html: '<p>2</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'Two' })).toBeVisible();
  srv.state.zipDelay = 1500;
  await openSettings(app);
  await app.locator('.setting', { hasText: 'Export all notes' }).click();
  await app.getByRole('menuitem', { name: 'Full backup (.zip of the folder)' }).click();
  const card = app.locator('.progress-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Saving backup');
  // Android reports how far it got while writing the .zip
  await hostEvent(app, 'progress', { done: 2, total: 4 });
  await expect(card).toContainText('50%');
  await expect(app.getByText('Backup saved: 2 notes with their pictures and files')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(fs.readdirSync(srv.state.savedDir).some((f) => /^Notebound backup .*\.zip$/.test(f))).toBe(true);
});

test('settings can send a test reminder and show whether reminders are exact', async ({ app, srv }) => {
  srv.state.exact = false;
  await openSettings(app);
  await expect(app.locator('.setting', { hasText: 'Allow exact alarms' })).toBeVisible();
  await app.locator('.setting', { hasText: 'Send a test reminder' }).click();
  await expect(app.getByText('Test reminder set for 10 seconds from now')).toBeVisible();
  expect(srv.state.testReminder).toEqual({ delayMs: 10000, title: 'Test reminder' });
});

test('"Done" on a reminder notification removes the reminder from the note', async ({ app, srv }) => {
  const past = new Date(Date.now() - 60000).toISOString();
  const n = seedNote(srv, { title: 'Call back', html: '<p>x</p>', reminder: { at: past, repeat: null } });
  const keep = seedNote(srv, { title: 'Daily pills', html: '<p>x</p>', reminder: { at: past, repeat: 'daily' } });
  srv.state.doneReminders = [n.id, keep.id];
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect.poll(() => metaOf(fs.readFileSync(n.path, 'utf8')).reminder).toBe(null);
  // a repeating reminder keeps going
  expect(metaOf(fs.readFileSync(keep.path, 'utf8')).reminder.repeat).toBe('daily');
});

test('a reminder that comes due while the app is open also shows inside the app', async ({ app, srv }) => {
  const soon = new Date(Date.now() + 2500).toISOString();
  seedNote(srv, { title: 'Tea is ready', html: '<p>x</p>', reminder: { at: soon, repeat: null } });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await expect(app.locator('.card', { hasText: 'Tea is ready' })).toBeVisible();
  await expect(app.getByText('Reminder: Tea is ready')).toBeVisible({ timeout: 8000 });
  await app.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(app.getByRole('textbox', { name: 'Title' })).toHaveValue('Tea is ready');
});

test('editing a drawing closes the keyboard first and uses the whole screen', async ({ app, srv }) => {
  fs.mkdirSync(srv.vaultFile('attachments'), { recursive: true });
  fs.copyFileSync(path.join(assets, 'tiny.png'), srv.vaultFile('attachments/sketch.png'));
  seedNote(srv, { title: 'Sketch', html: '<p>look</p><img src="../attachments/sketch.png" data-drawing="" alt="Drawing"><p>end</p>' });
  await hostEvent(app, 'resume', { pausedMs: 10 });
  await app.locator('.card', { hasText: 'Sketch' }).click();
  await editor(app).locator('p', { hasText: 'look' }).click();
  await expect(editor(app)).toBeFocused();
  await editor(app).locator('figure.nb-image').click();
  // tapping the picture took the focus away from the text (no keyboard)
  await expect(editor(app)).not.toBeFocused();
  await app.getByRole('menuitem', { name: 'Edit drawing' }).click();
  const canvas = app.getByLabel('Drawing canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box.height).toBeGreaterThan(500);
});
