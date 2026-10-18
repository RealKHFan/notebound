// Renders screenshots of the main screens at Pixel 8 Pro size for design review
// and the README. Usage: node tests/screens.mjs <outDir> [light|dark]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startMockServer } from './mock-server.mjs';
import { serializeNote, defaultMeta, noteFileName } from '../src/store/note-format.js';

const out = path.resolve(process.argv[2] || 'screens');
const theme = process.argv[3] || 'light';
fs.mkdirSync(out, { recursive: true });
const assets = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'assets');

function seed(srv, list) {
  const dir = path.join(srv.state.vaultDir, 'notes');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(srv.state.vaultDir, 'attachments'), { recursive: true });
  let order = Date.now();
  const ids = [];
  for (const n of list) {
    const m = defaultMeta({ order: order--, ...n.meta });
    fs.writeFileSync(path.join(dir, noteFileName(n.title, m.id)), serializeNote({ meta: m, title: n.title, html: n.html }));
    ids.push(m.id);
  }
  return ids;
}

const srv = await startMockServer({ hasFolder: true });
fs.mkdirSync(path.join(srv.state.vaultDir, 'attachments'), { recursive: true });
fs.copyFileSync(path.join(assets, 'photo-mountains.jpg'), path.join(srv.state.vaultDir, 'attachments', 'photo-mountains.jpg'));
fs.copyFileSync(path.join(assets, 'photo-plate.jpg'), path.join(srv.state.vaultDir, 'attachments', 'photo-plate.jpg'));
const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(8, 0, 0, 0);
const ids = seed(srv, [
  { title: 'Groceries', meta: { pinned: true, color: 'butter', labels: ['Home'] }, html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Oat milk</p></li><li data-type="taskItem" data-checked="false"><p>Sourdough bread</p></li><li data-type="taskItem" data-checked="false"><p>Tomatoes</p></li><li data-type="taskItem" data-checked="false"><p>Coffee beans</p></li><li data-type="taskItem" data-checked="true"><p>Eggs</p></li><li data-type="taskItem" data-checked="true"><p>Basil</p></li></ul>' },
  { title: 'Trip to the Dolomites', meta: { pinned: true, color: 'sky', labels: ['Travel'], reminder: { at: tomorrow.toISOString(), repeat: null } }, html: '<img src="../attachments/photo-mountains.jpg" width="800" height="600" alt=""><p>Train to Bolzano on the 14th, then bus 180 to the trailhead. Book the hut two weeks ahead.</p>' },
  { title: 'Ideas for the garden', meta: { color: 'mint' }, html: '<p>Raised bed along the fence. Lavender by the steps, rosemary near the kitchen door.</p><p>Ask Jonas about the old rain barrel.</p>' },
  { title: '', meta: { color: 'default' }, html: '<p>Call the dentist before Friday — the number is on the fridge.</p>' },
  { title: 'Reading list', meta: { color: 'lilac', labels: ['Books'] }, html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>The Overstory</p></li><li data-type="taskItem" data-checked="false"><p>Piranesi</p></li><li data-type="taskItem" data-checked="true"><p>Klara and the Sun</p></li></ul>' },
  { title: 'Pasta night', meta: { color: 'apricot', labels: ['Recipes'] }, html: '<img src="../attachments/photo-plate.jpg" width="600" height="800" alt=""><p>Brown the butter, add sage, toss with the gnocchi.</p>' },
  { title: 'Weekly review', meta: { color: 'default', labels: ['Work'] }, html: '<h2>Wins</h2><p>Shipped the onboarding flow.</p><h2>Next</h2><p>Plan the Q4 roadmap with the team.</p>' },
  { title: 'Wi-Fi at the cabin', meta: { color: 'chalk' }, html: '<p>Network: <code>Hytte-5G</code></p><p>Password is in the drawer under the TV.</p>' },
]);
srv.state.prefs = {};
fs.writeFileSync(path.join(srv.state.vaultDir, 'notebound.json'), JSON.stringify({ format: 'notebound', version: 1, labels: ['Books', 'Home', 'Recipes', 'Travel', 'Work'], notebooks: [{ id: 'nbwork', name: 'Work', parent: null }, { id: 'nbtrips', name: 'Trips', parent: null }, { id: 'nbitaly', name: 'Italy', parent: 'nbtrips' }], settings: { theme } }));

const browser = await chromium.launch({ executablePath: process.env.NB_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 384, height: 855 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: theme === 'dark' ? 'dark' : 'light' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(srv.appUrl);
await page.waitForSelector('.card');
await page.waitForTimeout(600);
const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('saved', name); };

await shot('01-home');
await page.getByRole('button', { name: 'Open menu' }).click();
await shot('02-drawer');
await page.mouse.click(372, 420);
await page.locator('.card', { hasText: 'Weekly review' }).click();
await page.waitForSelector('.nb-editor-content');
await shot('03-editor-text');
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.locator('.card', { hasText: 'Groceries' }).click();
await page.waitForSelector('.nb-editor-content li');
await shot('04-editor-list');
// keyboard open: the formatting toolbar
await page.locator('.nb-editor-content li p').first().click();
await page.evaluate(() => window.__mockEmit('insets', { top: 24, bottom: 16, left: 0, right: 0, ime: 300 }));
await page.setViewportSize({ width: 384, height: 555 });
await shot('05-editor-toolbar');
await page.setViewportSize({ width: 384, height: 855 });
await page.evaluate(() => window.__mockEmit('insets', { top: 24, bottom: 16, left: 0, right: 0, ime: 0 }));
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.locator('.card', { hasText: 'Weekly review' }).click();
await page.getByRole('button', { name: 'Color and background' }).click();
await shot('08-color-sheet');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Remind me' }).click();
await shot('09-reminder-sheet');
await page.keyboard.press('Escape');
await page.locator('.nb-editor-content').evaluate((el) => {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el.lastElementChild);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
await page.waitForTimeout(100);
await page.keyboard.press('Enter');
await page.keyboard.type('/');
await shot('10-slash-menu');
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.getByRole('button', { name: 'Search your notes' }).click();
await shot('06-search');
await page.getByRole('button', { name: 'Close search' }).click();
await page.getByRole('button', { name: 'Open menu' }).click();
await page.getByRole('button', { name: 'Settings' }).click();
await shot('07-settings');
await browser.close();
await srv.close();
